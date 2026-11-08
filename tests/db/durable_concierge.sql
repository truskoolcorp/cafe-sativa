-- Synthetic-only sequential fixture. Run AFTER candidate migration in isolated DB.
-- All fixture changes roll back. Never run on production, even with ROLLBACK.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.payload(msg text DEFAULT 'hello',cid uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('version',1,'host','ginger','message',msg,'conversation_id',cid,'surface','web-chat','room_id',NULL)
$$;
DO $$
DECLARE a jsonb;b jsonb;c jsonb; k text;rid uuid:=gen_random_uuid();tok uuid;cid uuid;n integer;original_user uuid:=gen_random_uuid();
BEGIN
 PERFORM pg_temp.assert_true(public.concierge_admit_v1(NULL,'fixture-disabled',rid,pg_temp.payload(),'anonymous')->>'error'='policy_unavailable','default policy disabled');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM concierge_private.requests),'disabled creates no ledger');
 PERFORM pg_temp.assert_true(public.concierge_admit_v1(NULL,' bad',rid,pg_temp.payload(),'anonymous')->>'error'='invalid_request','session trim validation');
 PERFORM pg_temp.assert_true(public.concierge_admit_v1(NULL,'fixture',rid,pg_temp.payload(),'vip')->>'error'='invalid_request','guest cannot claim tier');
 PERFORM pg_temp.assert_true(public.concierge_admit_v1(NULL,'fixture',rid,pg_temp.payload()||'{"extra":1}','anonymous')->>'error'='invalid_request','unexpected payload key');
END $$;
UPDATE concierge_private.policy SET enabled=true,version='synthetic-only',global_inflight=20,global_admissions=100,
 global_window_seconds=86400,global_budget_microusd=10000,max_request_cost_microusd=10,max_prompt_bytes=48000,
 max_input_messages=61,max_output_tokens=512,max_reply_chars=16384,lease_seconds=60,
 legacy_cutoff=clock_timestamp()-interval '1 second',legacy_drained=true,charged_failures_approved=true,retention_seconds=86400;
