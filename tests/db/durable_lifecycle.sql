-- Disposable synthetic PostgreSQL ONLY, after bootstrap and the candidate.
-- Every change, including synthetic pruning, rolls back. Not a production job.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.key_at(ms bigint) RETURNS uuid LANGUAGE sql AS $$
 SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-7'||substr(randomness,14,3)||'-8'||substr(randomness,18,3)||'-'||substr(randomness,21,12))::uuid
 FROM (SELECT lpad(to_hex(ms),12,'0') h,replace(gen_random_uuid()::text,'-','') randomness) x
$$;
CREATE FUNCTION pg_temp.body(rid uuid,msg text DEFAULT 'synthetic lifecycle') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('version',2,'issued_at',concierge_private.issued_at_v2(rid),'host','ginger',
 'message',msg,'conversation_id',NULL,'surface','web-chat','room_id',NULL)
$$;
CREATE FUNCTION pg_temp.receipt() RETURNS jsonb LANGUAGE sql AS $$
 SELECT '{"request_id":"req_synthetic","message_id":"msg_synthetic","input_tokens":12,"output_tokens":3}'::jsonb
$$;
SELECT pg_temp.assert_true((SELECT content_retention_seconds IS NULL AND replay_max_age_seconds IS NULL
 AND max_future_skew_seconds IS NULL AND retention_seconds IS NULL AND NOT enabled FROM concierge_private.policy),'no approved lifecycle defaults');
SELECT pg_temp.assert_true(concierge_private.maintain_v1(10)->>'error'='policy_unavailable','unconfigured cleanup fail closed');
SELECT pg_temp.assert_true(concierge_private.maintain_v1(NULL)->>'error'='invalid_batch_limit','null cleanup limit denied');
SELECT pg_temp.assert_true(concierge_private.maintain_v1(0)->>'error'='invalid_batch_limit','zero cleanup limit denied');
SELECT pg_temp.assert_true(concierge_private.maintain_v1(1001)->>'error'='invalid_batch_limit','large cleanup limit denied');
UPDATE concierge_private.policy SET enabled=true,version='synthetic-lifecycle-only',global_inflight=20,global_admissions=100,
 global_window_seconds=86400,global_budget_microusd=10000,max_request_cost_microusd=10,max_prompt_bytes=48000,
 max_input_messages=61,max_output_tokens=512,max_reply_chars=16384,lease_seconds=60,
 legacy_cutoff=clock_timestamp()-interval '1 second',legacy_drained=true,charged_failures_approved=true,
 retention_seconds=86400,content_retention_seconds=3600,replay_max_age_seconds=3600,max_future_skew_seconds=60;

-- Exact clock boundaries, payload/key binding and legacy missing keys.
DO $$
DECLARE t timestamptz:=clock_timestamp(); ms bigint:=floor(extract(epoch FROM t)*1000)::bigint;
 p concierge_private.policy; rid uuid; a jsonb; b jsonb;
BEGIN
 SELECT * INTO p FROM concierge_private.policy WHERE singleton;
 rid:=pg_temp.key_at(ms-3600000);
 PERFORM pg_temp.assert_true(concierge_private.missing_error_v2(rid,pg_temp.body(rid),p,t)='request_expired','inclusive age boundary rejected');
 rid:=pg_temp.key_at(ms-3599999);
 PERFORM pg_temp.assert_true(concierge_private.missing_error_v2(rid,pg_temp.body(rid),p,t) IS NULL,'one ms inside age boundary accepted');
 rid:=pg_temp.key_at(ms+60000);
 PERFORM pg_temp.assert_true(concierge_private.missing_error_v2(rid,pg_temp.body(rid),p,t) IS NULL,'future skew boundary accepted');
 rid:=pg_temp.key_at(ms+60001);
 PERFORM pg_temp.assert_true(concierge_private.missing_error_v2(rid,pg_temp.body(rid),p,t)='invalid_request','one ms outside skew rejected');
 rid:=pg_temp.key_at(ms);
 a:=public.concierge_status_v1(NULL,'lifecycle-missing',rid,pg_temp.body(rid));
 PERFORM pg_temp.assert_true(a->>'error'='request_missing' AND a->>'recovery_required'='true','DB alone grants eligible missing recovery');
 b:=pg_temp.body(rid)||jsonb_build_object('issued_at',ms+1);
 PERFORM pg_temp.assert_true(public.concierge_status_v1(NULL,'lifecycle-missing',rid,b)->>'error'='invalid_request','timestamp cannot be changed independently of key');
 PERFORM pg_temp.assert_true(public.concierge_admit_v1(NULL,'lifecycle-missing',rid,b,'anonymous')->>'error'='invalid_request','admit rejects mismatched issuance');
 b:=(pg_temp.body(rid)-'issued_at')||'{"version":1}';
 PERFORM pg_temp.assert_true(public.concierge_status_v1(NULL,'lifecycle-legacy',rid,b)->>'error'='request_expired','legacy missing status never grants replay');
 PERFORM pg_temp.assert_true(public.concierge_admit_v1(NULL,'lifecycle-legacy',rid,b,'anonymous')->>'error'='request_expired','legacy missing admission never recreates key');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM concierge_private.requests),'invalid/missing reads create no rows');
