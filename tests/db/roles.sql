-- Isolated DB only, run as fixture owner with role-switch permission.
BEGIN;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.concierge_status_v1(NULL,'fixture',gen_random_uuid(),'{}');
  RAISE EXCEPTION 'anon unexpectedly executed status';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO auth.users(id) VALUES('00000000-0000-4000-8000-000000000001');
UPDATE public.profiles SET display_name='before' WHERE id='00000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
UPDATE public.profiles SET display_name='after' WHERE id='00000000-0000-4000-8000-000000000001';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE display_name='after') THEN RAISE EXCEPTION 'ordinary profile update blocked'; END IF; END $$;
DO $$ BEGIN
 BEGIN
  PERFORM public.concierge_admit_v1(NULL,'fixture',gen_random_uuid(),'{}','anonymous');
  RAISE EXCEPTION 'authenticated unexpectedly executed admission';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE result jsonb; rid uuid:=test_fixture.request_id();
BEGIN
 result:=public.concierge_admit_v1(NULL,'fixture-service',rid,test_fixture.payload(rid),'anonymous');
 IF result->>'error' IS DISTINCT FROM 'policy_unavailable' THEN RAISE EXCEPTION 'service invocation unexpected: %',result; END IF;
END $$;
RESET ROLE;
UPDATE concierge_private.policy SET enabled=true,version='synthetic-service',global_inflight=20,global_admissions=100,
 global_window_seconds=86400,global_budget_microusd=10000,max_request_cost_microusd=10,max_prompt_bytes=48000,
 max_input_messages=61,max_output_tokens=512,max_reply_chars=16384,lease_seconds=60,
 legacy_cutoff=clock_timestamp()-interval '1 second',legacy_drained=true,charged_failures_approved=true,retention_seconds=86400,content_retention_seconds=3600,replay_max_age_seconds=3600,max_future_skew_seconds=60;
SET LOCAL ROLE service_role;
DO $$
DECLARE a jsonb;b jsonb;rid uuid:=test_fixture.request_id();p jsonb;
BEGIN
 p:=test_fixture.payload(rid);
 a:=public.concierge_admit_v1(NULL,'fixture-role-enabled',rid,p,'anonymous');
 IF a->>'admitted' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'service admission failed: %',a; END IF;
 b:=public.concierge_dispatch_v1(a->>'requester',rid,(a->>'owner_token')::uuid);
 IF b->>'dispatch_granted' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'service dispatch failed: %',b; END IF;
 b:=public.concierge_complete_v1(a->>'requester',rid,(a->>'owner_token')::uuid,'hello','world',true);
 IF b->>'state' IS DISTINCT FROM 'completed' THEN RAISE EXCEPTION 'service completion failed: %',b; END IF;
 b:=public.concierge_status_v1(NULL,'fixture-role-enabled',rid,p);
 IF b->>'state' IS DISTINCT FROM 'completed' THEN RAISE EXCEPTION 'service status failed: %',b; END IF;
END $$;
RESET ROLE;
ROLLBACK;
