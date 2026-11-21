create table public.lounge_message_reports (
  room_id uuid not null references public.lounge_rooms(id),
  message_id uuid not null references public.lounge_messages(id),
  reporter_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (message_id, reporter_id)
);

create index lounge_message_reports_room_time on public.lounge_message_reports (room_id, created_at desc);
alter table public.lounge_message_reports enable row level security;
revoke all on public.lounge_message_reports from public, anon, authenticated;
grant insert (room_id, message_id) on public.lounge_message_reports to authenticated;
grant select on public.lounge_message_reports to authenticated;

create policy lounge_report_visible_message on public.lounge_message_reports
for insert to authenticated with check (
  reporter_id = (select auth.uid())
  and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  and exists (
    select 1 from public.lounge_messages m
    where m.id = lounge_message_reports.message_id
      and m.room_id = lounge_message_reports.room_id
      and m.deleted_at is null
      and m.user_id <> (select auth.uid())
  )
);

create policy lounge_reports_staff_read on public.lounge_message_reports
for select to authenticated using (
  coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and (p.is_staff or p.is_admin)
  )
);