END $$;

-- Age-only expiry is reversible until the owner commits the rejection floor.
-- Status must not grant a terminal clear or mutate data merely because time passed.
SAVEPOINT age_only_case;
DO $$
DECLARE ms bigint:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 rid uuid; a jsonb; p concierge_private.policy; before_floor bigint;
BEGIN
 rid:=pg_temp.key_at(ms-7200000);
 SELECT reject_before_ms INTO before_floor FROM concierge_private.lifecycle WHERE singleton;
 a:=public.concierge_status_v1(NULL,'lifecycle-age-only',rid,pg_temp.body(rid));
 PERFORM pg_temp.assert_true(a->>'error'='request_expired' AND NOT a?'terminal','age-only expiry never promises irreversible closure');
 PERFORM pg_temp.assert_true((SELECT reject_before_ms=before_floor FROM concierge_private.lifecycle),'status never mutates replay floor');
 a:=public.concierge_admit_v1(NULL,'lifecycle-age-only',rid,pg_temp.body(rid),'anonymous');
 PERFORM pg_temp.assert_true(a->>'error'='request_expired' AND NOT a?'terminal','age-only admission denial is not a clear promise');
 SELECT * INTO p FROM concierge_private.policy WHERE singleton;
 PERFORM pg_temp.assert_true(concierge_private.missing_error_v2(rid,pg_temp.body(rid),p,to_timestamp((ms-7200000)::double precision/1000)) IS NULL,'backwards DB clock could make age-only key eligible');
 UPDATE concierge_private.policy SET replay_max_age_seconds=1000000;
 a:=public.concierge_status_v1(NULL,'lifecycle-age-only',rid,pg_temp.body(rid));
 PERFORM pg_temp.assert_true(a->>'error'='request_missing' AND a->>'recovery_required'='true','wider policy could make age-only key eligible');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM concierge_private.requests),'status and rejected admission do not create rows');
END $$;
ROLLBACK TO age_only_case;

