-- Scope the public audience window to the verified, approved Ahnika occurrence.
-- Existing identity, tier, soft-delete, and rehearsal policies still apply.
create policy stage_ahnika_audience_window on public.lounge_messages
as restrictive for all to authenticated
using (
  room_id is distinct from (select id from public.lounge_rooms where slug = 'ahnika-already-gone')
  or (select exists (
    select 1 from public.my_events_v e
    where e.slug = 'ahnika-already-gone'
      and e.starts_at = '2026-12-01T06:00:00Z'
      and e.presenter_name = 'Ahnika Merlot' and e.ticket_price_cents = 0
      and e.status in ('scheduled', 'live')
      and statement_timestamp() >= e.starts_at - interval '15 minutes 30 seconds'
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
        and statement_timestamp() >= e.starts_at - interval '15 minutes 30 seconds'
        and statement_timestamp() < e.starts_at + interval '16 minutes 39.7 seconds'
    ) and coalesce(auth.jwt()->>'is_anonymous', 'false') = 'false')
    and (content !~ '^\[Ask (ahnika|laviche)\] ' or statement_timestamp() >= '2026-12-01T05:59:30Z')
  )
);

-- The existing moderator grant applies to the final cue as well as the show.
alter policy stage_premiere_moderator_read_own on public.stage_premiere_reply_moderators
using (
  user_id = (select auth.uid()) and now() >= '2026-12-01T05:59:30Z' and now() < expires_at
);

alter policy stage_concierge_moderator_claim on public.stage_concierge_claims
with check (
  moderator_id = (select auth.uid())
  and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  and exists (
    select 1 from public.lounge_messages m join public.lounge_rooms r on r.id = m.room_id
    where m.id = stage_concierge_claims.message_id and m.deleted_at is null
      and m.content ~ '^\[Ask (ahnika|laviche)\] .'
      and (
        (r.id = '5cafe000-0000-4000-8000-000000000001'
          and exists (select 1 from public.stage_rehearsal_invites i
            where i.user_id = (select auth.uid()) and i.expires_at > now() and i.can_draft))
        or
        (r.id <> '5cafe000-0000-4000-8000-000000000001' and r.slug = 'ahnika-already-gone'
          and now() >= '2026-12-01T05:59:30Z' and now() < '2026-12-01T06:16:39.700Z'
          and (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.is_staff or p.is_admin))
            or exists (select 1 from public.stage_premiere_reply_moderators g
              where g.user_id = (select auth.uid()) and g.room_id = r.id and g.expires_at > now())))
      )
  )
);
