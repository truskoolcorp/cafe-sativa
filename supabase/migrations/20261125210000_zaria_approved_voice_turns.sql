-- Durable, server-only turn reservations for approved production Zaria voice users.
-- Web admission remains closed unless the deployment's exact user allowlist,
-- LiveKit project, canonical voice and signed bridge gates all pass.
create table public.zaria_voice_turns (
  grant_nonce uuid not null,
  event_id uuid not null,
  user_id uuid not null,
  conversation_id uuid not null references public.host_conversations(id) on delete cascade,
  utterance text not null,
  created_at timestamptz not null default now(),
  speech text,
  primary key (grant_nonce, event_id),
  check (char_length(utterance) between 1 and 1600),
  check (speech is null or char_length(speech) between 1 and 600)
);
alter table public.zaria_voice_turns enable row level security;
revoke all on public.zaria_voice_turns from public, anon, authenticated;
grant select, update, insert, delete on public.zaria_voice_turns to service_role;
create index zaria_voice_turns_user_created on public.zaria_voice_turns (user_id, created_at);

create function public.reserve_zaria_voice_turn(
  p_nonce uuid, p_event uuid, p_user uuid, p_conversation uuid, p_utterance text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare prior public.zaria_voice_turns;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('zaria-production-v1:' || p_user::text, 0));
  if not exists (
    select 1 from public.host_conversations
    where id = p_conversation and user_id = p_user and host_agent = 'zaria' and ended_at is null
  ) then return jsonb_build_object('status', 'forbidden'); end if;
  select * into prior from public.zaria_voice_turns where grant_nonce = p_nonce and event_id = p_event;
  if found then
    if prior.user_id <> p_user or prior.conversation_id <> p_conversation or prior.utterance <> p_utterance
      then return jsonb_build_object('status', 'conflict'); end if;
    if prior.speech is null then return jsonb_build_object('status', 'pending'); end if;
    return jsonb_build_object('status', 'replay', 'speech', prior.speech);
  end if;
  if (select count(*) from public.zaria_voice_turns where grant_nonce = p_nonce) >= 8 or
     (select count(*) from public.zaria_voice_turns where user_id = p_user and created_at > now() - interval '1 hour') >= 24
    then return jsonb_build_object('status', 'limited'); end if;
  insert into public.zaria_voice_turns(grant_nonce, event_id, user_id, conversation_id, utterance)
    values (p_nonce, p_event, p_user, p_conversation, p_utterance);
  return jsonb_build_object('status', 'reserved');
end;
$$;
revoke all on function public.reserve_zaria_voice_turn(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_zaria_voice_turn(uuid, uuid, uuid, uuid, text) to service_role;