-- Cached content expires independently of cleanup availability. Receipts are
-- bounded metadata, never prompts, credentials or free-form error content.
SAVEPOINT content_case;
DO $$
DECLARE rid uuid:=pg_temp.key_at(floor(extract(epoch FROM clock_timestamp())*1000)::bigint); a jsonb; b jsonb; token uuid;
BEGIN
 a:=public.concierge_admit_v1(NULL,'lifecycle-content',rid,pg_temp.body(rid),'anonymous'); token:=(a->>'owner_token')::uuid;
 PERFORM pg_temp.assert_true(a->>'admitted'='true','content fixture admitted');
 PERFORM public.concierge_dispatch_v1(a->>'requester',rid,token);
 b:=public.concierge_complete_v1(a->>'requester',rid,token,'synthetic lifecycle','synthetic answer',true,pg_temp.receipt()||'{"prompt":"forbidden"}');
 PERFORM pg_temp.assert_true(b->>'error'='invalid_receipt','extra receipt content rejected');
 PERFORM pg_temp.assert_true(concierge_private.valid_receipt_v1(NULL),'missing receipt safe');
 PERFORM pg_temp.assert_true(NOT concierge_private.valid_receipt_v1(pg_temp.receipt()||'{"request_id":"bad\nidentifier"}'),'control characters rejected');
 PERFORM pg_temp.assert_true(NOT concierge_private.valid_receipt_v1(pg_temp.receipt()||'{"input_tokens":-1}'),'negative token usage rejected');
 PERFORM pg_temp.assert_true(NOT concierge_private.valid_receipt_v1(pg_temp.receipt()||'{"output_tokens":1.5}'),'fractional token usage rejected');
 PERFORM pg_temp.assert_true(NOT concierge_private.valid_receipt_v1(pg_temp.receipt()||'{"input_tokens":2147483648}'),'oversized token usage rejected');
 b:=public.concierge_complete_v1(a->>'requester',rid,token,'synthetic lifecycle','synthetic answer',true,pg_temp.receipt());
 PERFORM pg_temp.assert_true(b->>'state'='completed','receipt completion succeeds');
 PERFORM pg_temp.assert_true((SELECT provider_receipt=pg_temp.receipt() FROM concierge_private.requests WHERE request_id=rid),'receipt stored without text');
 PERFORM pg_temp.assert_true(public.concierge_finish_v1(a->>'requester',rid,token,'provider_terminal_failure')->>'state'='completed','late failure cannot downgrade committed success');
 BEGIN
  UPDATE concierge_private.requests SET issued_at=issued_at+1 WHERE request_id=rid;
  RAISE EXCEPTION 'issuance changed';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 UPDATE concierge_private.requests SET content_expires_at=clock_timestamp()-interval '1 second' WHERE request_id=rid;
 PERFORM pg_temp.assert_true(public.concierge_status_v1(NULL,'lifecycle-content',rid,pg_temp.body(rid))->>'error'='gone','delayed cleanup cannot serve expired content');
 b:=public.concierge_admit_v1(NULL,'lifecycle-content',rid,pg_temp.body(rid),'anonymous');
 PERFORM pg_temp.assert_true(b->>'error'='gone' AND b->>'terminal'='true','terminal expired cache safely clears client without new admission');
 b:=concierge_private.maintain_v1(1);
 PERFORM pg_temp.assert_true(b->>'processed'='1' AND b->>'redacted'='1' AND b->>'compacted'='1' AND b->>'pruned'='0','bounded content cleanup compacts but retains accounting');
 PERFORM pg_temp.assert_true((SELECT redacted AND charged AND response IS NULL AND payload IS NULL AND fingerprint IS NULL
   AND provider_receipt IS NULL AND user_id IS NULL AND session_id IS NULL AND owner_token IS NULL
   AND conversation_id IS NULL AND user_message_id IS NULL AND assistant_message_id IS NULL
   FROM concierge_private.requests WHERE request_id=rid),'minimal tombstone contains no content, receipt or redundant identity');
 PERFORM pg_temp.assert_true((SELECT count(*)=2 FROM public.host_messages WHERE conversation_id=(a->>'conversation_id')::uuid),'ledger retention does not rewrite member conversation history');
END $$;
ROLLBACK TO content_case;

