-- Full catalog FK-edge coverage, abbreviated synthetic row shapes. Isolated DB only.
-- No auth DELETE trigger or additional auth-admin private/public DML privilege.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',label; END IF; END $$;
SELECT pg_temp.assert_true((SELECT pg_get_userbyid(relowner)='supabase_auth_admin' AND relrowsecurity FROM pg_class WHERE oid='auth.users'::regclass),'auth owner/RLS matches catalog');
SELECT pg_temp.assert_true((SELECT NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname='supabase_auth_admin'),'auth admin not privileged shortcut');
SELECT pg_temp.assert_true(NOT has_schema_privilege('supabase_auth_admin','concierge_private','USAGE'),'auth admin has no private-schema grant');
SELECT pg_temp.assert_true(NOT has_table_privilege('supabase_auth_admin','public.profiles','DELETE'),'auth admin has no direct profile delete');
SELECT pg_temp.assert_true(NOT has_table_privilege('service_role','auth.users','DELETE'),'service role cannot delete auth user');
SELECT pg_temp.assert_true((SELECT count(*)=49 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.contype='f' AND n.nspname IN ('auth','public')),'49 catalog FK edges present');
UPDATE concierge_private.policy SET enabled=true,version='synthetic-auth-delete',global_inflight=100,global_admissions=1000,
 global_window_seconds=86400,global_budget_microusd=100000,max_request_cost_microusd=10,max_prompt_bytes=48000,
 max_input_messages=61,max_output_tokens=512,max_reply_chars=16384,lease_seconds=60,
 legacy_cutoff=clock_timestamp()-interval '1 second',legacy_drained=true,charged_failures_approved=true,
 retention_seconds=86400,content_retention_seconds=3600,replay_max_age_seconds=3600,max_future_skew_seconds=60;

-- Completed, reserved, and dispatched-unknown content all disappear with auth user.
DO $$
DECLARE uid uuid;rid uuid; a jsonb; b jsonb; state_name text; rel text;
BEGIN
 FOREACH state_name IN ARRAY ARRAY['completed','reserved','uncertain'] LOOP
  uid:=gen_random_uuid();rid:=test_fixture.request_id();
  PERFORM test_fixture.seed_account(uid);
  SET LOCAL ROLE service_role;
  a:=public.concierge_admit_v1(uid,NULL,rid,test_fixture.payload(rid),'explorer');
  PERFORM pg_temp.assert_true(a->>'admitted'='true','member admitted for deletion');
  IF state_name='completed' THEN
   b:=public.concierge_complete_v1(a->>'requester',rid,(a->>'owner_token')::uuid,'hello','private synthetic reply',false);
   PERFORM pg_temp.assert_true(b->>'state'='completed','cached member completion');
  ELSIF state_name='uncertain' THEN
   b:=public.concierge_dispatch_v1(a->>'requester',rid,(a->>'owner_token')::uuid);
   PERFORM pg_temp.assert_true(b->>'dispatch_granted'='true','unknown was dispatched');
   PERFORM public.concierge_finish_v1(a->>'requester',rid,(a->>'owner_token')::uuid,'uncertain');
  END IF;
  RESET ROLE;
  -- This is an explicitly coordinated deletion path, not the hosted Auth API.
  SET LOCAL ROLE supabase_auth_admin;
  PERFORM pg_catalog.pg_advisory_xact_lock(1128351301,1);
  DELETE FROM auth.users WHERE id=uid;
  RESET ROLE;
  FOREACH rel IN ARRAY ARRAY['auth.users','auth.identities','auth.sessions','auth.refresh_tokens','auth.mfa_amr_claims',
    'auth.mfa_factors','auth.mfa_challenges','auth.mfa_recovery_code_sets','auth.mfa_recovery_codes','auth.one_time_tokens',
    'auth.oauth_authorizations','auth.oauth_consents','auth.webauthn_credentials','auth.webauthn_challenges',
    'public.profiles','public.memberships','public.tickets','public.artists','public.products','public.lounge_messages'] LOOP
   EXECUTE format('SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM %s WHERE id=$1),$2)',rel) USING uid,'cascaded '||rel;
  END LOOP;
  PERFORM pg_temp.assert_true((SELECT user_id IS NULL FROM auth.scim_users WHERE id=uid),'SCIM SET NULL');
  PERFORM pg_temp.assert_true((SELECT user_id IS NULL AND updated_at IS NOT NULL FROM public.orders WHERE id=uid),'order SET NULL and touch trigger');
  PERFORM pg_temp.assert_true((SELECT updated_by IS NULL AND updated_at IS NOT NULL FROM public.room_state WHERE id=uid),'room SET NULL and touch trigger');
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.host_conversations WHERE id=(a->>'conversation_id')::uuid),'conversation cascaded');
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.host_messages WHERE conversation_id=(a->>'conversation_id')::uuid),'messages cascaded');
  PERFORM pg_temp.assert_true((SELECT redacted AND payload IS NULL AND response IS NULL AND fingerprint IS NULL AND conversation_id IS NULL
    AND charged AND state=state_name FROM concierge_private.requests WHERE requester=a->>'requester' AND request_id=rid),'private content redacted; charge/state preserved');
  SET LOCAL ROLE service_role;
  b:=public.concierge_status_v1(uid,NULL,rid,test_fixture.payload(rid));
  PERFORM pg_temp.assert_true(b->>'error'='gone','deleted content not replayable');
  RESET ROLE;
 END LOOP;
