BEGIN;
CREATE FUNCTION pg_temp.cleanup_review_assert(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'cleanup assertion failed: %',label; END IF;
 RAISE NOTICE 'CLEANUP PASS: %',label; END $$;
UPDATE concierge_private.policy SET max_retained_requests=1000,retention_seconds=86400,content_retention_seconds=3600,replay_max_age_seconds=3600,max_future_skew_seconds=0;
INSERT INTO auth.users(id) VALUES('00000000-0000-4000-8000-00000000a001');
INSERT INTO public.host_conversations(id,user_id,host_agent,surface)
 VALUES('00000000-0000-4000-8000-00000000c001','00000000-0000-4000-8000-00000000a001','ginger','web-chat');
INSERT INTO concierge_private.requests(requester,request_id,user_id,conversation_id,redacted,state,charged,admitted_at,lease_until,finished_at,reserved_cost_microusd)
 VALUES('u:00000000-0000-4000-8000-00000000a001','00000000-0000-4000-8000-00000000b001','00000000-0000-4000-8000-00000000a001','00000000-0000-4000-8000-00000000c001',true,'failed',true,
 clock_timestamp()-interval '5 days',clock_timestamp()-interval '5 days'+interval '60 seconds',clock_timestamp()-interval '4 days',10);
CREATE TEMP TABLE privacy_scan_key AS SELECT cleanup_scan_id FROM concierge_private.requests WHERE request_id='00000000-0000-4000-8000-00000000b001';
INSERT INTO concierge_private.requests(requester,request_id,session_id,redacted,state,charged,admitted_at,lease_until,reserved_cost_microusd,quarantined_at)
 VALUES('s:surrogate-retained-unknown','00000000-0000-4000-8000-00000000b002','surrogate-retained-unknown',true,'uncertain',true,
 clock_timestamp()-interval '180 days',clock_timestamp()-interval '180 days'+interval '60 seconds',10,clock_timestamp()-interval '179 days');
-- Actual synthetic Auth hard delete, including existing statement/cascade guards.
DELETE FROM auth.users WHERE id='00000000-0000-4000-8000-00000000a001';
SELECT pg_temp.cleanup_review_assert(NOT EXISTS(SELECT 1 FROM auth.users WHERE id='00000000-0000-4000-8000-00000000a001'),'actual synthetic Auth deletion succeeded');
SELECT concierge_private.maintain_v1(1);
SELECT pg_temp.cleanup_review_assert(NOT EXISTS(SELECT 1 FROM concierge_private.requests WHERE request_id='00000000-0000-4000-8000-00000000b001'),'terminal request pruned after account deletion');
SELECT pg_temp.cleanup_review_assert((SELECT cleanup_scan_after=k.cleanup_scan_id AND cleanup_scan_through>cleanup_scan_after FROM concierge_private.lifecycle l CROSS JOIN privacy_scan_key k),'numeric cursor remains between pages after pruning');
SELECT pg_temp.cleanup_review_assert((SELECT to_jsonb(l)::text NOT LIKE '%00000000-0000-4000-8000-00000000a001%'
 AND to_jsonb(l)::text NOT LIKE '%00000000-0000-4000-8000-00000000b001%' AND to_jsonb(l)::text NOT LIKE '%u:%' AND to_jsonb(l)::text NOT LIKE '%s:%'
 FROM concierge_private.lifecycle l),'persisted cursor contains no requester, account UUID or request key');
SELECT pg_temp.cleanup_review_assert((SELECT array_agg(attname::text ORDER BY attnum)=ARRAY['singleton','reject_before_ms','last_cleanup_at','cleanup_scan_after','cleanup_scan_through']::text[]
 AND bool_and(attname NOT LIKE 'cleanup_%' OR atttypid='bigint'::regtype)
 FROM pg_attribute WHERE attrelid='concierge_private.lifecycle'::regclass AND attnum>0 AND NOT attisdropped),'only numeric lifecycle cursor metadata exists');
SELECT pg_temp.cleanup_review_assert((SELECT count(*)=1 AND bool_and(charged AND state='uncertain' AND quarantined_at IS NOT NULL AND owner_token IS NOT NULL) FROM concierge_private.requests),'unrelated unknown charge/capability never released');
SELECT pg_temp.cleanup_review_assert((concierge_private.maintain_v1(1)->>'sweep_completed')::boolean,'finite sweep completes at snapshotted upper key');
SELECT pg_temp.cleanup_review_assert((SELECT cleanup_scan_after=0 AND cleanup_scan_through IS NULL FROM concierge_private.lifecycle),'completed sweep resets only numeric markers');
ROLLBACK;