-- Eligible final pruning, timestamp refresh attack and later policy enlargement.
SAVEPOINT prune_case;
DO $$
DECLARE rid uuid:=pg_temp.key_at(floor(extract(epoch FROM clock_timestamp()-interval '4 days')*1000)::bigint); a jsonb;b jsonb;floor_ms bigint;
BEGIN
 UPDATE concierge_private.policy SET replay_max_age_seconds=1000000;
 a:=public.concierge_admit_v1(NULL,'lifecycle-prune',rid,pg_temp.body(rid),'anonymous');
 PERFORM pg_temp.assert_true(a->>'admitted'='true','historical fixture admitted under synthetic wider policy');
 PERFORM public.concierge_complete_v1(a->>'requester',rid,(a->>'owner_token')::uuid,'synthetic lifecycle','synthetic answer',false);
 UPDATE concierge_private.requests SET admitted_at=clock_timestamp()-interval '4 days',lease_until=clock_timestamp()-interval '4 days'+interval '60 seconds',
  finished_at=clock_timestamp()-interval '3 days',content_expires_at=clock_timestamp()-interval '3 days' WHERE request_id=rid;
 UPDATE concierge_private.policy SET replay_max_age_seconds=3600;
 b:=concierge_private.maintain_v1(1);
 PERFORM pg_temp.assert_true(b->>'pruned'='1' AND NOT EXISTS(SELECT 1 FROM concierge_private.requests WHERE request_id=rid),'terminal safely outside accounting and retry horizon pruned');
 SELECT reject_before_ms INTO floor_ms FROM concierge_private.lifecycle WHERE singleton;
 PERFORM pg_temp.assert_true(floor_ms>=concierge_private.issued_at_v2(rid),'floor covers pruned key');
 b:=public.concierge_status_v1(NULL,'lifecycle-prune',rid,pg_temp.body(rid));
 PERFORM pg_temp.assert_true(b->>'error'='request_expired' AND b->>'terminal'='true' AND NOT b?'recovery_required','pruned key cannot recover');
 b:=pg_temp.body(rid)||jsonb_build_object('issued_at',floor(extract(epoch FROM clock_timestamp())*1000)::bigint);
 PERFORM pg_temp.assert_true(public.concierge_admit_v1(NULL,'lifecycle-prune',rid,b,'anonymous')->>'error'='invalid_request','refreshed body cannot revive old key');
 UPDATE concierge_private.policy SET replay_max_age_seconds=3155760000;
 PERFORM pg_temp.assert_true(public.concierge_admit_v1(NULL,'lifecycle-prune',rid,pg_temp.body(rid),'anonymous')->>'error'='request_expired','policy expansion cannot revive a pruned key');
 PERFORM concierge_private.maintain_v1(1);
 PERFORM pg_temp.assert_true((SELECT reject_before_ms>=floor_ms FROM concierge_private.lifecycle),'cleanup cannot move floor backward');
 BEGIN
  UPDATE concierge_private.lifecycle SET reject_before_ms=0;
  RAISE EXCEPTION 'floor decreased';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
  DELETE FROM concierge_private.lifecycle;
  RAISE EXCEPTION 'floor deleted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;
ROLLBACK TO prune_case;

-- Keep accounting even when UUID issuance is old, and keep terminal evidence
-- through the agreed retention duration measured from completion, not issuance.
SAVEPOINT accounting_case;
DO $$
DECLARE rid uuid:=pg_temp.key_at(floor(extract(epoch FROM clock_timestamp()-interval '4 days')*1000)::bigint); a jsonb;b jsonb;
BEGIN
 UPDATE concierge_private.policy SET replay_max_age_seconds=1000000;
 a:=public.concierge_admit_v1(NULL,'lifecycle-accounting',rid,pg_temp.body(rid),'anonymous');
 PERFORM public.concierge_complete_v1(a->>'requester',rid,(a->>'owner_token')::uuid,'synthetic lifecycle','synthetic answer',false);
 UPDATE concierge_private.requests SET finished_at=clock_timestamp()-interval '3 days',content_expires_at=clock_timestamp()-interval '1 second' WHERE request_id=rid;
 UPDATE concierge_private.policy SET replay_max_age_seconds=3600;
 b:=concierge_private.maintain_v1(10);
 PERFORM pg_temp.assert_true(b->>'pruned'='0' AND (SELECT charged FROM concierge_private.requests WHERE request_id=rid),'active rolling accounting cannot be pruned');
 UPDATE concierge_private.requests SET admitted_at=clock_timestamp()-interval '4 days',lease_until=clock_timestamp()-interval '4 days'+interval '60 seconds',finished_at=clock_timestamp() WHERE request_id=rid;
 b:=concierge_private.maintain_v1(10);
 PERFORM pg_temp.assert_true(b->>'pruned'='0' AND EXISTS(SELECT 1 FROM concierge_private.requests WHERE request_id=rid),'newly terminal evidence retains full terminal horizon');
END $$;
ROLLBACK TO accounting_case;

