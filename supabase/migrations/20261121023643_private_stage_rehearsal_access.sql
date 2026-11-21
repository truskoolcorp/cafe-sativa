-- Reserve one room ID. No public event, room row, or invitation is created here.
create table public.stage_rehearsal_invites (
  user_id uuid primary key references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);
alter table public.stage_rehearsal_invites enable row level security;
revoke all on public.stage_rehearsal_invites from public, anon, authenticated;
grant select on public.stage_rehearsal_invites to authenticated;
create policy stage_rehearsal_read_own_invitation on public.stage_rehearsal_invites
for select to authenticated using (user_id = (select auth.uid()) and expires_at > now());

-- Keep the restriction on direct message reads/writes as well as room lookup.
-- Anon gets its own policy so it never needs privileges on the invite table.
create policy stage_rehearsal_room_anon on public.lounge_rooms as restrictive
for select to anon using (id <> '5cafe000-0000-4000-8000-000000000001');
create policy stage_rehearsal_room_member on public.lounge_rooms as restrictive
for select to authenticated using (
  id <> '5cafe000-0000-4000-8000-000000000001' or
  exists (select 1 from public.stage_rehearsal_invites i where i.user_id = (select auth.uid()))
);

-- The existing audited soft-delete RPC bypasses RLS. Enforce invitation
-- here too, before it can modify a message in the reserved room.
create function public.guard_stage_rehearsal_message()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (new.room_id = '5cafe000-0000-4000-8000-000000000001'
      or (tg_op = 'UPDATE' and old.room_id = '5cafe000-0000-4000-8000-000000000001'))
    and not exists (select 1 from public.stage_rehearsal_invites i
      where i.user_id = auth.uid() and i.expires_at > now()) then
    raise insufficient_privilege using message = 'An active rehearsal invitation is required';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_stage_rehearsal_message() from public, anon, authenticated;
create trigger stage_rehearsal_message_guard before insert or update on public.lounge_messages
for each row execute function public.guard_stage_rehearsal_message();
create policy stage_rehearsal_messages_anon on public.lounge_messages as restrictive
for all to anon using (room_id <> '5cafe000-0000-4000-8000-000000000001')
with check (room_id <> '5cafe000-0000-4000-8000-000000000001');
create policy stage_rehearsal_messages_member on public.lounge_messages as restrictive
for all to authenticated using (
  room_id <> '5cafe000-0000-4000-8000-000000000001' or
  exists (select 1 from public.stage_rehearsal_invites i where i.user_id = (select auth.uid()))
) with check (
  room_id <> '5cafe000-0000-4000-8000-000000000001' or
  exists (select 1 from public.stage_rehearsal_invites i where i.user_id = (select auth.uid()))
);
