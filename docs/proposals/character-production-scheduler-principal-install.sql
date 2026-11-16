-- OFFLINE REVIEW ONLY. Prerequisites: reviewed recurring QA and HeyGen wallet
-- guard already installed. Empty scheduler principal, no runtime grants/rows/activation.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Expected direct reviewed PG17 installer'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='character_production_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='character_production_owner'::regrole OR (roleid='character_production_owner'::regrole AND member<>current_user::regrole)) THEN RAISE EXCEPTION 'Unsafe owner baseline'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected temporary authority'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor<>current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option)<>1 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor=current_user::regrole) THEN RAISE EXCEPTION 'Missing exact bootstrap membership'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.cs_character_promo_drafts'::regclass AND relowner=current_user::regrole AND relrowsecurity AND NOT relforcerowsecurity) THEN RAISE EXCEPTION 'Unexpected source owner/RLS'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname IN ('qa_slot_bindings','heygen_wallet_policy','heygen_wallet_evidence','heygen_slot_evidence') AND c.relkind='r' AND c.relowner='character_production_owner'::regrole AND c.relrowsecurity)<>4 OR to_regprocedure('public.character_production_qa_draft_unplanned(uuid)') IS NULL OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='character_production' AND p.proowner='character_production_owner'::regrole AND ((p.proname='calendar_period' AND p.proargtypes='25 1184'::oidvector) OR (p.proname='heygen_spend_allowed' AND p.proargtypes='3802 25 20 25'::oidvector)))<>2 THEN RAISE EXCEPTION 'Reviewed recurring QA and wallet guard prerequisites required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.cs_cafe_metricool_is_admin(uuid)') AND proowner=current_user::regrole AND prorettype='boolean'::regtype AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog']::text[]) OR NOT has_function_privilege('character_production_owner','public.cs_cafe_metricool_is_admin(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Reviewed source-owned boolean admin bridge required'; END IF;
 IF (SELECT count(*) FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relname IN ('planning_policies','planning_records') AND relowner='character_production_owner'::regrole AND relrowsecurity)<>2 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.character_production_plan(jsonb,text,jsonb,uuid,bigint,uuid)') AND proowner='character_production_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog']::text[]) THEN RAISE EXCEPTION 'Reviewed planner prerequisite required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relname IN ('scheduler_enrollments','scheduler_candidates','scheduler_binding')) OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'character_production'::regnamespace,'auth'::regnamespace) AND proname IN ('scheduler_current','scheduler_immutable','scheduler_binding_revoke','character_production_scheduler_context','character_production_scheduler_reconciled','character_production_scheduler_plan')) THEN RAISE EXCEPTION 'Scheduler principal already exists: reconcile'; END IF;
END $$;
DO $$ DECLARE f record; own oid:='character_production_owner'::regrole; extra oid; BEGIN
 FOR f IN SELECT p.* FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.character_production_plan(jsonb,text,jsonb,uuid,bigint,uuid)'),to_regprocedure('public.character_production_planning_policy(uuid)'),to_regprocedure('public.character_production_planned_draft(uuid,jsonb,text,text)')) LOOP
 IF f.proowner<>own OR NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'Planner dependency identity mismatch'; END IF;
 extra:=CASE WHEN f.proname='character_production_planned_draft' THEN current_user::regrole::oid ELSE NULL END;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT own,extra,'EXECUTE',false WHERE extra IS NOT NULL) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Planner dependency ACL mismatch'; END IF;
 END LOOP;
 IF to_regprocedure('public.character_production_planning_policy(uuid)') IS NULL OR to_regprocedure('public.character_production_planned_draft(uuid,jsonb,text,text)') IS NULL THEN RAISE EXCEPTION 'Planner readers missing'; END IF;
