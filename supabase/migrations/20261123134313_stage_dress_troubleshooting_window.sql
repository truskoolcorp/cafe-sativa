-- Extend the November 24 private troubleshooting window without changing media cues.
create or replace function public.stage_dress_report_message(p_message_id uuid, p_reporter_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  rehearsal_room constant uuid := '5cafe000-0000-4000-8000-000000000001';
  doors constant timestamptz := '2026-11-24T13:45:00Z';
  closes constant timestamptz := '2026-11-24T15:00:00Z';
  expires constant timestamptz := '2026-11-24T15:00:00Z';
  at_time timestamptz := pg_catalog.clock_timestamp();
  target public.lounge_messages%rowtype;
  prior text;
  outcome text := 'needs_review';
begin
  if at_time < doors or at_time >= closes or not exists (
    select 1 from public.stage_rehearsal_invites where user_id = p_reporter_id and expires_at = expires
  ) then return 'closed'; end if;

  -- Serialize one reporter's rate counter and all decisions for a message.
  perform pg_catalog.pg_advisory_xact_lock(20261124, pg_catalog.hashtext(p_reporter_id::text));
  select * into target from public.lounge_messages
    where id = p_message_id and room_id = rehearsal_room and created_at >= doors
      and user_id <> p_reporter_id and not is_staff and deleted_at is null for update;
  if not found then return 'closed'; end if;
  if pg_catalog.clock_timestamp() >= closes then return 'closed'; end if;

  select status into prior from public.stage_dress_message_reports
    where message_id = p_message_id and reporter_id = p_reporter_id;
  if found then
    return case when prior like 'hidden_by_%' then prior else 'needs_review' end;
  end if;
  if (select count(*) from public.stage_dress_message_reports
    where reporter_id = p_reporter_id and created_at >= at_time - interval '1 minute') >= 5 then
    return 'rate_limited';
  end if;
  select status into prior from public.stage_dress_message_reports
    where message_id = p_message_id and status in ('hidden_by_laviche','hidden_by_staff','dismissed')
    order by resolved_at desc nulls last limit 1;
  if found then
    outcome := prior;
  elsif target.content ~* '(^|[[:space:]])https?://[^[:space:]]+' and (
    select count(*) from public.lounge_messages m
      where m.room_id = rehearsal_room and m.user_id = target.user_id
      and m.created_at >= greatest(doors, target.created_at - interval '90 seconds')
      and m.created_at <= least(at_time, target.created_at + interval '90 seconds')
      and m.deleted_at is null and not m.is_staff
      and pg_catalog.btrim(m.content) = pg_catalog.btrim(target.content)
  ) >= 3 then
    -- Laviche's one automatic action is reversible suppression of an exact,
    -- repeated link. A report by itself never hides an ordinary message.
    outcome := 'hidden_by_laviche';
    update public.stage_dress_message_reports set status = outcome, resolved_at = at_time
      where message_id = p_message_id and status = 'needs_review';
  end if;
  insert into public.stage_dress_message_reports(message_id, reporter_id, status, resolved_at)
    values (p_message_id, p_reporter_id, outcome, case when outcome <> 'needs_review' then at_time end);
  return outcome;
end;
$$;
revoke all on function public.stage_dress_report_message(uuid,uuid) from public, anon, authenticated;
grant execute on function public.stage_dress_report_message(uuid,uuid) to service_role;

create or replace function public.stage_dress_review_report(p_message_id uuid, p_staff_id uuid, p_action text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  doors constant timestamptz := '2026-11-24T13:45:00Z';
  closes constant timestamptz := '2026-11-24T15:00:00Z';
  at_time timestamptz := pg_catalog.clock_timestamp();
begin
  if p_action is null or p_action not in ('remove','dismiss') or at_time < doors or at_time >= closes or not exists (
    select 1 from public.stage_rehearsal_invites where user_id = p_staff_id and can_draft
      and expires_at = '2026-11-24T15:00:00Z'::timestamptz
  ) then return false; end if;
  perform 1 from public.lounge_messages where id = p_message_id
    and room_id = '5cafe000-0000-4000-8000-000000000001'::uuid and created_at >= doors
    and deleted_at is null for update;
  if not found or pg_catalog.clock_timestamp() >= closes then return false; end if;
  update public.stage_dress_message_reports
    set status = case when p_action = 'remove' then 'hidden_by_staff' else 'dismissed' end,
      resolved_by = p_staff_id, resolved_at = at_time
    where message_id = p_message_id and status = 'needs_review';
  return found;
end;
$$;
revoke all on function public.stage_dress_review_report(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.stage_dress_review_report(uuid,uuid,text) to service_role;