-- Unknown dispatched work is redacted and explicitly quarantined, never timed
-- out/refunded/pruned. Terminal evidence may still close a redacted request.
SAVEPOINT quarantine_case;
DO $$
DECLARE rid uuid:=pg_temp.key_at(floor(extract(epoch FROM clock_timestamp()-interval '4 days')*1000)::bigint); a jsonb;b jsonb;
BEGIN
 UPDATE concierge_private.policy SET replay_max_age_seconds=1000000;
 a:=public.concierge_admit_v1(NULL,'lifecycle-quarantine',rid,pg_temp.body(rid),'anonymous');
 PERFORM public.concierge_dispatch_v1(a->>'requester',rid,(a->>'owner_token')::uuid);
 UPDATE concierge_private.requests SET admitted_at=clock_timestamp()-interval '4 days',lease_until=clock_timestamp()-interval '4 days'+interval '60 seconds',content_expires_at=clock_timestamp()-interval '3 days' WHERE request_id=rid;
 UPDATE concierge_private.policy SET replay_max_age_seconds=3600;
 b:=concierge_private.maintain_v1(10);
 PERFORM pg_temp.assert_true(b->>'quarantined'='1' AND b->>'pruned'='0','unknown quarantined not purged');
 PERFORM pg_temp.assert_true((SELECT state='uncertain' AND charged AND redacted AND quarantined_at IS NOT NULL
  AND owner_token IS NOT NULL AND payload IS NULL AND response IS NULL FROM concierge_private.requests WHERE request_id=rid),'unknown holds charge and capacity with no content');
 PERFORM pg_temp.assert_true(public.concierge_admit_v1(NULL,'lifecycle-quarantine',test_fixture.request_id(),pg_temp.body(test_fixture.request_id()),'anonymous')->>'error'='capacity_busy','quarantined unknown blocks new requester work');
 b:=public.concierge_status_v1(NULL,'lifecycle-quarantine',rid,pg_temp.body(rid));
 PERFORM pg_temp.assert_true(b->>'error'='gone' AND NOT b?'terminal','redacted unknown never grants safe client clear');
 PERFORM pg_temp.assert_true(public.concierge_finish_v1(a->>'requester',rid,(a->>'owner_token')::uuid,'no_dispatch')->>'error'='invalid_state','unknown never refunded');
 PERFORM pg_temp.assert_true(public.concierge_finish_v1(a->>'requester',rid,(a->>'owner_token')::uuid,'provider_terminal_failure',pg_temp.receipt())->>'state'='failed','evidence can close quarantined request');
 PERFORM pg_temp.assert_true((SELECT charged AND provider_receipt IS NULL FROM concierge_private.requests WHERE request_id=rid),'redacted receipt never resurrected');
 b:=public.concierge_status_v1(NULL,'lifecycle-quarantine',rid,pg_temp.body(rid));
 PERFORM pg_temp.assert_true(b->>'error'='gone' AND b->>'terminal'='true','redacted terminal evidence permits safe client clear');
END $$;
ROLLBACK TO quarantine_case;

-- Mutation bound and lease safety, with no unbounded catch-up in a single call.
SAVEPOINT batch_case;
DO $$
DECLARE a jsonb;b jsonb;rid uuid;i integer;
BEGIN
 FOR i IN 1..3 LOOP
  rid:=test_fixture.request_id();
  a:=public.concierge_admit_v1(NULL,'lifecycle-batch-'||i,rid,pg_temp.body(rid),'anonymous');
 END LOOP;
 UPDATE concierge_private.requests SET admitted_at=clock_timestamp()-interval '2 minutes',lease_until=clock_timestamp()-interval '1 minute' WHERE requester LIKE 's:lifecycle-batch-%';
 b:=concierge_private.maintain_v1(1);
 PERFORM pg_temp.assert_true(b->>'processed'='1' AND b->>'cancelled'='1','batch limit bounds every row mutation');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM concierge_private.requests WHERE state='cancelled' AND NOT charged),'only one undispatched refund');
 PERFORM pg_temp.assert_true((SELECT count(*)=2 FROM concierge_private.requests WHERE state='reserved' AND charged),'remaining batch deferred safely');
END $$;
ROLLBACK TO batch_case;

-- The function owner retains ordinary owner powers. Runtime service, anonymous
-- and authenticated roles receive no purge or floor-reset capability.
SELECT pg_temp.assert_true(NOT has_function_privilege('service_role','concierge_private.maintain_v1(integer)','EXECUTE'),'service cleanup execute revoked');
SELECT pg_temp.assert_true(NOT has_table_privilege('service_role','concierge_private.requests','DELETE'),'service cannot delete keys');
SELECT pg_temp.assert_true(NOT has_table_privilege('service_role','concierge_private.lifecycle','UPDATE'),'service cannot reset rejection floor');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','concierge_private.lifecycle','SELECT'),'client cannot read private floor');
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
  PERFORM concierge_private.maintain_v1(1);
  RAISE EXCEPTION 'service cleanup unexpectedly ran';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
