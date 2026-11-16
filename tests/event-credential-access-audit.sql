-- READ-ONLY permission audit. Run before/after migration; do not query credential values.
-- Release criteria: all six secret-column permissions must be false.
SELECT
 has_column_privilege('anon','public.events','zoom_join_url','SELECT') AS anon_join_url_exposed,
 has_column_privilege('anon','public.events','zoom_meeting_id','SELECT') AS anon_meeting_id_exposed,
 has_column_privilege('anon','public.events','recording_url','SELECT') AS anon_recording_url_exposed,
 has_column_privilege('authenticated','public.events','zoom_join_url','SELECT') AS authenticated_join_url_exposed,
 has_column_privilege('authenticated','public.events','zoom_meeting_id','SELECT') AS authenticated_meeting_id_exposed,
 has_column_privilege('authenticated','public.events','recording_url','SELECT') AS authenticated_recording_url_exposed,
 has_column_privilege('anon','public.events','title','SELECT') AS public_title_readable,
 has_column_privilege('authenticated','public.events','title','SELECT') AS member_title_readable;
-- A view-only fix cannot compensate for direct column read privilege on public.events.
-- PostgREST role-specific tests and entitlement scenarios are still required.
