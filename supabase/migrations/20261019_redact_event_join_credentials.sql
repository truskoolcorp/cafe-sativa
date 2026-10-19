-- SECURITY HOTFIX - review and rehearse on isolated branch before applying.
-- Redact meeting credentials for anonymous and unentitled viewers.
-- Keep existing column order/types of my_events_v to avoid changing callers.
CREATE OR REPLACE VIEW public.my_events_v
WITH (security_invoker = true)
AS
SELECT
 e.id, e.slug, e.title, e.subtitle, e.description, e.series, e.category,
 e.room_id, e.presenter_name, e.presenter_role, e.starts_at, e.ends_at,
 e.status, e.ticket_price_cents, e.capacity, e.free_for_tiers,
 e.hero_image_url, e.is_featured,
 CASE WHEN auth.uid() IS NOT NULL AND (
  EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id=e.id
          AND t.user_id=auth.uid() AND t.state IN ('valid','used'))
  OR e.ticket_price_cents=0
  OR EXISTS (SELECT 1 FROM public.memberships m
    WHERE m.user_id=auth.uid() AND m.status='active'
      AND m.tier=ANY(e.free_for_tiers))
 ) THEN e.zoom_join_url ELSE NULL END AS zoom_join_url,
 CASE WHEN auth.uid() IS NOT NULL AND (
  EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id=e.id
          AND t.user_id=auth.uid() AND t.state IN ('valid','used'))
  OR e.ticket_price_cents=0
  OR EXISTS (SELECT 1 FROM public.memberships m
    WHERE m.user_id=auth.uid() AND m.status='active'
      AND m.tier=ANY(e.free_for_tiers))
 ) THEN e.zoom_meeting_id ELSE NULL END AS zoom_meeting_id,
 e.topic_brief,
 CASE
  WHEN EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id=e.id
    AND t.user_id=auth.uid() AND t.state IN ('valid','used')) THEN 'ticketed'::text
  WHEN e.ticket_price_cents=0 THEN 'free'::text
  WHEN EXISTS (SELECT 1 FROM public.memberships m
    WHERE m.user_id=auth.uid() AND m.status='active'
      AND m.tier=ANY(e.free_for_tiers)) THEN 'tier_included'::text
  ELSE 'purchase_required'::text END AS access
FROM public.events e
WHERE e.status IN ('scheduled','live')
ORDER BY e.starts_at;
