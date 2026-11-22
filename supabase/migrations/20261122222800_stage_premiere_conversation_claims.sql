-- One durable reservation per model attempt. Neither attendees nor moderators
-- can use the database API to claim calls, and the room has a hard total cap.
create table public.stage_premiere_conversation_claims (
  id uuid primary key default gen_random_uuid(),
  question_id uuid unique references public.stage_host_questions(id) on delete set null,
  room_id uuid not null references public.lounge_rooms(id) on delete cascade,
  claimed_at timestamptz not null default now()
);
create index stage_premiere_conversation_claims_room on public.stage_premiere_conversation_claims(room_id);
alter table public.stage_premiere_conversation_claims enable row level security;
revoke all on public.stage_premiere_conversation_claims from public, anon, authenticated;
grant select, insert on public.stage_premiere_conversation_claims to service_role;

create function public.claim_stage_premiere_conversation(p_question_id uuid, p_room_id uuid, p_attendee_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.lounge_rooms r
    join public.stage_host_questions q on q.room_id = r.id
    where r.id = p_room_id and r.slug = 'ahnika-already-gone'
      and q.id = p_question_id and q.attendee_id = p_attendee_id and q.answer is null
      and q.created_at > now() - interval '1 minute'
  ) then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stage-premiere-conversation:' || p_room_id::text, 0));
  if (select count(*) from public.stage_premiere_conversation_claims where room_id = p_room_id) >= 100
    then return false; end if;
  insert into public.stage_premiere_conversation_claims(question_id, room_id)
    values (p_question_id, p_room_id) on conflict (question_id) do nothing;
  return found;
end;
$$;
revoke all on function public.claim_stage_premiere_conversation(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_stage_premiere_conversation(uuid, uuid, uuid) to service_role;
