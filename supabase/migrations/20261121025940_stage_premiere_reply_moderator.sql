create table public.stage_premiere_reply_moderators (
  room_id uuid not null references public.lounge_rooms(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null check (expires_at <= '2026-12-01T06:16:39.700Z'),
  primary key (room_id, user_id)
);
alter table public.stage_premiere_reply_moderators enable row level security;
revoke all on public.stage_premiere_reply_moderators from public, anon, authenticated;
grant select on public.stage_premiere_reply_moderators to authenticated;
create policy stage_premiere_moderator_read_own on public.stage_premiere_reply_moderators
for select to authenticated using (
  user_id = (select auth.uid()) and now() >= '2026-12-01T06:00:00Z' and now() < expires_at
);

alter policy stage_concierge_moderator_claim on public.stage_concierge_claims
with check (
  moderator_id = (select auth.uid())
  and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  and exists (
    select 1 from public.lounge_messages m join public.lounge_rooms r on r.id = m.room_id
    where m.id = stage_concierge_claims.message_id and m.deleted_at is null
      and m.content ~ '^\[Ask (ahnika|laviche)\] .'
      and (
        (r.id = '5cafe000-0000-4000-8000-000000000001'
          and exists (select 1 from public.stage_rehearsal_invites i
            where i.user_id = (select auth.uid()) and i.expires_at > now() and i.can_draft))
        or
        (r.id <> '5cafe000-0000-4000-8000-000000000001' and r.slug = 'ahnika-already-gone'
          and now() >= '2026-12-01T06:00:00Z' and now() < '2026-12-01T06:16:39.700Z'
          and (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.is_staff or p.is_admin))
            or exists (select 1 from public.stage_premiere_reply_moderators g
              where g.user_id = (select auth.uid()) and g.room_id = r.id and g.expires_at > now())))
      )
  )
);
