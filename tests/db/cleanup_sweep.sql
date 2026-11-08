BEGIN;
CREATE FUNCTION pg_temp.cleanup_review_assert(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'cleanup assertion failed: %',label; END IF;
 RAISE NOTICE 'CLEANUP PASS: %',label; END $$;
UPDATE concierge_private.policy SET max_retained_requests=1000,retention_seconds=86400,content_retention_seconds=3600,replay_max_age_seconds=3600,max_future_skew_seconds=0;
INSERT INTO concierge_private.requests(requester,request_id,redacted,state,charged,admitted_at,lease_until,finished_at,tombstone_retention_seconds,owner_token,reserved_cost_microusd)
 SELECT 's:retained-'||g,overlay(md5('finite-'||g) placing '4' from 13 for 1)::uuid,true,'cancelled',false,
 clock_timestamp()-interval '5 days',clock_timestamp()-interval '5 days'+interval '1 minute',clock_timestamp()-interval '4 days',2592000,NULL,10 FROM generate_series(1,3) g;
SELECT pg_temp.cleanup_review_assert((concierge_private.maintain_v1(1)->>'inspected')::int=1,'first page inspected one retained row');
CREATE TEMP TABLE sweep_snapshot AS SELECT cleanup_scan_through AS upper_key FROM concierge_private.lifecycle;
-- Append after the first page. This row is immediately prune-eligible but must
-- not enlarge the saved snapshot; it will be reached on the following sweep.
INSERT INTO concierge_private.requests(requester,request_id,redacted,state,charged,admitted_at,lease_until,finished_at,owner_token,reserved_cost_microusd)
 VALUES('s:appended-terminal','00000000-0000-4000-8000-00000000d001',true,'failed',true,
 clock_timestamp()-interval '5 days',clock_timestamp()-interval '5 days'+interval '1 minute',clock_timestamp()-interval '4 days',NULL,10);
SELECT pg_temp.cleanup_review_assert((SELECT cleanup_scan_id>s.upper_key FROM concierge_private.requests q CROSS JOIN sweep_snapshot s WHERE requester='s:appended-terminal'),'append key beyond finite snapshot');
SELECT pg_temp.cleanup_review_assert(NOT (concierge_private.maintain_v1(1)->>'sweep_completed')::boolean,'second page retains same sweep');
SELECT pg_temp.cleanup_review_assert((SELECT cleanup_scan_through=upper_key FROM concierge_private.lifecycle CROSS JOIN sweep_snapshot),'append does not move upper marker');
SELECT pg_temp.cleanup_review_assert((concierge_private.maintain_v1(1)->>'sweep_completed')::boolean,'third page completes original finite sweep despite append');
SELECT pg_temp.cleanup_review_assert(EXISTS(SELECT 1 FROM concierge_private.requests WHERE requester='s:appended-terminal'),'new tail waits for next sweep');
DO $$ BEGIN FOR step IN 1..4 LOOP PERFORM concierge_private.maintain_v1(1); END LOOP;
 PERFORM pg_temp.cleanup_review_assert(NOT EXISTS(SELECT 1 FROM concierge_private.requests WHERE requester='s:appended-terminal'),'next finite sweep prunes appended terminal');
END $$;
ROLLBACK;
