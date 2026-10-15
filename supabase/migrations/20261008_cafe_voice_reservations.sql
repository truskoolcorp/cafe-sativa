-- Phase 2 draft: reserve voice usage before any paid model/TTS work.
-- Must be deployed together with an agent-level pre-LLM enforcement hook.
-- This function is NOT invoked by the current worker and is not a release gate by itself.
create table if not exists public.cafe_voice_reservations (
  room_name text not null references public.cafe_voice_sessions(room_name) on delete cascade,
  turn_id uuid not null,
  status text not null default 'reserved'
    check (status in ('reserved','settled','canceled','failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '3 minutes'),
  primary key(room_name,turn_id)
);
create index if not exists cafe_voice_reservations_created on public.cafe_voice_reservations(created_at);
alter table public.cafe_voice_reservations enable row level security;
revoke all on public.cafe_voice_reservations from anon, authenticated;

create or replace function public.reserve_cafe_voice_turn(
  p_room text, p_turn_id uuid
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  s public.cafe_voice_sessions%rowtype;
  limit_count integer;
  window_interval interval;
  used_count bigint;
  inflight_count bigint;
  already_status text;
begin
  select * into s from public.cafe_voice_sessions where room_name=p_room for update;
  if not found or s.revoked_at is not null or s.expires_at <= now() then
    raise exception 'Unauthorized voice room';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(s.user_id::text, 'anon:' || s.session_id), 14619));
  select status into already_status from public.cafe_voice_reservations
    where room_name=p_room and turn_id=p_turn_id;
  if found then
    if already_status in ('reserved','settled') then return already_status; end if;
    raise exception 'Voice reservation cannot be reused';
  end if;
  case s.tier
    when 'anonymous' then limit_count := 10; window_interval := interval '1 hour';
    when 'explorer' then limit_count := 50; window_interval := interval '1 day';
    when 'regular' then limit_count := 200; window_interval := interval '1 day';
    when 'vip' then limit_count := 1000; window_interval := interval '1 day';
    else raise exception 'Invalid membership';
  end case;
  select count(*) into used_count from public.host_messages m
    join public.host_conversations c on c.id=m.conversation_id
    where m.role='user' and m.created_at >= now()-window_interval
      and ((s.user_id is not null and c.user_id=s.user_id)
       or (s.user_id is null and c.session_id=s.session_id));
  select count(*) into inflight_count from public.cafe_voice_reservations r
    join public.cafe_voice_sessions other on other.room_name=r.room_name
    where r.status='reserved' and r.expires_at > now()
      and r.created_at >= now()-window_interval
      and ((s.user_id is not null and other.user_id=s.user_id)
       or (s.user_id is null and other.session_id=s.session_id));
  if used_count + inflight_count >= limit_count then
    raise exception 'Voice turn limit exhausted';
  end if;
  insert into public.cafe_voice_reservations(room_name,turn_id)
    values(p_room,p_turn_id);
  return 'reserved';
end;
$$;
revoke all on function public.reserve_cafe_voice_turn(text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_cafe_voice_turn(text,uuid) to service_role;
