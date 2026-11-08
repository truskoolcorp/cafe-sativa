-- Disposable synthetic fixtures only. Every state change rolls back.
BEGIN;
CREATE FUNCTION pg_temp.check_true(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
 RAISE NOTICE 'PASS: %',label;
END $$;
CREATE FUNCTION pg_temp.key_at(ms bigint DEFAULT floor(extract(epoch FROM clock_timestamp())*1000)::bigint)
RETURNS uuid LANGUAGE sql AS $$
 SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-7'||substr(r,14,3)||'-8'||substr(r,18,3)||'-'||substr(r,21,12))::uuid
 FROM (SELECT lpad(to_hex(ms),12,'0') h,replace(gen_random_uuid()::text,'-','') r) x
$$;
CREATE FUNCTION pg_temp.body(id uuid,msg text DEFAULT 'synthetic backlog') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('version',2,'issued_at',concierge_private.issued_at_v2(id),'host','ginger',
 'message',msg,'conversation_id',NULL,'surface','web-chat','room_id',NULL)
$$;
CREATE FUNCTION pg_temp.insert_direct(n integer, prefix text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO concierge_private.requests(requester,request_id,redacted,state,charged,admitted_at,lease_until,
 finished_at,tombstone_retention_seconds,owner_token,user_message_id,assistant_message_id,reserved_cost_microusd)
 SELECT 's:'||prefix||g,gen_random_uuid(),true,'cancelled',false,clock_timestamp(),clock_timestamp()+interval '1 minute',
 clock_timestamp(),86400,NULL,NULL,NULL,10 FROM generate_series(1,n) g
$$;
SELECT pg_temp.check_true((SELECT max_retained_requests IS NULL FROM concierge_private.policy),'no production ceiling default');
UPDATE concierge_private.policy SET enabled=true,version='synthetic-backlog-test',global_inflight=100,global_admissions=1000,
 global_window_seconds=86400,global_budget_microusd=100000,max_request_cost_microusd=10,max_prompt_bytes=48000,
 max_input_messages=61,max_output_tokens=512,max_reply_chars=16384,lease_seconds=60,
 legacy_cutoff=clock_timestamp()-interval '1 second',legacy_drained=true,charged_failures_approved=true,
 retention_seconds=86400,content_retention_seconds=3600,replay_max_age_seconds=3600,max_future_skew_seconds=60;
DO $$ DECLARE id uuid:=pg_temp.key_at(); a jsonb; BEGIN
 a:=public.concierge_admit_v1(NULL,'unconfigured',id,pg_temp.body(id),'anonymous');
 PERFORM pg_temp.check_true(a->>'error'='policy_unavailable','NULL ceiling fails closed through existing RPC code');
 PERFORM pg_temp.check_true(NOT EXISTS(SELECT FROM concierge_private.requests)
  AND NOT EXISTS(SELECT FROM public.host_conversations),'failed admission rolls back all new request and conversation writes');
 BEGIN PERFORM pg_temp.insert_direct(1,'null-'); RAISE EXCEPTION 'unexpected direct insert';
 EXCEPTION WHEN SQLSTATE 'PCB01' THEN NULL; END;
 PERFORM pg_temp.check_true(NOT EXISTS(SELECT FROM concierge_private.requests),'direct insert cannot bypass NULL ceiling');
END $$;
SAVEPOINT cancellations;
UPDATE concierge_private.policy SET max_retained_requests=3;
DO $$ DECLARE id uuid; a jsonb; b jsonb; retained_id uuid; before_convos bigint; BEGIN
 FOR i IN 1..3 LOOP
  id:=pg_temp.key_at(); retained_id:=id;
  a:=public.concierge_admit_v1(NULL,'cancel-loop',id,pg_temp.body(id),'anonymous');
  PERFORM pg_temp.check_true(a->>'admitted'='true' AND a->>'remaining'='9','fresh cancellation-cycle admission preserves quota');
  b:=public.concierge_finish_v1(a->>'requester',id,(a->>'owner_token')::uuid,'no_dispatch');
  PERFORM pg_temp.check_true(b->>'state'='cancelled','undispatched work remains refundable');
 END LOOP;
 PERFORM pg_temp.check_true((SELECT count(*)=3 AND count(*) FILTER(WHERE charged)=0
  AND coalesce(sum(reserved_cost_microusd) FILTER(WHERE charged),0)=0 FROM concierge_private.requests),
  'cancelled rows consume storage slots but no quota or conservative spend');
 b:=public.concierge_admit_v1(NULL,'cancel-loop',retained_id,pg_temp.body(retained_id),'anonymous');
 PERFORM pg_temp.check_true(b->>'state'='cancelled' AND b->>'admitted'='false' AND NOT b?'owner_token',
  'same-ID replay at full capacity never creates a row or issues dispatch capability');
 b:=public.concierge_admit_v1(NULL,'cancel-loop',retained_id,pg_temp.body(retained_id,'changed'),'anonymous');
 PERFORM pg_temp.check_true(b->>'error'='conflict','payload conflict precedes full-capacity denial');
 SELECT count(*) INTO before_convos FROM public.host_conversations;
 id:=pg_temp.key_at(); a:=public.concierge_admit_v1(NULL,'new-at-full',id,pg_temp.body(id),'anonymous');
 PERFORM pg_temp.check_true(a->>'error'='capacity_busy' AND NOT a?'owner_token','new unique ID denied at exact ceiling');
 PERFORM pg_temp.check_true((SELECT count(*)=3 FROM concierge_private.requests)
  AND (SELECT count(*)=before_convos FROM public.host_conversations),'full-capacity failure creates no ledger row or orphan conversation');
 b:=public.concierge_status_v1(NULL,'new-at-full',id,pg_temp.body(id));
 PERFORM pg_temp.check_true(b->>'error'='request_missing' AND b->>'recovery_required'='true','status of never-admitted key is safe same-ID recovery, not reservation');
 UPDATE concierge_private.policy SET enabled=false,max_retained_requests=NULL;
 b:=public.concierge_admit_v1(NULL,'cancel-loop',retained_id,pg_temp.body(retained_id),'anonymous');
 PERFORM pg_temp.check_true(b->>'state'='cancelled','retained lookup works while disabled and new bound unconfigured');
 UPDATE concierge_private.policy SET enabled=true,max_retained_requests=2;
 a:=public.concierge_admit_v1(NULL,'lowered',id,pg_temp.body(id),'anonymous');
 PERFORM pg_temp.check_true(a->>'error'='capacity_busy' AND (SELECT count(*)=3 FROM concierge_private.requests),'lowering below existing occupancy denies insertion without evicting evidence');
END $$;
ROLLBACK TO cancellations;
SAVEPOINT direct_writers;
UPDATE concierge_private.policy SET max_retained_requests=3;
SELECT pg_temp.insert_direct(2,'direct-initial-');
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM pg_temp.insert_direct(2,'direct-batch-'); RAISE EXCEPTION 'unexpected batch success';
 EXCEPTION WHEN SQLSTATE 'PCB02' THEN NULL; END;
 PERFORM pg_temp.check_true((SELECT count(*)=2 FROM concierge_private.requests),'multi-row direct service INSERT counts prior rows and rolls back entire overfull batch');
 PERFORM pg_temp.insert_direct(1,'direct-last-');
 PERFORM pg_temp.check_true((SELECT count(*)=3 FROM concierge_private.requests),'direct service insertion can take exactly one final slot');
 BEGIN PERFORM pg_temp.insert_direct(1,'direct-over-'); RAISE EXCEPTION 'unexpected overfull insert';
 EXCEPTION WHEN SQLSTATE 'PCB02' THEN NULL; END;
 PERFORM pg_temp.check_true((SELECT count(*)=3 FROM concierge_private.requests),'direct service insertion cannot exceed ceiling');
 BEGIN UPDATE concierge_private.policy SET max_retained_requests=4; RAISE EXCEPTION 'unexpected policy write';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_temp.check_true(NOT has_function_privilege(current_user,'concierge_private.guard_request_backlog_v1()','EXECUTE'),
  'service trigger works without newly granted helper execution');
END $$;
RESET ROLE;
SELECT pg_temp.check_true(NOT has_schema_privilege('anon','concierge_private','USAGE')
 AND NOT has_schema_privilege('authenticated','concierge_private','USAGE')
 AND NOT has_function_privilege('anon','concierge_private.guard_request_backlog_v1()','EXECUTE')
 AND NOT has_function_privilege('authenticated','concierge_private.guard_request_backlog_v1()','EXECUTE')
 AND NOT has_function_privilege('supabase_auth_admin','concierge_private.guard_request_backlog_v1()','EXECUTE'),
 'no extra public, authenticated, service-helper, or Auth-admin privileges');
ROLLBACK TO direct_writers;
SAVEPOINT ordinary_recovery;
UPDATE concierge_private.policy SET max_retained_requests=1;
DO $$ DECLARE id uuid:=pg_temp.key_at(); other uuid:=pg_temp.key_at(); a jsonb; b jsonb; BEGIN
 a:=public.concierge_admit_v1(NULL,'active-full',id,pg_temp.body(id),'anonymous');
 b:=public.concierge_admit_v1(NULL,'active-full',id,pg_temp.body(id),'anonymous');
 PERFORM pg_temp.check_true(b->>'state'='reserved' AND b->>'admitted'='false','full ceiling permits active-key recovery without double admission');
 PERFORM public.concierge_dispatch_v1(a->>'requester',id,(a->>'owner_token')::uuid);
 b:=public.concierge_complete_v1(a->>'requester',id,(a->>'owner_token')::uuid,'synthetic backlog','synthetic reply',true);
 PERFORM pg_temp.check_true(b->>'state'='completed','full ceiling does not block completion');
 b:=public.concierge_admit_v1(NULL,'active-full',id,pg_temp.body(id),'anonymous');
 PERFORM pg_temp.check_true(b->>'state'='completed' AND b->>'admitted'='false' AND b#>>'{response,message}'='synthetic reply',
  'completed cache replay remains available at ceiling');
 PERFORM pg_temp.check_true(public.concierge_admit_v1(NULL,'blocked-new',other,pg_temp.body(other),'anonymous')->>'error'='capacity_busy',
  'completion does not free retained storage');
END $$;
ROLLBACK TO ordinary_recovery;
SAVEPOINT expired_recovery;
UPDATE concierge_private.policy SET max_retained_requests=1;
DO $$ DECLARE id uuid:=pg_temp.key_at(); fresh uuid:=pg_temp.key_at(); a jsonb; b jsonb; BEGIN
 a:=public.concierge_admit_v1(NULL,'expired-reserved',id,pg_temp.body(id),'anonymous');
 UPDATE concierge_private.requests SET admitted_at=clock_timestamp()-interval '2 minutes',lease_until=clock_timestamp()-interval '1 minute';
 b:=public.concierge_admit_v1(NULL,'expired-reserved',id,pg_temp.body(id),'anonymous');
 PERFORM pg_temp.check_true(b->>'state'='cancelled' AND b->>'admitted'='false'
  AND (SELECT count(*)=1 AND bool_and(NOT charged) FROM concierge_private.requests),
  'same-ID expired reservation refunds at capacity without another attempt or row');
 PERFORM pg_temp.check_true(public.concierge_admit_v1(NULL,'expired-reserved',fresh,pg_temp.body(fresh),'anonymous')->>'error'='capacity_busy',
  'expiry refund does not release the retained row slot');
END $$;
ROLLBACK TO expired_recovery;
SAVEPOINT cleanup;
UPDATE concierge_private.policy SET max_retained_requests=1,replay_max_age_seconds=1000000;
DO $$ DECLARE id uuid:=pg_temp.key_at(floor(extract(epoch FROM clock_timestamp()-interval '4 days')*1000)::bigint);
 fresh uuid:=pg_temp.key_at(); a jsonb; b jsonb; floor_value bigint; BEGIN
 a:=public.concierge_admit_v1(NULL,'old-terminal',id,pg_temp.body(id),'anonymous');
 PERFORM public.concierge_finish_v1(a->>'requester',id,(a->>'owner_token')::uuid,'no_dispatch');
 -- Deliberately age synthetic fixtures only; not an application writer proposal.
 UPDATE concierge_private.requests SET admitted_at=clock_timestamp()-interval '4 days',
  lease_until=clock_timestamp()-interval '4 days'+interval '1 minute',finished_at=clock_timestamp()-interval '3 days',
  content_expires_at=clock_timestamp()-interval '1 day';
 UPDATE concierge_private.policy SET replay_max_age_seconds=3600;
 b:=concierge_private.maintain_v1(1);
 PERFORM pg_temp.check_true(b->>'processed'='1' AND b->>'pruned'='1' AND NOT EXISTS(SELECT FROM concierge_private.requests),
  'only existing safe terminal cleanup frees a retained-row slot');
 SELECT reject_before_ms INTO floor_value FROM concierge_private.lifecycle;
 b:=public.concierge_admit_v1(NULL,'old-terminal',id,pg_temp.body(id),'anonymous');
 PERFORM pg_temp.check_true(b->>'error'='request_expired' AND b->>'terminal'='true','freed slot cannot revive a pruned key');
 UPDATE concierge_private.policy SET replay_max_age_seconds=1000000;
 b:=public.concierge_admit_v1(NULL,'old-terminal',id,pg_temp.body(id),'anonymous');
 PERFORM pg_temp.check_true(b->>'error'='request_expired' AND (SELECT reject_before_ms=floor_value FROM concierge_private.lifecycle),
  'later policy widening cannot undo rejection floor or recount old key');
 a:=public.concierge_admit_v1(NULL,'fresh-after-prune',fresh,pg_temp.body(fresh),'anonymous');
 PERFORM pg_temp.check_true(a->>'admitted'='true' AND (SELECT count(*)=1 FROM concierge_private.requests),'safe prune permits exactly one new retained row');
END $$;
ROLLBACK TO cleanup;
SAVEPOINT privacy_unknown;
UPDATE concierge_private.policy SET max_retained_requests=1;
INSERT INTO auth.users(id,email) VALUES('00112233-4455-6677-8899-aabbccddeeff','synthetic@example.invalid');
DO $$ DECLARE id uuid:=pg_temp.key_at(); a jsonb; b jsonb; BEGIN
 a:=public.concierge_admit_v1('00112233-4455-6677-8899-aabbccddeeff',NULL,id,pg_temp.body(id),'regular');
 PERFORM public.concierge_dispatch_v1(a->>'requester',id,(a->>'owner_token')::uuid);
END $$;
SET LOCAL ROLE supabase_auth_admin;
DELETE FROM auth.users WHERE id='00112233-4455-6677-8899-aabbccddeeff';
RESET ROLE;
SELECT pg_temp.check_true((SELECT count(*)=1 AND bool_and(redacted AND charged AND payload IS NULL AND response IS NULL)
 FROM concierge_private.requests),'actual Auth deletion redacts content without freeing accounting or storage');
DO $$ DECLARE fresh uuid:=pg_temp.key_at(); b jsonb; BEGIN
 UPDATE concierge_private.requests SET admitted_at=clock_timestamp()-interval '4 days',
  lease_until=clock_timestamp()-interval '4 days'+interval '1 minute',content_expires_at=clock_timestamp()-interval '1 day';
 b:=concierge_private.maintain_v1(1);
 PERFORM pg_temp.check_true(b->>'pruned'='0' AND (SELECT count(*)=1 AND bool_and(state='uncertain' AND charged) FROM concierge_private.requests),
  'old redacted unknown dispatch is never discarded to create space');
 PERFORM pg_temp.check_true(public.concierge_admit_v1(NULL,'after-privacy',fresh,pg_temp.body(fresh),'anonymous')->>'error'='capacity_busy',
  'privacy deletion cannot bypass the retained-row ceiling');
END $$;
ROLLBACK TO privacy_unknown;
ROLLBACK;