END $$;

-- Each materially different NO ACTION / RESTRICT auth-deletion blocker is tested
-- separately. Any prior cascades, SET NULL updates, trigger redaction, and message
-- deletion must roll back together. No production rows are used.
DO $$
DECLARE uid uuid;rid uuid;a jsonb;before_rows jsonb;after_rows jsonb;case_name text;blocker_id uuid;violation_constraint text;expected_constraint text;
BEGIN
 FOREACH case_name IN ARRAY ARRAY['canonical_approver','job_approver','social_approver','social_owner',
   'ticket_reservation_user','ticket_reservation_ticket','episode_approver','lounge_deleted_by','order_item_product','order_item_artist'] LOOP
  uid:=gen_random_uuid();rid:=test_fixture.request_id();blocker_id:=gen_random_uuid();
  PERFORM test_fixture.seed_account(uid);
  a:=public.concierge_admit_v1(uid,NULL,rid,test_fixture.payload(rid),'explorer');
  PERFORM public.concierge_complete_v1(a->>'requester',rid,(a->>'owner_token')::uuid,'hello','retained on rollback',false);
  CASE case_name
   WHEN 'canonical_approver' THEN INSERT INTO public.cs_canonical_assets(id,approved_by) VALUES(blocker_id,uid);
   WHEN 'job_approver' THEN INSERT INTO public.cs_content_jobs(id,qa_approved_by) VALUES(blocker_id,uid);
   WHEN 'social_approver' THEN INSERT INTO public.cs_social_deliveries(id,approved_by) VALUES(blocker_id,uid);
   WHEN 'social_owner' THEN INSERT INTO public.cs_social_connections(id,owner_id) VALUES(blocker_id,uid);
   WHEN 'ticket_reservation_user' THEN INSERT INTO public.cs_ticket_reservations(id,user_id) VALUES(blocker_id,uid);
   WHEN 'ticket_reservation_ticket' THEN INSERT INTO public.cs_ticket_reservations(id,ticket_id) VALUES(blocker_id,uid);
   WHEN 'episode_approver' THEN INSERT INTO public.cs_episode_script_approvals(id,approved_by) VALUES(blocker_id,uid);
   WHEN 'lounge_deleted_by' THEN
    -- A different surviving account's message was moderated by the deleted user.
    -- Use the checked-in guard's authorized staff path, not trigger disabling.
    INSERT INTO auth.users(id) VALUES(blocker_id);
    PERFORM set_config('request.jwt.claim.sub',blocker_id::text,true);
    INSERT INTO public.lounge_messages(id,room_id,user_id) VALUES(blocker_id,uid,blocker_id);
    UPDATE public.profiles SET is_staff=true WHERE id=uid;
    PERFORM set_config('request.jwt.claim.sub',uid::text,true);
    UPDATE public.lounge_messages SET deleted_at=clock_timestamp() WHERE id=blocker_id;
   WHEN 'order_item_product' THEN INSERT INTO public.order_items(id,order_id,product_id) VALUES(blocker_id,uid,uid);
   WHEN 'order_item_artist' THEN INSERT INTO public.order_items(id,order_id,artist_id) VALUES(blocker_id,uid,uid);
  END CASE;
  SELECT jsonb_build_object('request',to_jsonb(r),'conversation',to_jsonb(c),
    'messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.host_messages m WHERE m.conversation_id=c.id),
    'orders',(SELECT to_jsonb(o) FROM public.orders o WHERE o.id=uid),
    'room',(SELECT to_jsonb(s) FROM public.room_state s WHERE s.id=uid),
    'profile',(SELECT to_jsonb(p) FROM public.profiles p WHERE p.id=uid)) INTO before_rows
    FROM concierge_private.requests r JOIN public.host_conversations c ON c.id=r.conversation_id WHERE r.request_id=rid;
  expected_constraint:=CASE case_name
   WHEN 'canonical_approver' THEN 'cs_canonical_assets_approved_by_fkey'
   WHEN 'job_approver' THEN 'cs_content_jobs_qa_approved_by_fkey'
   WHEN 'social_approver' THEN 'cs_social_deliveries_approved_by_fkey'
   WHEN 'social_owner' THEN 'cs_social_connections_owner_id_fkey'
   WHEN 'ticket_reservation_user' THEN 'cs_ticket_reservations_user_id_fkey'
   WHEN 'ticket_reservation_ticket' THEN 'cs_ticket_reservations_ticket_id_fkey'
   WHEN 'episode_approver' THEN 'cs_episode_script_approvals_approved_by_fkey'
   WHEN 'lounge_deleted_by' THEN 'lounge_messages_deleted_by_fkey'
   WHEN 'order_item_product' THEN 'order_items_product_id_fkey'
   WHEN 'order_item_artist' THEN 'order_items_artist_id_fkey' END;
  BEGIN
   SET LOCAL ROLE supabase_auth_admin;
   PERFORM pg_catalog.pg_advisory_xact_lock(1128351301,1);
   DELETE FROM auth.users WHERE id=uid;
   RAISE EXCEPTION 'expected account deletion blocker: %',case_name;
  EXCEPTION WHEN foreign_key_violation THEN
   GET STACKED DIAGNOSTICS violation_constraint=CONSTRAINT_NAME;

  END;
  RESET ROLE;
  PERFORM pg_temp.assert_true(violation_constraint=expected_constraint,'specific blocker '||case_name);
  SELECT jsonb_build_object('request',to_jsonb(r),'conversation',to_jsonb(c),
    'messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.host_messages m WHERE m.conversation_id=c.id),
    'orders',(SELECT to_jsonb(o) FROM public.orders o WHERE o.id=uid),
    'room',(SELECT to_jsonb(s) FROM public.room_state s WHERE s.id=uid),
    'profile',(SELECT to_jsonb(p) FROM public.profiles p WHERE p.id=uid)) INTO after_rows
    FROM concierge_private.requests r JOIN public.host_conversations c ON c.id=r.conversation_id WHERE r.request_id=rid;
  PERFORM pg_temp.assert_true(before_rows=after_rows,'atomic rollback '||case_name);
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM auth.users WHERE id=uid),'blocked auth deletion restored user');
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM auth.sessions WHERE user_id=uid),'blocked auth deletion restored auth cascade');
 END LOOP;
END $$;
ROLLBACK;
