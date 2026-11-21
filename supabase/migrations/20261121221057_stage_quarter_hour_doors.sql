-- Doors open one quarter-hour before the public showtime. Preserve the
-- existing policy scope, host cue and after-show cutoff.
alter policy stage_ahnika_audience_window on public.lounge_messages
using (
  room_id is distinct from (select id from public.lounge_rooms where slug = 'ahnika-already-gone')
  or (select exists (
    select 1 from public.my_events_v e
    where e.slug = 'ahnika-already-gone'
      and e.starts_at = '2026-12-01T06:00:00Z'
      and e.presenter_name = 'Ahnika Merlot' and e.ticket_price_cents = 0
      and e.status in ('scheduled', 'live')
      and statement_timestamp() >= e.starts_at - interval '15 minutes'
      and statement_timestamp() < e.starts_at + interval '16 minutes 39.7 seconds'
  ) and coalesce(auth.jwt()->>'is_anonymous', 'false') = 'false')
)
with check (
  room_id is distinct from (select id from public.lounge_rooms where slug = 'ahnika-already-gone')
  or (
    (select exists (
      select 1 from public.my_events_v e
      where e.slug = 'ahnika-already-gone'
        and e.starts_at = '2026-12-01T06:00:00Z'
        and e.presenter_name = 'Ahnika Merlot' and e.ticket_price_cents = 0
        and e.status in ('scheduled', 'live')
        and statement_timestamp() >= e.starts_at - interval '15 minutes'
        and statement_timestamp() < e.starts_at + interval '16 minutes 39.7 seconds'
    ) and coalesce(auth.jwt()->>'is_anonymous', 'false') = 'false')
    and (content !~ '^\[Ask (ahnika|laviche)\] ' or statement_timestamp() >= '2026-12-01T05:59:30Z')
  )
);
