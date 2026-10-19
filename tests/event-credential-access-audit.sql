-- READ-ONLY permission audit; safe to run against a disposable copy or production.
-- This is NOT a replacement for role-specific PostgREST regression testing.
SELECT
  has_table_privilege('anon', 'public.events', 'SELECT') AS anon_can_select_events,
  has_column_privilege('anon', 'public.events', 'zoom_join_url', 'SELECT') AS anon_can_select_join_url,
  has_column_privilege('anon', 'public.events', 'zoom_meeting_id', 'SELECT') AS anon_can_select_meeting_id,
  has_column_privilege('authenticated', 'public.events', 'zoom_join_url', 'SELECT') AS authenticated_can_select_join_url,
  has_column_privilege('authenticated', 'public.events', 'zoom_meeting_id', 'SELECT') AS authenticated_can_select_meeting_id;
-- Launch gate: both anon_can_select_* values must be FALSE;
-- authenticated clients must not access join secrets directly unless
-- row-level entitlement is verified by a separate security boundary.
