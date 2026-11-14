-- OFFLINE REVIEW ONLY. Empty prebindings, no jobs, paid work, copy or activation.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Expected direct reviewed PG17 installer'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='character_production_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='character_production_owner'::regrole OR (roleid='character_production_owner'::regrole AND member<>current_user::regrole)) THEN RAISE EXCEPTION 'Unsafe owner role or inherited membership'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname='qa_slot_bindings') OR to_regprocedure('public.character_production_qa_draft_unplanned(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'Recurring bridge already exists'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') OR has_column_privilege('character_production_owner','public.cs_character_promo_drafts','id','REFERENCES') THEN RAISE EXCEPTION 'Unexpected temporary-rights baseline'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor<>current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option)<>1 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor=current_user::regrole) THEN RAISE EXCEPTION 'Missing original bootstrap membership'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.cs_character_promo_drafts'::regclass AND relowner=current_user::regrole AND relrowsecurity AND NOT relforcerowsecurity) OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.cs_character_promo_delivery_plans'::regclass AND relowner=current_user::regrole AND NOT relforcerowsecurity) THEN RAISE EXCEPTION 'Unexpected source owner/RLS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.contype='f' AND c.conrelid='public.cs_character_promo_delivery_plans'::regclass AND c.confrelid='public.cs_character_promo_drafts'::regclass AND c.convalidated AND NOT c.condeferrable AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='promo_id')] AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]) THEN RAISE EXCEPTION 'Required immediate plan/draft FK missing'; END IF;
 IF to_regprocedure('public.character_production_qa_prepare(text,text)') IS NULL OR to_regprocedure('public.character_production_qa_commit(text,text,text,bigint,uuid,timestamptz,text,text)') IS NULL THEN RAISE EXCEPTION 'Existing QA bridge required'; END IF;
END $$;
LOCK TABLE public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks IN SHARE MODE;
CREATE TEMP TABLE ri_source ON COMMIT DROP AS SELECT 'drafts' name,to_jsonb(x) row FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x;
CREATE TEMP TABLE ri_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE ri_ns ON COMMIT DROP AS SELECT oid,nspacl FROM pg_namespace WHERE nspname IN ('public','character_production');
CREATE TEMP TABLE ri_objects ON COMMIT DROP AS SELECT oid,relowner,relacl,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'character_production'::regnamespace);
CREATE TEMP TABLE ri_columns ON COMMIT DROP AS SELECT attrelid,attnum,attacl FROM pg_attribute WHERE attrelid IN ('public.cs_character_promo_drafts'::regclass,'public.cs_character_promo_delivery_plans'::regclass,'public.cs_character_promo_qa_checks'::regclass);
CREATE TEMP TABLE ri_functions ON COMMIT DROP AS SELECT oid,proowner,proacl,pg_get_functiondef(oid) def FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'character_production'::regnamespace) AND prokind='f';
CREATE TEMP TABLE ri_policies ON COMMIT DROP AS SELECT oid,to_jsonb(p) data FROM pg_policy p;
CREATE TEMP TABLE ri_triggers ON COMMIT DROP AS SELECT oid,to_jsonb(t) data FROM pg_trigger t WHERE tgrelid IN ('public.cs_character_promo_drafts'::regclass,'public.cs_character_promo_delivery_plans'::regclass,'public.cs_character_promo_qa_checks'::regclass);
-- Owner-only boolean: no private ledger access and no source rows returned.
CREATE FUNCTION public.character_production_qa_draft_unplanned(p_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.cs_character_promo_drafts d WHERE d.id=p_id)
 AND NOT EXISTS(SELECT 1 FROM public.cs_character_promo_delivery_plans p WHERE p.promo_id=p_id)
