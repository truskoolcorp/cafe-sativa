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
  if exists (select 1 from public.stage_premiere_message_reports where message_id = p_message and status = 'dismissed') then
    result := 'dismissed';
  elsif pg_catalog.btrim(target.content) ~* '^https?://[^[:space:]]+$'
    and (select count(*) from public.lounge_messages m where m.room_id = p_room and m.user_id = target.user_id
      and not m.is_staff and m.created_at >= greatest(opens, target.created_at - interval '90 seconds')
      and m.created_at <= least(t, target.created_at + interval '90 seconds')
      and pg_catalog.btrim(m.content) = pg_catalog.btrim(target.content)) >= 3 then
    result := 'hidden_by_laviche';
    -- Keep the original row. No account, organization, or cross-room action.
    update public.lounge_messages set deleted_at = t, deleted_by = null where id = p_message and room_id = p_room;
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
  if p_action = 'remove' then
    update public.lounge_messages set deleted_at = t, deleted_by = p_staff where id = p_message and room_id = p_room;
  end if;
  return true;
end;
$$;
revoke all on function public.stage_premiere_review_report(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.stage_premiere_review_report(uuid,uuid,uuid,text) to service_role;