DO $$
DECLARE a jsonb;b jsonb;c jsonb; k text;rid uuid:=gen_random_uuid();tok uuid;cid uuid;n integer;uid uuid:=gen_random_uuid();
BEGIN
 a:=public.concierge_admit_v1(NULL,'fixture-local',rid,pg_temp.payload(),'anonymous');
 PERFORM pg_temp.assert_true(a->>'admitted'='true' AND a->>'remaining'='9','new reservation and remaining');
 tok:=(a->>'owner_token')::uuid;cid:=(a->>'conversation_id')::uuid;k:=a->>'requester';
 b:=public.concierge_admit_v1(NULL,'fixture-local',rid,pg_temp.payload(),'anonymous');
 PERFORM pg_temp.assert_true(b->>'admitted'='false' AND NOT b?'owner_token','duplicate no capability');
 PERFORM pg_temp.assert_true(public.concierge_admit_v1(NULL,'fixture-local',rid,pg_temp.payload('different'),'anonymous')->>'error'='conflict','payload conflict');
 PERFORM pg_temp.assert_true(public.concierge_admit_v1(NULL,'fixture-local',gen_random_uuid(),pg_temp.payload(),'anonymous')->>'error'='capacity_busy','requester inflight=1');
 PERFORM pg_temp.assert_true(public.concierge_status_v1(NULL,'fixture-other',rid,pg_temp.payload())->>'error'='request_missing','identity namespace');
 PERFORM pg_temp.assert_true(public.concierge_complete_v1(k,rid,gen_random_uuid(),'hello','world',false)->>'error'='invalid_token','token fence');
 PERFORM pg_temp.assert_true(public.concierge_complete_v1(k,rid,tok,'hello','world',true)->>'error'='invalid_state','provider must have dispatch mark');
 BEGIN
  UPDATE public.host_conversations SET ended_at=clock_timestamp() WHERE id=cid;
  RAISE EXCEPTION 'mutation guard did not reject';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
  INSERT INTO public.host_messages(conversation_id,role,content) VALUES(cid,'user','uncoordinated voice');
  RAISE EXCEPTION 'message guard did not reject';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 a:=public.concierge_complete_v1(k,rid,tok,'hello','world',false);
 PERFORM pg_temp.assert_true(a->>'state'='completed' AND a->'response'->>'memory_saved'='true','atomic local completion');
 BEGIN
  UPDATE public.host_messages SET conversation_id=gen_random_uuid() WHERE conversation_id=cid;
  RAISE EXCEPTION 'message move guard did not reject';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 b:=public.concierge_complete_v1(k,rid,tok,'changed','changed',false);
 PERFORM pg_temp.assert_true(a=b,'completion retry returns original response');
 SELECT count(*) INTO n FROM public.host_messages WHERE conversation_id=cid;
 PERFORM pg_temp.assert_true(n=2,'exactly two inserts');
 PERFORM pg_temp.assert_true((SELECT min(created_at)<max(created_at) FROM public.host_messages WHERE conversation_id=cid),'strictly ordered pair');
 UPDATE public.host_conversations SET ended_at=clock_timestamp() WHERE id=cid;
 PERFORM pg_temp.assert_true(public.concierge_status_v1(NULL,'fixture-local',rid,pg_temp.payload())->>'state'='completed','ended cache allowed');
 INSERT INTO public.profiles(id) VALUES(uid);
 UPDATE public.host_conversations SET user_id=uid WHERE id=cid;
 PERFORM pg_temp.assert_true(public.concierge_status_v1(NULL,'fixture-local',rid,pg_temp.payload())->>'error'='forbidden','cache ownership recheck');
 PERFORM pg_temp.assert_true(public.concierge_complete_v1(k,rid,tok,'hello','world',false)->>'error'='forbidden','complete cache ownership recheck');
 b:=public.concierge_admit_v1(NULL,'fixture-local',rid,pg_temp.payload(),'anonymous');
 PERFORM pg_temp.assert_true(b->>'error'='forbidden' AND NOT b?'admitted','existing-key ownership failure retains admission ambiguity');
 PERFORM pg_temp.assert_true((SELECT state='completed' AND charged FROM concierge_private.requests WHERE requester=k AND request_id=rid),'old-key charge and record retained');
 b:=public.concierge_admit_v1(NULL,'fixture-fresh-forbidden',gen_random_uuid(),pg_temp.payload('hello',cid),'anonymous');
 PERFORM pg_temp.assert_true(b->>'error'='conversation_unavailable' AND b->>'admitted'='false','fresh-key unavailable conversation proves no admission');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM concierge_private.requests WHERE requester='s:fixture-fresh-forbidden'),'fresh rejected request creates no ledger row');

 DELETE FROM public.profiles WHERE id=uid;
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.host_conversations WHERE id=cid),'profile cascade deletes conversation');
 PERFORM pg_temp.assert_true(public.concierge_admit_v1(NULL,'fixture-local',rid,pg_temp.payload(),'anonymous')->>'error'='gone','deleted id cannot replay');
 PERFORM pg_temp.assert_true((SELECT redacted AND payload IS NULL AND response IS NULL AND fingerprint IS NULL AND conversation_id IS NULL AND charged FROM concierge_private.requests WHERE requester=k AND request_id=rid),'content deleted charge retained');
END $$;
DO $$
DECLARE a jsonb;rid uuid:=gen_random_uuid(); tok uuid;k text;cid uuid;
BEGIN
 a:=public.concierge_admit_v1(NULL,'fixture-unknown',rid,pg_temp.payload(),'anonymous');tok:=(a->>'owner_token')::uuid;k:=a->>'requester';cid:=(a->>'conversation_id')::uuid;
 PERFORM pg_temp.assert_true(public.concierge_dispatch_v1(k,rid,tok)->>'dispatch_granted'='true','first dispatch grant');
 PERFORM pg_temp.assert_true(public.concierge_dispatch_v1(k,rid,tok)->>'dispatch_granted'='false','no second dispatch grant');
 PERFORM pg_temp.assert_true(public.concierge_finish_v1(k,rid,tok,'uncertain')->>'state'='uncertain','unknown state');
 UPDATE concierge_private.requests SET admitted_at=clock_timestamp()-interval '2 minutes',lease_until=clock_timestamp()-interval '1 minute' WHERE requester=k AND request_id=rid;
 PERFORM pg_temp.assert_true(public.concierge_admit_v1(NULL,'fixture-unknown',rid,pg_temp.payload(),'anonymous')->>'state'='uncertain','uncertainty never expires');
 PERFORM pg_temp.assert_true(public.concierge_finish_v1(k,rid,tok,'no_dispatch')->>'error'='invalid_state','cannot refund dispatched work');
 DELETE FROM public.host_conversations WHERE id=cid;
 PERFORM pg_temp.assert_true((SELECT state='uncertain' AND charged AND redacted FROM concierge_private.requests WHERE requester=k AND request_id=rid),'deletion keeps uncertain capacity');
 PERFORM pg_temp.assert_true(public.concierge_dispatch_v1(k,rid,tok)->>'error'='gone','deleted cannot dispatch');
 PERFORM pg_temp.assert_true(public.concierge_finish_v1(k,rid,tok,'provider_terminal_failure')->>'state'='failed','terminal evidence reconciles tombstone');
 PERFORM pg_temp.assert_true((SELECT charged FROM concierge_private.requests WHERE requester=k AND request_id=rid),'failure remains charged');