$$;
REVOKE ALL ON FUNCTION public.character_production_qa_draft_unplanned(uuid) FROM PUBLIC,anon,authenticated,service_role,character_production_generator,character_production_output_broker;
GRANT EXECUTE ON FUNCTION public.character_production_qa_draft_unplanned(uuid) TO character_production_owner;
GRANT character_production_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO character_production_owner;
GRANT REFERENCES(id) ON public.cs_character_promo_drafts TO character_production_owner;
SET LOCAL ROLE character_production_owner;
LOCK TABLE character_production.jobs,character_production.budgets,character_production.approved_slots,character_production.schedules,character_production.qa_targets,character_production.qa_ingestion_receipts IN SHARE MODE;
CREATE TEMP TABLE ri_ledger ON COMMIT DROP AS SELECT 'jobs' name,to_jsonb(x) row FROM character_production.jobs x UNION ALL SELECT 'budgets',to_jsonb(x) FROM character_production.budgets x UNION ALL SELECT 'slots',to_jsonb(x) FROM character_production.approved_slots x UNION ALL SELECT 'schedules',to_jsonb(x) FROM character_production.schedules x UNION ALL SELECT 'targets',to_jsonb(x) FROM character_production.qa_targets x UNION ALL SELECT 'receipts',to_jsonb(x) FROM character_production.qa_ingestion_receipts x;

CREATE TABLE character_production.qa_slot_bindings (
 slot_key text PRIMARY KEY REFERENCES character_production.approved_slots(key),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 slot jsonb NOT NULL CHECK(jsonb_typeof(slot)='object'),
 promo_id uuid NOT NULL UNIQUE REFERENCES public.cs_character_promo_drafts(id),
 expected_updated_at timestamptz NOT NULL,
 enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE character_production.qa_slot_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.qa_slot_bindings FROM PUBLIC;
-- Once materialized, disabling/deleting the planner binding must also revoke
-- the existing bridge target. Identity/revision may never be silently retargeted.
CREATE FUNCTION character_production.qa_binding_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM character_production.qa_targets WHERE job_key=OLD.slot_key) THEN
  IF TG_OP='UPDATE' AND (NEW.slot_key IS DISTINCT FROM OLD.slot_key OR NEW.digest IS DISTINCT FROM OLD.digest
   OR NEW.slot IS DISTINCT FROM OLD.slot OR NEW.promo_id IS DISTINCT FROM OLD.promo_id
   OR NEW.expected_updated_at IS DISTINCT FROM OLD.expected_updated_at OR NEW.enabled IS DISTINCT FROM false) THEN
   RAISE EXCEPTION 'Materialized QA binding immutable; revoke only';
  END IF;
  UPDATE character_production.qa_targets SET enabled=false WHERE job_key=OLD.slot_key;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION character_production.qa_binding_guard() FROM PUBLIC;
CREATE TRIGGER qa_binding_guard BEFORE UPDATE OR DELETE ON character_production.qa_slot_bindings
 FOR EACH ROW EXECUTE FUNCTION character_production.qa_binding_guard();
