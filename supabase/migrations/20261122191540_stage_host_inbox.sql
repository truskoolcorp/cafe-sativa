-- Private Q&A is deliberately not part of Lounge realtime or the shared chat table.
create table public.stage_host_questions (
  id uuid primary key,
  room_id uuid not null references public.lounge_rooms(id) on delete cascade,
  attendee_id uuid not null references auth.users(id) on delete cascade,
  host text not null check (host in ('ahnika', 'laviche')),
  question text not null check (length(btrim(question)) between 1 and 600),
  answer text check (length(btrim(answer)) between 1 and 600),
  answer_source text check (answer_source in ('verified_host', 'moderator')),
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((answer is null) = (answer_source is null)),
  check (answer_source is distinct from 'verified_host' or resolved_by is null)
);

create index stage_host_questions_attendee_time on public.stage_host_questions (room_id, attendee_id, created_at desc);
create index stage_host_questions_pending on public.stage_host_questions (room_id, created_at) where answer is null;
alter table public.stage_host_questions enable row level security;
revoke all on public.stage_host_questions from public, anon, authenticated;
grant select, insert, update on public.stage_host_questions to service_role;

-- Limit retries and new requests without trusting browser/UI cooldowns.
create function public.guard_stage_host_question_rate() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.room_id::text || ':' || new.attendee_id::text, 0));
  if exists (select 1 from public.stage_host_questions where id = new.id) then return new; end if;
  if (select count(*) from public.stage_host_questions
      where room_id = new.room_id and attendee_id = new.attendee_id
        and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'stage_host_question_rate_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_stage_host_question_rate() from public, anon, authenticated;
create trigger stage_host_question_rate before insert on public.stage_host_questions
  for each row execute function public.guard_stage_host_question_rate();