END $$;
DO $$
DECLARE a jsonb;rid uuid:=gen_random_uuid();tok uuid;k text;
BEGIN
 a:=public.concierge_admit_v1(NULL,'fixture-expire',rid,pg_temp.payload(),'anonymous');tok:=(a->>'owner_token')::uuid;k:=a->>'requester';
 UPDATE concierge_private.requests SET admitted_at=clock_timestamp()-interval '2 minutes',lease_until=clock_timestamp()-interval '1 minute' WHERE requester=k AND request_id=rid;
 PERFORM pg_temp.assert_true(public.concierge_status_v1(NULL,'fixture-expire',rid,pg_temp.payload())->>'recovery_required'='true','status directs same id recovery');
 PERFORM pg_temp.assert_true(public.concierge_admit_v1(NULL,'fixture-expire',rid,pg_temp.payload(),'anonymous')->>'state'='cancelled','same id recovers expired reservation');
 PERFORM pg_temp.assert_true(NOT (SELECT charged FROM concierge_private.requests WHERE requester=k AND request_id=rid),'reserved refund');
 PERFORM pg_temp.assert_true(public.concierge_dispatch_v1(k,rid,tok)->>'dispatch_granted'='false','old token fenced');
END $$;
-- An insert collision must roll back BOTH messages and leave the reservation retryable.
DO $$
DECLARE a jsonb;rid uuid:=gen_random_uuid();tok uuid;k text;cid uuid;aid uuid;
BEGIN
 a:=public.concierge_admit_v1(NULL,'fixture-atomic',rid,pg_temp.payload(),'anonymous');tok:=(a->>'owner_token')::uuid;k:=a->>'requester';cid:=(a->>'conversation_id')::uuid;
 SELECT assistant_message_id INTO aid FROM concierge_private.requests WHERE requester=k AND request_id=rid;
 INSERT INTO public.host_messages(id,conversation_id,role,content) VALUES(aid,cid,'assistant','collision');
 BEGIN
  PERFORM public.concierge_complete_v1(k,rid,tok,'hello','world',false);
  RAISE EXCEPTION 'expected unique violation';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.host_messages WHERE conversation_id=cid),'no partial user insert');
 PERFORM pg_temp.assert_true((SELECT state='reserved' FROM concierge_private.requests WHERE requester=k AND request_id=rid),'no partial completed state');
 -- Deleting the collision redacts its linked reservation, intentionally preventing replay.
 DELETE FROM public.host_messages WHERE id=aid;
 PERFORM pg_temp.assert_true(public.concierge_status_v1(NULL,'fixture-atomic',rid,pg_temp.payload())->>'error'='gone','message deletion redacts ledger');
 PERFORM public.concierge_finish_v1(k,rid,tok,'no_dispatch');
END $$;
-- Rolling allowance is charged per admitted request, not per message.
DO $$
DECLARE a jsonb;rid uuid;i integer;
BEGIN
 FOR i IN 1..10 LOOP
  rid:=gen_random_uuid();a:=public.concierge_admit_v1(NULL,'fixture-quota',rid,pg_temp.payload(),'anonymous');
  PERFORM pg_temp.assert_true(a->>'admitted'='true','quota available '||i);
  PERFORM public.concierge_complete_v1(a->>'requester',rid,(a->>'owner_token')::uuid,'hello','world',false);
 END LOOP;
 PERFORM pg_temp.assert_true(public.concierge_admit_v1(NULL,'fixture-quota',gen_random_uuid(),pg_temp.payload(),'anonymous')->>'error'='quota_exceeded','eleventh rejected');