END $$;
LOCK TABLE public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks IN SHARE MODE;
CREATE TEMP TABLE si_source ON COMMIT DROP AS SELECT 'drafts' name,to_jsonb(x) row FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x;
CREATE TEMP TABLE si_defaults ON COMMIT DROP AS SELECT * FROM pg_default_acl;
CREATE TEMP TABLE si_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE si_ns ON COMMIT DROP AS SELECT oid,nspacl,nspowner FROM pg_namespace WHERE nspname IN ('public','character_production','auth');
CREATE TEMP TABLE si_objects ON COMMIT DROP AS SELECT oid,relacl,relowner,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'character_production'::regnamespace,'auth'::regnamespace);
CREATE TEMP TABLE si_cols ON COMMIT DROP AS SELECT attrelid,attnum,attacl FROM pg_attribute WHERE attrelid IN (SELECT oid FROM si_objects);
CREATE TEMP TABLE si_functions ON COMMIT DROP AS SELECT oid,proowner,proacl,pg_get_functiondef(oid) def FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'character_production'::regnamespace,'auth'::regnamespace) AND prokind='f';
CREATE TEMP TABLE si_policies ON COMMIT DROP AS SELECT oid,to_jsonb(p) data FROM pg_policy p;
CREATE TEMP TABLE si_triggers ON COMMIT DROP AS SELECT oid,to_jsonb(t) data FROM pg_trigger t;
GRANT character_production_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO character_production_owner;
SET LOCAL ROLE character_production_owner;
CREATE TEMP TABLE si_rows(name text,row jsonb) ON COMMIT DROP;
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT relname FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relkind='r' LOOP
 EXECUTE format('LOCK TABLE character_production.%I IN SHARE MODE',t.relname);
 EXECUTE format('INSERT INTO si_rows SELECT %L,to_jsonb(x) FROM character_production.%I x',t.relname,t.relname);
 END LOOP;
END $$;

