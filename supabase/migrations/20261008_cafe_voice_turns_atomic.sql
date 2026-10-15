-- Transactional LiveKit turn ledger; apply after cafe_voice_sessions migration.
create table if not exists public.cafe_voice_turns (
  room_name text not null references public.cafe_voice_sessions(room_name) on delete cascade,
  turn_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (room_name, turn_id)
);
alter table public.cafe_voice_turns enable row level security;
revoke all on public.cafe_voice_turns from anon, authenticated;

create or replace function public.persist_cafe_voice_turn(
  p_room text, p_turn_id uuid, p_user_text text, p_assistant_text text
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_session public.cafe_voice_sessions%rowtype;
  v_max integer;
  v_window interval;
  v_used bigint;
begin
  if length(trim(p_user_text)) < 1 or length(p_user_text) > 2000
    or length(trim(p_assistant_text)) < 1 or length(p_assistant_text) > 4000 then
    raise exception 'Invalid voice turn';
  end if;
  select * into v_session from public.cafe_voice_sessions
    where room_name = p_room for update;
  if not found or v_session.revoked_at is not null or v_session.expires_at <= now() then
    raise exception 'Voice room unavailable';
  end if;
  -- Serialize requests for the same identity, even across rooms.
  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(v_session.user_id::text, 'anon:' || v_session.session_id), 14619));
  if exists (select 1 from public.cafe_voice_turns
      where room_name=p_room and turn_id=p_turn_id) then
    return 'duplicate';
  end if;
  -- A charged turn must first have received an atomic reservation.
  if not exists (select 1 from public.cafe_voice_reservations
      where room_name=p_room and turn_id=p_turn_id
        and status='reserved' and expires_at > now()) then
    raise exception 'No active pre-provider reservation';
  end if;
  case v_session.tier
    when 'anonymous' then v_max := 10; v_window := interval '1 hour';
    when 'explorer' then v_max := 50; v_window := interval '1 day';
    when 'regular' then v_max := 200; v_window := interval '1 day';
    when 'vip' then v_max := 1000; v_window := interval '1 day';
    else raise exception 'Invalid tier';
  end case;
  select count(*) into v_used from public.host_messages hm
    join public.host_conversations hc on hc.id = hm.conversation_id
    where hm.role='user' and hm.created_at >= now()-v_window
      and (
        (v_session.user_id is not null and hc.user_id=v_session.user_id)
        or (v_session.user_id is null and hc.session_id=v_session.session_id)
      );
  -- The reservation was counted against the allowance before generation.
  -- Do not reject a legitimately reserved in-flight turn after another turn settled.
  insert into public.cafe_voice_turns(room_name, turn_id) values(p_room,p_turn_id);
  update public.cafe_voice_reservations set status='settled'
    where room_name=p_room and turn_id=p_turn_id;
  insert into public.host_messages(conversation_id,role,content) values
    (v_session.conversation_id, 'user',trim(p_user_text)),
    (v_session.conversation_id, 'assistant',trim(p_assistant_text));
  return 'persisted';
end;
$$;
revoke all on function public.persist_cafe_voice_turn(text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.persist_cafe_voice_turn(text,uuid,text,text) to service_role;