END $$;
-- Verified-user namespace and each unchanged tier allowance.
DO $$
DECLARE a jsonb;uid uuid;tier_name text;expected integer;
BEGIN
 FOREACH tier_name IN ARRAY ARRAY['explorer','regular','vip'] LOOP
  uid:=gen_random_uuid();INSERT INTO public.profiles(id) VALUES(uid);
  a:=public.concierge_admit_v1(uid,'ignored-guest-session',gen_random_uuid(),pg_temp.payload(),tier_name);
  expected:=CASE tier_name WHEN 'explorer' THEN 49 WHEN 'regular' THEN 199 ELSE 999 END;
  PERFORM pg_temp.assert_true(a->>'admitted'='true' AND (a->>'remaining')::integer=expected,'authenticated tier '||tier_name);
  PERFORM pg_temp.assert_true((SELECT user_id=uid AND session_id IS NULL FROM concierge_private.requests WHERE requester=a->>'requester' AND request_id=(a->>'request_id')::uuid),'auth wins over guest session');
  PERFORM public.concierge_finish_v1(a->>'requester',(a->>'request_id')::uuid,(a->>'owner_token')::uuid,'no_dispatch');
 END LOOP;
END $$;
-- Legacy bridge boundary: strictly before cutoff counts; exactly at cutoff does not.
DO $$
DECLARE cutoff timestamptz:=clock_timestamp()-interval '30 seconds';cid uuid;a jsonb;
BEGIN
 UPDATE concierge_private.policy SET legacy_cutoff=cutoff;
 INSERT INTO public.host_conversations(session_id,host_agent,surface) VALUES('fixture-legacy','ginger','web-chat') RETURNING id INTO cid;
 -- Fixtures set times with row trigger temporarily disabled only in this rolled-back
 -- owner transaction, to model pre-migration historical messages without rewriting history.
 ALTER TABLE public.host_messages DISABLE TRIGGER concierge_message_row;
 INSERT INTO public.host_messages(conversation_id,role,content,created_at) VALUES
  (cid,'user','before cutoff',cutoff-interval '1 microsecond'),(cid,'user','exact cutoff',cutoff);
 ALTER TABLE public.host_messages ENABLE TRIGGER concierge_message_row;
 a:=public.concierge_admit_v1(NULL,'fixture-legacy',gen_random_uuid(),pg_temp.payload(),'anonymous');
 PERFORM pg_temp.assert_true(a->>'admitted'='true' AND a->>'remaining'='8','legacy cutoff boundary preserved');
 PERFORM public.concierge_finish_v1(a->>'requester',(a->>'request_id')::uuid,(a->>'owner_token')::uuid,'no_dispatch');
END $$;
-- Global budget is independently limiting; requests denied without conversation creation.
UPDATE concierge_private.policy SET global_budget_microusd=1;
DO $$ BEGIN
 PERFORM pg_temp.assert_true(public.concierge_admit_v1(NULL,'fixture-budget',gen_random_uuid(),pg_temp.payload(),'anonymous')->>'error'='capacity_busy','budget exhaustion');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.host_conversations WHERE session_id='fixture-budget'),'denial no conversation');
END $$;
-- Permission catalog tests (actual role-execution tests in roles.sql).
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.concierge_admit_v1(uuid,text,uuid,jsonb,text)','EXECUTE'),'anon execute revoked');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.concierge_status_v1(uuid,text,uuid,jsonb)','EXECUTE'),'authenticated execute revoked');
SELECT pg_temp.assert_true(has_function_privilege('service_role','public.concierge_complete_v1(text,uuid,uuid,text,text,boolean)','EXECUTE'),'service execute granted');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','concierge_private.requests','SELECT'),'ledger hidden');
SELECT pg_temp.assert_true(NOT has_table_privilege('service_role','concierge_private.requests','DELETE'),'service cannot purge');
SELECT pg_temp.assert_true(NOT has_table_privilege('service_role','concierge_private.policy','UPDATE'),'service cannot enable policy');
ROLLBACK;
