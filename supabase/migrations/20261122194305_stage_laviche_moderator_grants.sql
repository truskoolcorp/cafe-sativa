-- A capability, not a venue account. A deploy does not create or enable a grant.
create table public.stage_moderator_service_grants (
  room_id uuid not null references public.lounge_rooms(id) on delete cascade,
  actor_key text not null check (actor_key = 'laviche_stage'),
  show_starts_at timestamptz not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  primary key (room_id, actor_key, show_starts_at),
  check (opens_at <= show_starts_at and show_starts_at < closes_at),
  check (closes_at - opens_at <= interval '2 hours')
);
alter table public.stage_moderator_service_grants enable row level security;
revoke all on public.stage_moderator_service_grants from public, anon, authenticated, service_role;
grant select on public.stage_moderator_service_grants to service_role;

alter table public.stage_host_questions add column resolved_by_service text;
alter table public.stage_host_questions add constraint stage_question_service_attribution_check check (
  resolved_by_service is null or (
    resolved_by_service = 'laviche_stage' and host = 'laviche' and answer is not null
    and answer_source is not distinct from 'verified_host' and resolved_by is null
  )
);

-- No answer body is accepted from a client or model. One exact question can be
-- resolved under its own room/attendee/schedule grant. Sensitive content stays pending.
create function public.stage_resolve_laviche_question(
  p_question_id uuid, p_room_id uuid, p_attendee_id uuid, p_show_starts_at timestamptz
) returns text language sql security invoker set search_path = '' as $$
  with eligible as (
    select q.id,
      case when lower(regexp_replace(regexp_replace(btrim(q.question), '\?$', ''), '[[:space:]]+', ' ', 'g')) in (
        'when does the show start', 'what time does the show start', 'what time does the premiere start',
        'what time is the show', 'what time is kickoff'
      ) then 'From the floor: The show starts ' ||
        to_char(g.show_starts_at at time zone 'America/Chicago', 'FMDay, FMMonth FMDD, YYYY "at" FMHH12:MI AM') || ' Central.'
      when lower(regexp_replace(regexp_replace(btrim(q.question), '\?$', ''), '[[:space:]]+', ' ', 'g')) in (
        'is this live or prerecorded', 'is this show prerecorded', 'is the performance live'
      ) then 'From the floor: The performance is prerecorded and starts at the scheduled premiere time. The audience chat is live.'
      end as reply
    from public.stage_host_questions q
    join public.stage_moderator_service_grants g on g.room_id = q.room_id
      and g.actor_key = 'laviche_stage' and g.show_starts_at = p_show_starts_at
    where q.id = p_question_id and q.room_id = p_room_id and q.attendee_id = p_attendee_id
      and q.host = 'laviche' and q.answer is null and q.created_at >= g.opens_at
      and statement_timestamp() >= g.opens_at and statement_timestamp() < g.closes_at
      and length(q.question) <= 100 and q.question !~ '[\r\n]'
  )
  update public.stage_host_questions q
    set answer = eligible.reply, answer_source = 'verified_host', resolved_by_service = 'laviche_stage'
  from eligible where q.id = eligible.id and q.answer is null and eligible.reply is not null
  returning q.answer;
$$;
revoke all on function public.stage_resolve_laviche_question(uuid,uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.stage_resolve_laviche_question(uuid,uuid,uuid,timestamptz) to service_role;