CREATE FUNCTION public.character_production_qa_materialize(p_key text,p_digest text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a character_production.approved_slots; j character_production.jobs;
 b character_production.qa_slot_bindings; d public.cs_character_promo_drafts;
 t character_production.qa_targets;
BEGIN
 IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RETURN false; END IF;
 -- Same lock ordering as qa_manifest; binding is locked before the draft.
 SELECT * INTO a FROM character_production.approved_slots WHERE key=p_key FOR UPDATE;
 IF NOT FOUND OR a.enabled IS DISTINCT FROM true OR a.digest IS DISTINCT FROM p_digest THEN RETURN false; END IF;
 SELECT * INTO j FROM character_production.jobs WHERE key=p_key FOR UPDATE;
 IF NOT FOUND OR j.digest IS DISTINCT FROM p_digest OR a.slot IS DISTINCT FROM j.slot
 OR j.state IS DISTINCT FROM 'pending_qa' OR j.sha IS NULL OR j.sha !~ '^[a-f0-9]{64}$'
 OR j.bytes IS NULL OR j.bytes NOT BETWEEN 16 AND 36700160
 OR j.bucket IS DISTINCT FROM 'character-production-private'
 OR j.object_path IS DISTINCT FROM j.digest||'/'||j.sha||'.mp4' THEN RETURN false; END IF;
 SELECT * INTO b FROM character_production.qa_slot_bindings WHERE slot_key=p_key FOR UPDATE;
 IF NOT FOUND OR b.enabled IS DISTINCT FROM true OR b.digest IS DISTINCT FROM p_digest
 OR b.slot IS DISTINCT FROM a.slot THEN RETURN false; END IF;
 SELECT * INTO t FROM character_production.qa_targets WHERE job_key=p_key FOR UPDATE;
 IF FOUND THEN
  IF t.enabled IS DISTINCT FROM true OR t.digest IS DISTINCT FROM b.digest
  OR t.promo_id IS DISTINCT FROM b.promo_id OR t.expected_updated_at IS DISTINCT FROM b.expected_updated_at THEN RETURN false; END IF;
  -- Includes exact committed replay, but rejects a subsequently edited target.
  IF character_production.qa_manifest(p_key,p_digest) IS NULL THEN RETURN false; END IF;
  RETURN public.character_production_qa_draft_unplanned(b.promo_id);
 END IF;
 SELECT * INTO d FROM public.cs_character_promo_drafts WHERE id=b.promo_id FOR UPDATE;
 IF NOT FOUND OR NOT public.character_production_qa_draft_unplanned(b.promo_id) OR d.updated_at IS DISTINCT FROM b.expected_updated_at
 OR d.character_id IS DISTINCT FROM a.slot->>'characterId'
 OR d.spoken_script IS DISTINCT FROM a.slot->>'script'
 OR a.slot->>'characterId' IS NULL OR a.slot->>'characterId' !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$'
 OR a.slot->>'script' IS NULL OR length(btrim(a.slot->>'script'))=0
 OR d.status IS NULL OR d.status NOT IN ('draft','revision_requested')
 OR d.audio_asset_path IS NOT NULL OR d.video_asset_path IS NOT NULL
 OR d.voice_approved_at IS NOT NULL OR d.video_qa_approved_at IS NOT NULL
 OR d.publication_approved_at IS NOT NULL THEN RETURN false; END IF;
 -- Unique promo_id prevents a second job claiming the same draft. Conflict is
 -- refusal, never reassignment. No job, source, budget or paid state is written.
 INSERT INTO character_production.qa_targets(job_key,digest,promo_id,expected_updated_at,enabled)
 VALUES(p_key,p_digest,b.promo_id,b.expected_updated_at,true) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $$;
CREATE FUNCTION public.character_production_qa_ready_slots(p_limit integer)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(x.identity),'[]'::jsonb) FROM (
 SELECT jsonb_build_object('key',j.key,'digest',j.digest) identity
 FROM character_production.jobs j
 JOIN character_production.approved_slots a ON a.key=j.key AND a.digest=j.digest AND a.slot=j.slot AND a.enabled=true
 JOIN character_production.qa_slot_bindings b ON b.slot_key=j.key AND b.digest=j.digest AND b.slot=j.slot AND b.enabled=true
 JOIN public.cs_character_promo_drafts d ON d.id=b.promo_id
 WHERE j.state='pending_qa' AND public.character_production_qa_draft_unplanned(b.promo_id) AND d.updated_at=b.expected_updated_at
 AND d.character_id=j.slot->>'characterId' AND d.spoken_script=j.slot->>'script'
 AND j.slot->>'characterId' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$' AND length(btrim(j.slot->>'script'))>0
 AND d.status IN ('draft','revision_requested') AND d.video_asset_path IS NULL AND d.audio_asset_path IS NULL
 AND d.voice_approved_at IS NULL AND d.video_qa_approved_at IS NULL AND d.publication_approved_at IS NULL
 AND j.sha ~ '^[a-f0-9]{64}$' AND j.bytes BETWEEN 16 AND 36700160
 AND j.bucket='character-production-private' AND j.object_path=j.digest||'/'||j.sha||'.mp4'
 AND NOT EXISTS(SELECT 1 FROM character_production.qa_ingestion_receipts r WHERE r.job_key=j.key)
 AND NOT EXISTS(SELECT 1 FROM character_production.qa_targets t WHERE t.job_key=j.key AND
 (t.enabled IS DISTINCT FROM true OR t.digest IS DISTINCT FROM b.digest OR t.promo_id IS DISTINCT FROM b.promo_id OR t.expected_updated_at IS DISTINCT FROM b.expected_updated_at))
 ORDER BY j.created_at,j.key LIMIT greatest(0,least(coalesce(p_limit,0),5))) x
