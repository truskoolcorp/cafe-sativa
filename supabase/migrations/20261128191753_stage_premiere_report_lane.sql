-- Premiere-only moderation. Reports alone never hide ordinary conversation.
create table public.stage_premiere_message_reports (
  room_id uuid not null references public.lounge_rooms(id) on delete cascade,
  message_id uuid not null references public.lounge_messages(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null check (status in ('needs_review','hidden_by_laviche','hidden_by_staff','dismissed')),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  primary key (message_id, reporter_id)
);
create index stage_premiere_reports_queue on public.stage_premiere_message_reports(room_id,status,created_at);
create index stage_premiere_reports_rate on public.stage_premiere_message_reports(reporter_id,created_at);
alter table public.stage_premiere_message_reports enable row level security;
revoke all on public.stage_premiere_message_reports from public, anon, authenticated;
grant select, insert, update on public.stage_premiere_message_reports to service_role;

create function public.stage_premiere_report_message(p_room uuid, p_message uuid, p_reporter uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  opens constant timestamptz := '2026-12-01T05:45:00Z';
  closes constant timestamptz := '2026-12-01T06:16:39.700Z';
  t timestamptz;
  target public.lounge_messages%rowtype;
  result text;
begin
  if not exists (select 1 from public.lounge_rooms where id = p_room and slug = 'ahnika-already-gone') then return 'closed'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('premiere-report:' || p_reporter::text,0));
  t := pg_catalog.clock_timestamp();
  if t < opens or t >= closes then return 'closed'; end if;
  select * into target from public.lounge_messages where id = p_message and room_id = p_room
    and user_id <> p_reporter and not is_staff and created_at >= opens and created_at <= t for update;
  if not found or pg_catalog.clock_timestamp() >= closes then return 'closed'; end if;
  select status into result from public.stage_premiere_message_reports where message_id = p_message and reporter_id = p_reporter;
  if found then return result; end if;
  if target.deleted_at is not null then return 'closed'; end if;
  if (select count(*) from public.stage_premiere_message_reports where reporter_id = p_reporter
    and created_at >= t - interval '1 minute') >= 5 then return 'rate_limited'; end if;

  result := 'needs_review';
  select status into result from public.stage_premiere_message_reports where message_id = p_message
    and status <> 'needs_review' order by resolved_at desc limit 1;
  if not found then result := 'needs_review'; end if;
  if result = 'needs_review' and pg_catalog.btrim(target.content) ~* '^https?://[^[:space:]]+$'
    and (select count(*) from public.lounge_messages m where m.room_id = p_room and m.user_id = target.user_id
      and not m.is_staff and m.created_at >= greatest(opens, target.created_at - interval '90 seconds')
      and m.created_at <= least(t, target.created_at + interval '90 seconds')
      and pg_catalog.btrim(m.content) = pg_catalog.btrim(target.content)) >= 3 then
    result := 'hidden_by_laviche';
    -- The Stage display consumes the private suppression ledger; no write to
    -- the source message or change to the Lounge's existing auth write guard.
    update public.stage_premiere_message_reports set status = result, resolved_at = t
      where message_id = p_message and status = 'needs_review';
  end if;
  insert into public.stage_premiere_message_reports(room_id,message_id,reporter_id,created_at,status,resolved_at)
    values (p_room,p_message,p_reporter,t,result,case when result <> 'needs_review' then t end);
  return result;
end;
$$;
revoke all on function public.stage_premiere_report_message(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.stage_premiere_report_message(uuid,uuid,uuid) to service_role;

create function public.stage_premiere_review_report(p_room uuid, p_message uuid, p_staff uuid, p_action text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  opens constant timestamptz := '2026-12-01T05:45:00Z';
  closes constant timestamptz := '2026-12-01T06:16:39.700Z';
  t timestamptz;
begin
  if p_action is null or p_action not in ('remove','dismiss') then return false; end if;
  perform 1 from public.lounge_messages m join public.lounge_rooms r on r.id = m.room_id
    where m.id = p_message and r.id = p_room and r.slug = 'ahnika-already-gone'
      and m.created_at >= opens and m.deleted_at is null and not m.is_staff for update of m;
  if not found then return false; end if;
  t := pg_catalog.clock_timestamp();
  if t < opens or t >= closes or not exists (
    select 1 from public.stage_premiere_reply_moderators where room_id = p_room and user_id = p_staff and expires_at > t
  ) then return false; end if;
  update public.stage_premiere_message_reports set resolved_at = t, resolved_by = p_staff,
    status = case when p_action = 'remove' then 'hidden_by_staff' else 'dismissed' end
    where room_id = p_room and message_id = p_message and status = 'needs_review';
  if not found then return false; end if;
  return true;
end;
$$;
revoke all on function public.stage_premiere_review_report(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.stage_premiere_review_report(uuid,uuid,uuid,text) to service_role;

create function public.stage_premiere_report_state(p_room uuid, p_viewer uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  opens constant timestamptz := '2026-12-01T05:45:00Z';
  closes constant timestamptz := '2026-12-01T06:16:39.700Z';
  t timestamptz := pg_catalog.clock_timestamp();
  hidden jsonb;
  pending jsonb;
begin
  if t < opens or t >= closes or not exists (
    select 1 from public.lounge_rooms where id = p_room and slug = 'ahnika-already-gone'
  ) then return null; end if;
  select coalesce(jsonb_agg(distinct message_id), '[]'::jsonb) into hidden
    from public.stage_premiere_message_reports where room_id = p_room and status in ('hidden_by_laviche','hidden_by_staff');
  if not exists (
    select 1 from public.stage_premiere_reply_moderators where room_id = p_room and user_id = p_viewer and expires_at > t
  ) then return jsonb_build_object('hidden', hidden); end if;

  -- Filter author-deleted messages and collapse duplicate reports before the
  -- limit, so one deleted or heavily reported message cannot starve the queue.
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'content',q.content) order by q.first_report,q.id),'[]'::jsonb)
    into pending from (
      select m.id, m.content, min(r.created_at) as first_report
      from public.stage_premiere_message_reports r join public.lounge_messages m
        on m.id = r.message_id and m.room_id = r.room_id
      where r.room_id = p_room and r.status = 'needs_review' and m.deleted_at is null
        and m.created_at >= opens and not m.is_staff
      group by m.id, m.content order by first_report,m.id limit 40
    ) q;
  return jsonb_build_object('hidden',hidden,'pending',pending);
end;
$$;
revoke all on function public.stage_premiere_report_state(uuid,uuid) from public, anon, authenticated;
grant execute on function public.stage_premiere_report_state(uuid,uuid) to service_role;

-- Close the gap between the API's last phase check and the database write.
-- A held question stays pending. A human fallback reply remains attributed to staff.
create function public.stage_premiere_performer_write_gate()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  t timestamptz := pg_catalog.clock_timestamp();
begin
  if t >= '2026-12-01T06:00:00Z'::timestamptz and t < '2026-12-01T06:01:39.700Z'::timestamptz
    and exists (select 1 from public.lounge_rooms where id = new.room_id and slug = 'ahnika-already-gone') then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.stage_premiere_performer_write_gate() from public, anon, authenticated;
grant execute on function public.stage_premiere_performer_write_gate() to service_role;
create trigger stage_premiere_performer_write_gate
  before insert or update of answer, answer_source, host, room_id on public.stage_host_questions
  for each row when (new.host = 'ahnika' and new.answer_source = 'verified_host' and new.answer is not null)
  execute function public.stage_premiere_performer_write_gate();
