# Event credential release rehearsal
Do not apply to production or repurpose the existing Neon-replica branch; its event title column is not readable by anon, unlike production.

1. Use a cost-approved disposable database with production-equivalent schema, grants, RLS and synthetic event/user data. Snapshot ACL and view SQL before applying anything.
2. Run tests/event-credential-access-audit.sql before and after applying the proposed migration to the disposable database.
3. Verify anon and authenticated direct table reads of zoom_join_url, zoom_meeting_id and recording_url are denied, while ordinary event titles remain readable.
4. Verify both my_events_v and public event listings expose no join secrets.
5. Test join endpoint statuses: unsigned 401, no entitlement 403, valid/used ticket 200, active eligible tier 200, expired tier 403, signed-in free event 200; unavailable database 503.
6. Confirm watch page obtains join details only through the authenticated server API; review rollback and event listing behavior.
7. Run integration tests and rollback rehearsal before changing draft PR status. Never use actual user records or Zoom credentials in the test fixtures.

Go/no-go: no merge or production migration until all steps pass.