CREATE TABLE character_production.scheduler_enrollments(
 id uuid PRIMARY KEY, policy_id uuid NOT NULL REFERENCES character_production.planning_policies(id),
 policy_revision bigint NOT NULL CHECK(policy_revision>0), actor_id uuid NOT NULL,
 policy_snapshot jsonb NOT NULL CHECK(jsonb_typeof(policy_snapshot)='object'),
 candidate_snapshot jsonb NOT NULL CHECK(jsonb_typeof(candidate_snapshot)='array' AND jsonb_array_length(candidate_snapshot) BETWEEN 1 AND 32),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 owner_evidence_ref text NOT NULL CHECK(length(btrim(owner_evidence_ref)) BETWEEN 1 AND 500),
 approved_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 enabled boolean NOT NULL DEFAULT false, CHECK(expires_at>approved_at)
);
CREATE TABLE character_production.scheduler_candidates(
 enrollment_id uuid NOT NULL REFERENCES character_production.scheduler_enrollments(id),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 31),
 slot jsonb NOT NULL CHECK(jsonb_typeof(slot)='object'), digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 draft_id uuid NOT NULL UNIQUE, theme text NOT NULL, scheduled_at timestamptz NOT NULL,
 PRIMARY KEY(enrollment_id,ordinal)
);
-- Single named internal scheduler can use only its explicitly bound enrollment.
-- Binding is owner-provisioned, never caller-selected authority.
CREATE TABLE character_production.scheduler_binding(
 name text PRIMARY KEY CHECK(name='cafe-character-planner'),
 enrollment_id uuid NOT NULL UNIQUE REFERENCES character_production.scheduler_enrollments(id),
 enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE character_production.scheduler_binding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.scheduler_binding FROM PUBLIC;
ALTER TABLE character_production.scheduler_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.scheduler_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.scheduler_enrollments,character_production.scheduler_candidates FROM PUBLIC;
CREATE FUNCTION character_production.scheduler_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='scheduler_enrollments' AND TG_OP='UPDATE' AND OLD.enabled AND NOT NEW.enabled
 AND (to_jsonb(OLD)-'enabled')=(to_jsonb(NEW)-'enabled') THEN
  UPDATE character_production.approved_slots SET enabled=false WHERE key IN
   (SELECT c.slot->>'key' FROM character_production.scheduler_candidates c WHERE c.enrollment_id=OLD.id);
  UPDATE character_production.schedules SET enabled=false WHERE key IN
   (SELECT c.slot->>'key' FROM character_production.scheduler_candidates c WHERE c.enrollment_id=OLD.id);
  UPDATE character_production.qa_slot_bindings SET enabled=false WHERE slot_key IN
   (SELECT c.slot->>'key' FROM character_production.scheduler_candidates c WHERE c.enrollment_id=OLD.id);
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'Scheduler authority immutable; revoke enrollment or create reviewed successor';
END $$;
REVOKE ALL ON FUNCTION character_production.scheduler_immutable() FROM PUBLIC;
CREATE TRIGGER scheduler_enrollment_immutable BEFORE UPDATE OR DELETE ON character_production.scheduler_enrollments FOR EACH ROW EXECUTE FUNCTION character_production.scheduler_immutable();
CREATE TRIGGER scheduler_candidate_immutable BEFORE UPDATE OR DELETE ON character_production.scheduler_candidates FOR EACH ROW EXECUTE FUNCTION character_production.scheduler_immutable();
-- Shared guard locks policy first, then enrollment, matching planner ordering.
-- source-owner provisioning must use same order when changing both relations.
-- Any binding removal/disable/retarget irreversibly revokes the old enrollment.
CREATE FUNCTION character_production.scheduler_binding_revoke() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 UPDATE character_production.scheduler_enrollments SET enabled=false WHERE id=OLD.enrollment_id AND enabled;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scheduler_binding_revoke BEFORE UPDATE OR DELETE ON character_production.scheduler_binding FOR EACH ROW EXECUTE FUNCTION character_production.scheduler_binding_revoke();
REVOKE ALL ON FUNCTION character_production.scheduler_binding_revoke() FROM PUBLIC;
CREATE FUNCTION character_production.scheduler_current(p_id uuid)
RETURNS character_production.scheduler_enrollments LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e character_production.scheduler_enrollments; p character_production.planning_policies; pid uuid;
BEGIN
 SELECT policy_id INTO pid FROM character_production.scheduler_enrollments WHERE id=p_id;
 IF pid IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO p FROM character_production.planning_policies WHERE id=pid FOR UPDATE;
 SELECT * INTO e FROM character_production.scheduler_enrollments WHERE id=p_id FOR UPDATE;
 IF e.id IS NULL OR NOT EXISTS(SELECT 1 FROM character_production.scheduler_binding b
 WHERE b.name='cafe-character-planner' AND b.enabled AND b.enrollment_id=e.id)
 OR e.candidate_snapshot IS DISTINCT FROM
 (SELECT coalesce(jsonb_agg(jsonb_build_object('ordinal',c.ordinal,'slot',c.slot,'digest',c.digest,'draftId',c.draft_id,'theme',c.theme,'scheduledAt',to_char(c.scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY c.ordinal),'[]'::jsonb)
 FROM character_production.scheduler_candidates c WHERE c.enrollment_id=e.id)
 OR NOT e.enabled OR NOT p.enabled OR e.policy_revision<>p.revision
 OR e.policy_snapshot IS DISTINCT FROM to_jsonb(p) OR e.approved_at>clock_timestamp()
 OR e.expires_at<=clock_timestamp() OR p.expires_at<=clock_timestamp() OR e.expires_at>p.expires_at
 OR EXISTS(SELECT 1 FROM character_production.scheduler_candidates c WHERE c.enrollment_id=e.id
 AND (c.scheduled_at<e.approved_at OR c.scheduled_at>=e.expires_at OR
 (CASE WHEN jsonb_typeof(c.slot->'authorizationExpiresAt')='number'
 AND c.slot->>'authorizationExpiresAt' ~ '^[0-9]{1,16}$'
 THEN (c.slot->>'authorizationExpiresAt')::numeric>extract(epoch FROM c.scheduled_at)*1000
 AND (c.slot->>'authorizationExpiresAt')::numeric<=extract(epoch FROM e.expires_at)*1000
 ELSE false END) IS NOT TRUE))
 OR public.cs_cafe_metricool_is_admin(e.actor_id) IS DISTINCT FROM true THEN RETURN NULL; END IF;
 RETURN e;
END $$;
REVOKE ALL ON FUNCTION character_production.scheduler_current(uuid) FROM PUBLIC;
CREATE FUNCTION public.character_production_scheduler_context(p_enrollment uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e character_production.scheduler_enrollments;
BEGIN
 e:=character_production.scheduler_current(p_enrollment); IF e.id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('enrollmentId',e.id,'actorId',e.actor_id,'manifestSha256',e.manifest_sha256,
 'policy',public.character_production_planning_policy(e.policy_id),'candidates',
 (SELECT coalesce(jsonb_agg(jsonb_build_object('ordinal',c.ordinal,'slot',c.slot,'digest',c.digest,'draftId',c.draft_id,'theme',c.theme,'scheduledAt',to_char(c.scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY c.ordinal),'[]'::jsonb)
 FROM character_production.scheduler_candidates c WHERE c.enrollment_id=e.id));
END $$;
CREATE FUNCTION public.character_production_scheduler_reconciled(p_enrollment uuid,p_ordinal integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e character_production.scheduler_enrollments; c character_production.scheduler_candidates;
BEGIN
 e:=character_production.scheduler_current(p_enrollment); IF e.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO c FROM character_production.scheduler_candidates WHERE enrollment_id=e.id AND ordinal=p_ordinal;
 IF c.enrollment_id IS NULL THEN RETURN NULL; END IF;
 RETURN public.character_production_planned_draft(c.draft_id,c.slot,c.digest,c.theme);
END $$;
CREATE FUNCTION public.character_production_scheduler_plan(p_enrollment uuid,p_ordinal integer,p_validation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e character_production.scheduler_enrollments; c character_production.scheduler_candidates;
BEGIN
 e:=character_production.scheduler_current(p_enrollment); IF e.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO c FROM character_production.scheduler_candidates WHERE enrollment_id=e.id AND ordinal=p_ordinal;
 IF c.enrollment_id IS NULL THEN RETURN NULL; END IF;
 RETURN public.character_production_plan(c.slot,c.digest,jsonb_build_object('version',1,'draftId',c.draft_id,'scheduledAt',to_char(c.scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'theme',c.theme,'validation',p_validation),e.policy_id,e.policy_revision,e.actor_id);
END $$;
REVOKE ALL ON FUNCTION public.character_production_scheduler_context(uuid),public.character_production_scheduler_reconciled(uuid,integer),public.character_production_scheduler_plan(uuid,integer,jsonb) FROM PUBLIC;
SET LOCAL ROLE character_production_owner;
DO $$ DECLARE t record; BEGIN
 IF EXISTS(SELECT 1 FROM character_production.scheduler_enrollments) OR EXISTS(SELECT 1 FROM character_production.scheduler_candidates) OR EXISTS(SELECT 1 FROM character_production.scheduler_binding) THEN RAISE EXCEPTION 'Scheduler must install empty'; END IF;
 CREATE TEMP TABLE si_rows_after(name text,row jsonb) ON COMMIT DROP;
 FOR t IN SELECT relname FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relkind='r' AND relname NOT IN ('scheduler_enrollments','scheduler_candidates','scheduler_binding') LOOP
 EXECUTE format('INSERT INTO si_rows_after SELECT %L,to_jsonb(x) FROM character_production.%I x',t.relname,t.relname);
 END LOOP;
 IF EXISTS((SELECT * FROM si_rows EXCEPT ALL SELECT * FROM si_rows_after) UNION ALL (SELECT * FROM si_rows_after EXCEPT ALL SELECT * FROM si_rows)) THEN RAISE EXCEPTION 'Ledger data changed'; END IF;
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM character_production_owner;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE new_function_row record; new_table_row record; own oid:='character_production_owner'::regrole; expected_owner oid; extra oid; BEGIN
 IF EXISTS((SELECT * FROM pg_default_acl EXCEPT SELECT * FROM si_defaults) UNION ALL (SELECT * FROM si_defaults EXCEPT SELECT * FROM pg_default_acl)) THEN RAISE EXCEPTION 'Default ACL changed'; END IF;
 IF EXISTS((SELECT * FROM pg_auth_members EXCEPT SELECT * FROM si_members) UNION ALL (SELECT * FROM si_members EXCEPT SELECT * FROM pg_auth_members)) THEN RAISE EXCEPTION 'Membership changed'; END IF;
 IF EXISTS(SELECT 1 FROM si_ns b LEFT JOIN pg_namespace n USING(oid) WHERE n.oid IS NULL OR n.nspacl IS DISTINCT FROM b.nspacl OR n.nspowner IS DISTINCT FROM b.nspowner) THEN RAISE EXCEPTION 'Schema authority changed'; END IF;
 IF EXISTS(SELECT 1 FROM si_objects b LEFT JOIN pg_class c USING(oid) WHERE c.oid IS NULL OR c.relowner IS DISTINCT FROM b.relowner OR c.relacl IS DISTINCT FROM b.relacl OR c.relrowsecurity IS DISTINCT FROM b.relrowsecurity OR c.relforcerowsecurity IS DISTINCT FROM b.relforcerowsecurity) OR EXISTS(SELECT 1 FROM si_cols b LEFT JOIN pg_attribute a USING(attrelid,attnum) WHERE a.attrelid IS NULL OR a.attacl IS DISTINCT FROM b.attacl) THEN RAISE EXCEPTION 'Existing object authority changed'; END IF;
 IF EXISTS(SELECT 1 FROM si_functions b LEFT JOIN pg_proc p USING(oid) WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM b.proowner OR p.proacl IS DISTINCT FROM b.proacl OR pg_get_functiondef(p.oid) IS DISTINCT FROM b.def) THEN RAISE EXCEPTION 'Existing function changed'; END IF;
 IF EXISTS(SELECT 1 FROM si_policies b LEFT JOIN pg_policy p USING(oid) WHERE p.oid IS NULL OR to_jsonb(p) IS DISTINCT FROM b.data) OR (SELECT count(*) FROM pg_policy)<>(SELECT count(*) FROM si_policies) THEN RAISE EXCEPTION 'Policies changed'; END IF;
 IF EXISTS(SELECT 1 FROM si_triggers b LEFT JOIN pg_trigger t USING(oid) WHERE t.oid IS NULL OR to_jsonb(t) IS DISTINCT FROM b.data) THEN RAISE EXCEPTION 'Existing triggers changed'; END IF;
 IF EXISTS(WITH actual AS (SELECT 'drafts' name,to_jsonb(x) row FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x) (SELECT * FROM actual EXCEPT ALL SELECT * FROM si_source) UNION ALL (SELECT * FROM si_source EXCEPT ALL SELECT * FROM actual)) THEN RAISE EXCEPTION 'Source rows changed'; END IF;
 FOR new_table_row IN SELECT * FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relname IN ('scheduler_enrollments','scheduler_candidates','scheduler_binding') LOOP
 IF new_table_row.relkind<>'r' OR new_table_row.relowner<>own OR NOT new_table_row.relrowsecurity OR new_table_row.relforcerowsecurity OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=new_table_row.oid AND attacl IS NOT NULL) THEN RAISE EXCEPTION 'Planner table identity mismatch'; END IF;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(new_table_row.relacl,acldefault('r',own)))), e AS (SELECT * FROM aclexplode(acldefault('r',own))) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Planner table ACL mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relname IN ('scheduler_enrollments','scheduler_candidates','scheduler_binding') AND relkind='r')<>3 THEN RAISE EXCEPTION 'Missing scheduler tables'; END IF;
 FOR new_function_row IN SELECT p.* FROM pg_proc p WHERE NOT EXISTS(SELECT 1 FROM si_functions b WHERE b.oid=p.oid) AND p.pronamespace IN ('public'::regnamespace,'character_production'::regnamespace,'auth'::regnamespace) LOOP
 expected_owner:=own; extra:=NULL;
 IF NOT (CASE new_function_row.proname
 WHEN 'scheduler_immutable' THEN new_function_row.pronamespace='character_production'::regnamespace AND new_function_row.proargtypes=''::oidvector AND new_function_row.prorettype='trigger'::regtype AND NOT new_function_row.prosecdef
 WHEN 'scheduler_binding_revoke' THEN new_function_row.pronamespace='character_production'::regnamespace AND new_function_row.proargtypes=''::oidvector AND new_function_row.prorettype='trigger'::regtype AND new_function_row.prosecdef
 WHEN 'scheduler_current' THEN new_function_row.pronamespace='character_production'::regnamespace AND new_function_row.proargtypes='2950'::oidvector AND new_function_row.prorettype=(SELECT typ.oid FROM pg_type typ JOIN pg_namespace ns ON ns.oid=typ.typnamespace WHERE ns.nspname='character_production' AND typ.typname='scheduler_enrollments' AND typ.typtype='c') AND new_function_row.prosecdef
 WHEN 'character_production_scheduler_context' THEN new_function_row.pronamespace='public'::regnamespace AND new_function_row.proargtypes='2950'::oidvector AND new_function_row.prorettype='jsonb'::regtype AND new_function_row.prosecdef
 WHEN 'character_production_scheduler_reconciled' THEN new_function_row.pronamespace='public'::regnamespace AND new_function_row.proargtypes='2950 23'::oidvector AND new_function_row.prorettype='boolean'::regtype AND new_function_row.prosecdef
 WHEN 'character_production_scheduler_plan' THEN new_function_row.pronamespace='public'::regnamespace AND new_function_row.proargtypes='2950 23 3802'::oidvector AND new_function_row.prorettype='jsonb'::regtype AND new_function_row.prosecdef
 ELSE false END) OR new_function_row.proowner<>expected_owner OR new_function_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'Scheduler function identity mismatch'; END IF;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(new_function_row.proacl,acldefault('f',new_function_row.proowner)))), e AS (SELECT expected_owner grantor,expected_owner grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT expected_owner,extra,'EXECUTE',false WHERE extra IS NOT NULL) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Planner function ACL mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc p WHERE NOT EXISTS(SELECT 1 FROM si_functions b WHERE b.oid=p.oid) AND p.pronamespace IN ('public'::regnamespace,'character_production'::regnamespace,'auth'::regnamespace))<>6 THEN RAISE EXCEPTION 'Unexpected planner functions'; END IF;
 IF (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND NOT EXISTS(SELECT 1 FROM si_triggers b WHERE b.oid=t.oid))<>3 THEN RAISE EXCEPTION 'Unexpected scheduler triggers'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc f ON f.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND NOT EXISTS(SELECT 1 FROM si_triggers b WHERE b.oid=t.oid) AND (t.tgtype<>27 OR t.tgenabled<>'O' OR t.tgqual IS NOT NULL OR t.tgnargs<>0 OR f.proowner<>own OR NOT ((t.tgname='scheduler_enrollment_immutable' AND f.proname='scheduler_immutable' AND c.relname='scheduler_enrollments') OR (t.tgname='scheduler_candidate_immutable' AND f.proname='scheduler_immutable' AND c.relname='scheduler_candidates') OR (t.tgname='scheduler_binding_revoke' AND f.proname='scheduler_binding_revoke' AND c.relname='scheduler_binding')))) THEN RAISE EXCEPTION 'Scheduler trigger mismatch'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Temporary authority remains'; END IF;
END $$;
COMMIT;

