-- SECURITY MIGRATION - REHEARSE OFF PRODUCTION. No automatic deployment.
-- Keep event public listings while denying direct access to private join/recording columns.
-- Both table-level and inherited PUBLIC permissions are removed before explicit safe-column grants.
BEGIN;
REVOKE SELECT ON public.events FROM PUBLIC, anon, authenticated;
GRANT SELECT (
 id, slug, title, description, series, room_id, starts_at, ends_at, status,
 ticket_price_cents, capacity, free_for_tiers, hero_image_url, category,
 subtitle, presenter_name, presenter_role, is_featured, topic_brief,
 created_at, updated_at
) ON public.events TO anon, authenticated;

-- Existing view column order and types remain unchanged. Sensitive columns are NULL.
-- Actual join details must be returned only by a server endpoint after entitlement checks.
CREATE OR REPLACE VIEW public.my_events_v WITH (security_invoker=true) AS
SELECT e.id,e.slug,e.title,e.subtitle,e.description,e.series,e.category,
 e.room_id,e.presenter_name,e.presenter_role,e.starts_at,e.ends_at,e.status,
 e.ticket_price_cents,e.capacity,e.free_for_tiers,e.hero_image_url,e.is_featured,
 NULL::text AS zoom_join_url,NULL::text AS zoom_meeting_id,e.topic_brief,
 CASE
  WHEN EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id=e.id
   AND t.user_id=auth.uid() AND t.state IN ('valid','used')) THEN 'ticketed'::text
  WHEN e.ticket_price_cents=0 THEN 'free'::text
  WHEN EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id=auth.uid()
   AND m.status='active' AND (m.current_period_end IS NULL OR m.current_period_end>now())
   AND m.tier=ANY(e.free_for_tiers)) THEN 'tier_included'::text
  ELSE 'purchase_required'::text END AS access
FROM public.events e WHERE e.status IN ('scheduled','live') ORDER BY e.starts_at;

-- Explicit permission assertions fail the transaction if any secret remains exposed.
DO $audit$
BEGIN
 IF has_column_privilege('anon','public.events','zoom_join_url','SELECT')
 OR has_column_privilege('anon','public.events','zoom_meeting_id','SELECT')
 OR has_column_privilege('anon','public.events','recording_url','SELECT')
 OR has_column_privilege('authenticated','public.events','zoom_join_url','SELECT')
 OR has_column_privilege('authenticated','public.events','zoom_meeting_id','SELECT')
 OR has_column_privilege('authenticated','public.events','recording_url','SELECT')
 THEN RAISE EXCEPTION 'Event secret columns remain publicly readable'; END IF;
END $audit$;
COMMIT;
