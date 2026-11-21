create table public.stage_concierge_claims (
  message_id uuid primary key,
  moderator_id uuid not null default auth.uid(),
  claimed_at timestamptz not null default now(),
  minute_slot bigint not null unique default floor(extract(epoch from now()) / 60)::bigint
);
alter table public.stage_concierge_claims enable row level security;
revoke all on public.stage_concierge_claims from public, anon, authenticated;
grant insert(message_id) on public.stage_concierge_claims to authenticated;
create policy stage_concierge_moderator_claim on public.stage_concierge_claims
for insert to authenticated with check (
  moderator_id = (select auth.uid())
  and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.is_staff or p.is_admin))
  and exists (select 1 from public.lounge_messages m join public.lounge_rooms r on r.id = m.room_id
    where m.id = stage_concierge_claims.message_id and r.slug = 'ahnika-already-gone'
      and m.deleted_at is null and m.content ~ '^\[Ask (ahnika|laviche)\] .')
);