$$;
REVOKE ALL ON FUNCTION public.character_production_qa_materialize(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_qa_ready_slots(integer) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','character_production_generator','character_production_output_broker'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON character_production.qa_slot_bindings FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION character_production.qa_binding_guard() FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_qa_materialize(text,text) FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_qa_ready_slots(integer) FROM %I',r);
 END IF; END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.character_production_qa_ready_slots(integer),public.character_production_qa_materialize(text,text) TO service_role;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM character_production.qa_slot_bindings) THEN RAISE EXCEPTION 'Bindings must install empty'; END IF;
 IF EXISTS(WITH actual AS (SELECT 'jobs' name,to_jsonb(x) row FROM character_production.jobs x UNION ALL SELECT 'budgets',to_jsonb(x) FROM character_production.budgets x UNION ALL SELECT 'slots',to_jsonb(x) FROM character_production.approved_slots x UNION ALL SELECT 'schedules',to_jsonb(x) FROM character_production.schedules x UNION ALL SELECT 'targets',to_jsonb(x) FROM character_production.qa_targets x UNION ALL SELECT 'receipts',to_jsonb(x) FROM character_production.qa_ingestion_receipts x) (SELECT * FROM actual EXCEPT SELECT * FROM ri_ledger) UNION ALL (SELECT * FROM ri_ledger EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'Ledger changed'; END IF;
END $$;
CREATE TEMP TABLE ri_usage(granted boolean NOT NULL) ON COMMIT DROP;
INSERT INTO ri_usage VALUES(NOT has_schema_privilege(session_user,'character_production','USAGE'));
DO $$ BEGIN IF (SELECT granted FROM ri_usage) THEN GRANT USAGE ON SCHEMA character_production TO postgres; END IF; END $$;
RESET ROLE;

CREATE POLICY character_production_qa_prebinding_read ON public.cs_character_promo_drafts
 FOR SELECT TO character_production_owner USING (EXISTS (
 SELECT 1 FROM character_production.qa_slot_bindings b WHERE b.promo_id=id AND b.enabled=true));
CREATE POLICY character_production_qa_prebinding_lock ON public.cs_character_promo_drafts
 FOR UPDATE TO character_production_owner USING (EXISTS (
 SELECT 1 FROM character_production.qa_slot_bindings b WHERE b.promo_id=id AND b.enabled=true)) WITH CHECK(false);
SET LOCAL ROLE character_production_owner;
DO $$ BEGIN IF (SELECT granted FROM ri_usage) THEN REVOKE USAGE ON SCHEMA character_production FROM postgres; END IF; END $$;
RESET ROLE;
REVOKE REFERENCES(id) ON public.cs_character_promo_drafts FROM character_production_owner;
REVOKE CREATE ON SCHEMA public FROM character_production_owner;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE new_function_row record; new_binding_oid oid; owner_id oid:='character_production_owner'::regrole; BEGIN
 IF EXISTS((SELECT * FROM pg_auth_members EXCEPT SELECT * FROM ri_members) UNION ALL (SELECT * FROM ri_members EXCEPT SELECT * FROM pg_auth_members)) THEN RAISE EXCEPTION 'Membership changed'; END IF;
 IF EXISTS(SELECT 1 FROM ri_ns s LEFT JOIN pg_namespace n USING(oid) WHERE n.oid IS NULL OR n.nspacl IS DISTINCT FROM s.nspacl) THEN RAISE EXCEPTION 'Schema ACL changed'; END IF;
 IF EXISTS(SELECT 1 FROM ri_objects o LEFT JOIN pg_class c USING(oid) WHERE c.oid IS NULL OR c.relowner IS DISTINCT FROM o.relowner OR c.relacl IS DISTINCT FROM o.relacl OR c.relrowsecurity IS DISTINCT FROM o.relrowsecurity OR c.relforcerowsecurity IS DISTINCT FROM o.relforcerowsecurity) THEN RAISE EXCEPTION 'Existing object changed'; END IF;
 IF EXISTS(SELECT 1 FROM ri_columns o LEFT JOIN pg_attribute a USING(attrelid,attnum) WHERE a.attrelid IS NULL OR a.attacl IS DISTINCT FROM o.attacl) THEN RAISE EXCEPTION 'Column ACL changed'; END IF;
 IF EXISTS(SELECT 1 FROM ri_functions f LEFT JOIN pg_proc p USING(oid) WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM f.proowner OR p.proacl IS DISTINCT FROM f.proacl OR pg_get_functiondef(p.oid) IS DISTINCT FROM f.def) THEN RAISE EXCEPTION 'Existing function changed'; END IF;
 IF EXISTS(SELECT 1 FROM ri_policies s LEFT JOIN pg_policy p USING(oid) WHERE p.oid IS NULL OR to_jsonb(p) IS DISTINCT FROM s.data) OR (SELECT count(*) FROM pg_policy)<>(SELECT count(*)+2 FROM ri_policies) THEN RAISE EXCEPTION 'Policy delta changed'; END IF;
 IF EXISTS(SELECT 1 FROM ri_triggers s LEFT JOIN pg_trigger t USING(oid) WHERE t.oid IS NULL OR to_jsonb(t) IS DISTINCT FROM s.data) THEN RAISE EXCEPTION 'Existing trigger changed'; END IF;
 IF EXISTS(WITH actual AS (SELECT 'drafts' name,to_jsonb(x) row FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x) (SELECT * FROM actual EXCEPT SELECT * FROM ri_source) UNION ALL (SELECT * FROM ri_source EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'Source data changed'; END IF;

 SELECT c.oid INTO new_binding_oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname='qa_slot_bindings' AND c.relkind='r';
 IF new_binding_oid IS NULL OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=new_binding_oid AND relowner=owner_id AND relrowsecurity AND NOT relforcerowsecurity) OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=new_binding_oid) OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=new_binding_oid AND attacl IS NOT NULL) THEN RAISE EXCEPTION 'New binding table ownership/RLS/column policy mismatch'; END IF;
 IF EXISTS(WITH actual AS (SELECT a.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=new_binding_oid), expected AS (SELECT * FROM aclexplode(acldefault('r',owner_id))) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'New binding table ACL mismatch'; END IF;
 FOR new_function_row IN SELECT p.*, CASE WHEN p.proname='character_production_qa_draft_unplanned' THEN current_user::regrole::oid ELSE owner_id END expected_owner,
 CASE WHEN p.proname='character_production_qa_draft_unplanned' THEN owner_id WHEN p.proname IN ('character_production_qa_ready_slots','character_production_qa_materialize') THEN 'service_role'::regrole::oid ELSE NULL END extra_grantee
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='public' AND p.proname IN ('character_production_qa_draft_unplanned','character_production_qa_ready_slots','character_production_qa_materialize')) OR (n.nspname='character_production' AND p.proname='qa_binding_guard') LOOP
  IF new_function_row.proowner IS DISTINCT FROM new_function_row.expected_owner OR NOT new_function_row.prosecdef OR new_function_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'New function owner/config mismatch'; END IF;
  IF EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(new_function_row.proacl,acldefault('f',new_function_row.proowner)))), expected AS (SELECT new_function_row.expected_owner grantor,new_function_row.expected_owner grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT new_function_row.expected_owner,new_function_row.extra_grantee,'EXECUTE',false WHERE new_function_row.extra_grantee IS NOT NULL) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'New function ACL mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='public' AND p.proname IN ('character_production_qa_draft_unplanned','character_production_qa_ready_slots','character_production_qa_materialize')) OR (n.nspname='character_production' AND p.proname='qa_binding_guard'))<>4 THEN RAISE EXCEPTION 'New function identity count mismatch'; END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid=new_binding_oid AND NOT tgisinternal)<>1 OR NOT EXISTS(SELECT 1 FROM pg_trigger x JOIN pg_proc f ON f.oid=x.tgfoid WHERE x.tgrelid=new_binding_oid AND x.tgname='qa_binding_guard' AND x.tgtype=27 AND x.tgenabled='O' AND x.tgqual IS NULL AND x.tgnargs=0 AND f.proname='qa_binding_guard' AND f.proowner=owner_id AND f.pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='character_production')) THEN RAISE EXCEPTION 'New binding guard mismatch'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') OR has_column_privilege('character_production_owner','public.cs_character_promo_drafts','id','REFERENCES') THEN RAISE EXCEPTION 'Temporary authority remains'; END IF;
END $$;
COMMIT;

