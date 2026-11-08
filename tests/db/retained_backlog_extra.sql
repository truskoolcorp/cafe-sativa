-- Independent sequential review fixtures. Synthetic local cluster only.
BEGIN;
CREATE FUNCTION pg_temp.review_assert(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
 RAISE NOTICE 'REVIEW PASS: %',label;
END $$;
UPDATE concierge_private.policy SET enabled=true,version='review-only',global_inflight=100,global_admissions=1000,
 global_window_seconds=86400,global_budget_microusd=100000,max_request_cost_microusd=10,max_prompt_bytes=48000,
 max_input_messages=61,max_output_tokens=512,max_reply_chars=16384,lease_seconds=60,
 legacy_cutoff=clock_timestamp()-interval '1 second',legacy_drained=true,charged_failures_approved=true,
 retention_seconds=86400,content_retention_seconds=3600,replay_max_age_seconds=3600,max_future_skew_seconds=60,
 max_retained_requests=1;
SAVEPOINT expiry_rollback;
SET LOCAL ROLE service_role;
DO $$ DECLARE id uuid:=test_fixture.request_id(); a jsonb; BEGIN
 a:=public.concierge_admit_v1(NULL,'review-expiry',id,test_fixture.payload(id),'anonymous');
 PERFORM pg_temp.review_assert(a->>'admitted'='true','service seed takes last slot');
END $$;
RESET ROLE;
UPDATE concierge_private.requests SET admitted_at=clock_timestamp()-interval '2 minutes',lease_until=clock_timestamp()-interval '1 minute';
SET LOCAL ROLE service_role;
DO $$ DECLARE id uuid:=test_fixture.request_id(); a jsonb; before_convos bigint; BEGIN
 SELECT count(*) INTO before_convos FROM public.host_conversations;
 a:=public.concierge_admit_v1(NULL,'review-new-full',id,test_fixture.payload(id),'anonymous');
 PERFORM pg_temp.review_assert(a->>'error'='capacity_busy','service full-cap denial');
 PERFORM pg_temp.review_assert((SELECT count(*)=1 AND bool_and(state='reserved' AND charged AND finished_at IS NULL) FROM concierge_private.requests),
  'full-cap handler rolls back opportunistic expiry and quota refund');
 PERFORM pg_temp.review_assert((SELECT count(*)=before_convos FROM public.host_conversations),'full-cap handler rolls back conversation');
END $$;
RESET ROLE;
UPDATE concierge_private.policy SET max_retained_requests=NULL;
SET LOCAL ROLE service_role;
DO $$ DECLARE id uuid:=test_fixture.request_id(); a jsonb; r concierge_private.requests; BEGIN
 a:=public.concierge_admit_v1(NULL,'review-new-null',id,test_fixture.payload(id),'anonymous');
 PERFORM pg_temp.review_assert(a->>'error'='policy_unavailable','service NULL-cap denial');
 PERFORM pg_temp.review_assert((SELECT count(*)=1 AND bool_and(state='reserved' AND charged AND finished_at IS NULL) FROM concierge_private.requests),
  'NULL-cap handler rolls back opportunistic expiry and quota refund');
 SELECT * INTO r FROM concierge_private.requests;
 a:=public.concierge_admit_v1(NULL,'review-expiry',r.request_id,r.payload,'anonymous');
 PERFORM pg_temp.review_assert(a->>'state'='cancelled' AND a->>'admitted'='false' AND NOT a?'owner_token',
  'same-ID expiry recovery at NULL cap safely refunds without capability');
END $$;
RESET ROLE;
ROLLBACK TO expiry_rollback;
SAVEPOINT null_recovery;
SET LOCAL ROLE service_role;
DO $$ DECLARE id uuid:=test_fixture.request_id(); a jsonb; BEGIN
 a:=public.concierge_admit_v1(NULL,'review-null-active',id,test_fixture.payload(id),'anonymous');
 PERFORM pg_temp.review_assert(a->>'admitted'='true','service seed for NULL-cap recovery');
END $$;
RESET ROLE;
UPDATE concierge_private.policy SET max_retained_requests=NULL;
SET LOCAL ROLE service_role;
DO $$ DECLARE r concierge_private.requests; a jsonb; BEGIN
 SELECT * INTO r FROM concierge_private.requests;
 a:=public.concierge_admit_v1(NULL,'review-null-active',r.request_id,r.payload,'anonymous');
 PERFORM pg_temp.review_assert(a->>'state'='reserved' AND a->>'admitted'='false' AND NOT a?'owner_token',
  'NULL cap permits reserved recovery without another owner token');
 PERFORM public.concierge_dispatch_v1(r.requester,r.request_id,r.owner_token);
 a:=public.concierge_finish_v1(r.requester,r.request_id,r.owner_token,'no_dispatch');
 PERFORM pg_temp.review_assert(a->>'error'='invalid_state' AND (SELECT state='dispatching' AND charged FROM concierge_private.requests),
  'NULL cap never refunds an already marked dispatch');
 PERFORM public.concierge_finish_v1(r.requester,r.request_id,r.owner_token,'uncertain');
 a:=public.concierge_complete_v1(r.requester,r.request_id,r.owner_token,'hello','review reply',true);
 PERFORM pg_temp.review_assert(a->>'state'='completed','NULL cap permits evidence-based completion');
 a:=public.concierge_admit_v1(NULL,'review-null-active',r.request_id,r.payload,'anonymous');
 PERFORM pg_temp.review_assert(a->>'state'='completed' AND a#>>'{response,message}'='review reply',
  'NULL cap permits completed cached replay');
END $$;
RESET ROLE;
ROLLBACK TO null_recovery;
SAVEPOINT direct_sql_paths;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
  WITH one AS (
   INSERT INTO concierge_private.requests(requester,request_id,redacted,state,charged,admitted_at,lease_until,finished_at,tombstone_retention_seconds,owner_token,user_message_id,assistant_message_id,reserved_cost_microusd)
   VALUES('s:review-cte-one',gen_random_uuid(),true,'cancelled',false,clock_timestamp(),clock_timestamp()+interval '1 minute',clock_timestamp(),86400,NULL,NULL,NULL,10) RETURNING requester
  )
  INSERT INTO concierge_private.requests(requester,request_id,redacted,state,charged,admitted_at,lease_until,finished_at,tombstone_retention_seconds,owner_token,user_message_id,assistant_message_id,reserved_cost_microusd)
  SELECT 's:review-cte-two',gen_random_uuid(),true,'cancelled',false,clock_timestamp(),clock_timestamp()+interval '1 minute',clock_timestamp(),86400,NULL,NULL,NULL,10 FROM one;
  RAISE EXCEPTION 'CTE unexpectedly exceeded ceiling';
 EXCEPTION WHEN SQLSTATE 'PCB02' THEN NULL; END;
 PERFORM pg_temp.review_assert(NOT EXISTS(SELECT FROM concierge_private.requests),'data-modifying CTE sees earlier insert and rolls back both');
 MERGE INTO concierge_private.requests AS r
 USING (SELECT 's:review-merge-'||g AS requester,gen_random_uuid() AS id FROM generate_series(1,1) g) AS s ON r.requester=s.requester
 WHEN NOT MATCHED THEN INSERT(requester,request_id,redacted,state,charged,admitted_at,lease_until,finished_at,tombstone_retention_seconds,owner_token,user_message_id,assistant_message_id,reserved_cost_microusd)
 VALUES(s.requester,s.id,true,'cancelled',false,clock_timestamp(),clock_timestamp()+interval '1 minute',clock_timestamp(),86400,NULL,NULL,NULL,10);
 PERFORM pg_temp.review_assert((SELECT count(*)=1 FROM concierge_private.requests),'MERGE INSERT can take final slot');
 BEGIN
  -- Explicit legacy columns: the database alone allocates the new scan identity.
  INSERT INTO concierge_private.requests(requester,request_id,redacted,state,charged,admitted_at,lease_until,finished_at,tombstone_retention_seconds,owner_token,user_message_id,assistant_message_id,reserved_cost_microusd) SELECT requester,request_id,redacted,state,charged,admitted_at,lease_until,finished_at,tombstone_retention_seconds,owner_token,user_message_id,assistant_message_id,reserved_cost_microusd FROM concierge_private.requests ON CONFLICT DO NOTHING;
  RAISE EXCEPTION 'full duplicate UPSERT unexpectedly bypassed insert trigger';
 EXCEPTION WHEN SQLSTATE 'PCB02' THEN NULL; END;
 PERFORM pg_temp.review_assert((SELECT count(*)=1 FROM concierge_private.requests),'direct duplicate UPSERT is conservatively rejected at ceiling');
END $$;
RESET ROLE;
ROLLBACK TO direct_sql_paths;
ROLLBACK;
