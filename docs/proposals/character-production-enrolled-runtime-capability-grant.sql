-- OFFLINE REVIEW ONLY: no activation/enrollment. Six exact wrapper/read grants; supersedes the unexecuted three-wrapper proposal.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Direct reviewed PG17 source owner required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='character_production_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN RAISE EXCEPTION 'Restricted owner required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN RAISE EXCEPTION 'Existing service role required'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected temporary authority'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor<>current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option)<>1 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor=current_user::regrole) THEN RAISE EXCEPTION 'Bootstrap membership mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member='character_production_owner'::regrole OR (roleid='character_production_owner'::regrole AND member<>current_user::regrole)) THEN RAISE EXCEPTION 'Unsafe ledger owner memberships'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role' AND NOT rolcanlogin AND NOT rolsuper AND rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolbypassrls) OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator' AND rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN RAISE EXCEPTION 'Service proxy role baseline mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member='service_role'::regrole) OR (SELECT count(*) FROM pg_auth_members WHERE roleid='service_role'::regrole)<>2 OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid='service_role'::regrole AND NOT (m.grantor=(SELECT grantor FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option) AND ((m.member='authenticator'::regrole AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option) OR (m.member=current_user::regrole AND m.admin_option AND m.inherit_option AND m.set_option)))) THEN RAISE EXCEPTION 'Service role membership baseline mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_storage_admin' AND rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND rolconfig=ARRAY['search_path=storage','log_statement=none']::text[]) THEN RAISE EXCEPTION 'Managed Storage role baseline mismatch'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE member='supabase_storage_admin'::regrole OR roleid='supabase_storage_admin'::regrole)<>1 OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member='supabase_storage_admin'::regrole AND roleid='authenticator'::regrole AND grantor=(SELECT oid FROM pg_roles WHERE rolname='supabase_admin') AND NOT admin_option AND NOT inherit_option AND set_option) THEN RAISE EXCEPTION 'Managed Storage membership baseline mismatch'; END IF;
 IF NOT pg_has_role('supabase_storage_admin','service_role','SET') OR pg_has_role('supabase_storage_admin','service_role','USAGE') THEN RAISE EXCEPTION 'Managed Storage effective path mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND r.oid NOT IN (current_user::regrole,'service_role'::regrole,'authenticator'::regrole,'supabase_storage_admin'::regrole) AND (pg_has_role(r.oid,'service_role','USAGE') OR pg_has_role(r.oid,'service_role','SET'))) THEN RAISE EXCEPTION 'Unexpected effective service principal'; END IF;
END $$;
CREATE TEMP TABLE cg_expected(sig text PRIMARY KEY,body text) ON COMMIT DROP;
INSERT INTO cg_expected VALUES('public.character_production_scheduler_context(uuid)',$expected$
DECLARE e character_production.scheduler_enrollments;
BEGIN
 e:=character_production.scheduler_current(p_enrollment); IF e.id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('enrollmentId',e.id,'actorId',e.actor_id,'manifestSha256',e.manifest_sha256,
 'policy',public.character_production_planning_policy(e.policy_id),'candidates',
 (SELECT coalesce(jsonb_agg(jsonb_build_object('ordinal',c.ordinal,'slot',c.slot,'digest',c.digest,'draftId',c.draft_id,'theme',c.theme,'scheduledAt',to_char(c.scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY c.ordinal),'[]'::jsonb)
 FROM character_production.scheduler_candidates c WHERE c.enrollment_id=e.id));
END $expected$);
INSERT INTO cg_expected VALUES('public.character_production_scheduler_reconciled(uuid,integer)',$expected$
DECLARE e character_production.scheduler_enrollments; c character_production.scheduler_candidates;
BEGIN
 e:=character_production.scheduler_current(p_enrollment); IF e.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO c FROM character_production.scheduler_candidates WHERE enrollment_id=e.id AND ordinal=p_ordinal;
 IF c.enrollment_id IS NULL THEN RETURN NULL; END IF;
 RETURN public.character_production_planned_draft(c.draft_id,c.slot,c.digest,c.theme);
END $expected$);
INSERT INTO cg_expected VALUES('public.character_production_scheduler_plan(uuid,integer,jsonb)',$expected$
DECLARE e character_production.scheduler_enrollments; c character_production.scheduler_candidates;
BEGIN
 e:=character_production.scheduler_current(p_enrollment); IF e.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO c FROM character_production.scheduler_candidates WHERE enrollment_id=e.id AND ordinal=p_ordinal;
 IF c.enrollment_id IS NULL THEN RETURN NULL; END IF;
 RETURN public.character_production_plan(c.slot,c.digest,jsonb_build_object('version',1,'draftId',c.draft_id,'scheduledAt',to_char(c.scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'theme',c.theme,'validation',p_validation),e.policy_id,e.policy_revision,e.actor_id);
END $expected$);
INSERT INTO cg_expected VALUES('public.character_production_scheduler_due(uuid,text,text,integer)',$expected$
DECLARE e character_production.scheduler_enrollments; result jsonb;
BEGIN
 e:=character_production.scheduler_current(p_enrollment);
 IF e.id IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>25 THEN RETURN NULL; END IF;
 WITH observed AS (SELECT clock_timestamp() at), due AS (
 SELECT jsonb_build_object('slot',a.slot,'digest',a.digest,'scheduledAt',floor(extract(epoch FROM s.scheduled_at)*1000)::bigint,'notAfter',floor(extract(epoch FROM s.not_after)*1000)::bigint) row,s.scheduled_at,a.key
 FROM character_production.scheduler_candidates c
 JOIN character_production.approved_slots a ON a.key=c.slot->>'key' AND a.digest=c.digest AND a.slot=c.slot
 JOIN character_production.schedules s ON s.key=a.key AND s.digest=a.digest AND s.scheduled_at=c.scheduled_at
 JOIN character_production.budgets b ON b.provider=a.slot->>'provider' AND b.period=a.slot->>'period'
 CROSS JOIN observed o
 WHERE c.enrollment_id=e.id AND s.enabled AND a.enabled AND b.enabled
 AND (b.provider<>'heygen' OR b.cap_cents<=2000)
 AND a.slot->>'provider'=p_provider AND a.slot->>'model'=p_model
 AND a.slot->>'period'=character_production.calendar_period(p_provider,o.at)
 AND b.cap_cents=(a.slot->>'periodCapCents')::bigint
 AND s.scheduled_at<=o.at AND s.not_after>o.at
 AND s.not_after=to_timestamp((a.slot->>'authorizationExpiresAt')::numeric/1000)
 AND NOT EXISTS(SELECT 1 FROM character_production.jobs j WHERE j.key=a.key)
 ORDER BY s.scheduled_at,a.key LIMIT p_limit
 ) SELECT jsonb_build_object('observedAt',floor(extract(epoch FROM o.at)*1000)::bigint,'rows',coalesce((SELECT jsonb_agg(d.row ORDER BY d.scheduled_at,d.key) FROM due d),'[]'::jsonb)) INTO result FROM observed o;
 RETURN result;
END $expected$);
INSERT INTO cg_expected VALUES('public.character_production_scheduler_pending(uuid,text,text,integer)',$expected$
DECLARE e character_production.scheduler_enrollments; result jsonb;
BEGIN
 e:=character_production.scheduler_current(p_enrollment);
 IF e.id IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>5 THEN RETURN NULL; END IF;
 SELECT coalesce(jsonb_agg(x.j ORDER BY x.created_at,x.key),'[]'::jsonb) INTO result FROM (
 SELECT jsonb_build_object('key',j.key,'token',j.token,'digest',j.digest,'taskId',j.task,'provider',j.provider,'model',j.model,'providerBindingRevision',j.provider_binding_revision) j,j.created_at,j.key
 FROM character_production.jobs j
 JOIN character_production.scheduler_candidates c ON c.slot->>'key'=j.key AND c.digest=j.digest AND c.slot=j.slot
 WHERE c.enrollment_id=e.id AND j.state='submitted' AND j.provider=p_provider AND j.model=p_model
 ORDER BY j.created_at,j.key LIMIT p_limit
 ) x;
 RETURN result;
END $expected$);
INSERT INTO cg_expected VALUES('public.character_production_scheduler_qa_ready(uuid,integer)',$expected$
DECLARE e character_production.scheduler_enrollments; result jsonb;
BEGIN
 e:=character_production.scheduler_current(p_enrollment);
 IF e.id IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>5 THEN RETURN NULL; END IF;
 SELECT coalesce(jsonb_agg(x.identity ORDER BY x.created_at,x.key),'[]'::jsonb) INTO result FROM (
 SELECT jsonb_build_object('key',j.key,'digest',j.digest) identity,j.created_at,j.key
 FROM character_production.jobs j
 JOIN character_production.scheduler_candidates c ON c.enrollment_id=e.id AND c.slot=j.slot AND c.digest=j.digest AND c.slot->>'key'=j.key
 JOIN character_production.approved_slots a ON a.key=j.key AND a.digest=j.digest AND a.slot=j.slot AND a.enabled=true
 JOIN character_production.qa_slot_bindings b ON b.slot_key=j.key AND b.digest=j.digest AND b.slot=j.slot AND b.enabled=true AND b.promo_id=c.draft_id
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
 ORDER BY j.created_at,j.key LIMIT p_limit) x;
 RETURN result;
END $expected$);
CREATE TEMP TABLE cg_dependencies(sig text,body text,definer boolean) ON COMMIT DROP;
INSERT INTO cg_dependencies VALUES('character_production.scheduler_current(uuid)',$expected$
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
END $expected$,true);
INSERT INTO cg_dependencies VALUES('character_production.scheduler_immutable()',$expected$
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
END $expected$,false);
INSERT INTO cg_dependencies VALUES('character_production.scheduler_binding_revoke()',$expected$
BEGIN
 IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 UPDATE character_production.scheduler_enrollments SET enabled=false WHERE id=OLD.enrollment_id AND enabled;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $expected$,true);
DO $$ DECLARE expected record; f record; own oid:='character_production_owner'::regrole; BEGIN
 FOR expected IN SELECT * FROM cg_dependencies LOOP
 -- Catalog lookup avoids asking source owner for private schema USAGE.
 SELECT p.* INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='character_production' AND p.proname=split_part(split_part(expected.sig,'.',2),'(',1)
 AND p.proargtypes=CASE WHEN expected.sig LIKE '%scheduler_current%' THEN '2950'::oidvector ELSE ''::oidvector END;
 IF NOT FOUND OR f.proowner<>own OR f.prosecdef IS DISTINCT FROM expected.definer OR f.prosrc IS DISTINCT FROM expected.body OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR f.prokind<>'f' OR f.provolatile<>'v' OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR f.prorettype<>(CASE WHEN expected.sig LIKE '%scheduler_current%' THEN (SELECT t.oid FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='character_production' AND t.typname='scheduler_enrollments' AND t.typtype='c') ELSE 'trigger'::regtype END) THEN RAISE EXCEPTION 'Scoped dependency identity/body mismatch'; END IF;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Scoped dependency ACL mismatch'; END IF;
 END LOOP;
END $$;

DO $$ DECLARE expected record; f record; own oid:='character_production_owner'::regrole; BEGIN
 FOR expected IN SELECT * FROM cg_expected LOOP
 SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure(expected.sig);
 IF NOT FOUND OR f.proowner<>own OR NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR f.prosrc IS DISTINCT FROM expected.body OR f.provolatile<>'v' OR f.prokind<>'f' OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR f.prorettype<>(CASE WHEN expected.sig LIKE '%reconciled%' THEN 'boolean'::regtype ELSE 'jsonb'::regtype END) THEN RAISE EXCEPTION 'Scoped wrapper identity/body mismatch'; END IF;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Scoped wrapper baseline ACL mismatch'; END IF;
 END LOOP;
END $$;
LOCK TABLE public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks IN SHARE MODE;
CREATE TEMP TABLE cg_source ON COMMIT DROP AS SELECT 'drafts' name,to_jsonb(x) data FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x;
CREATE TEMP TABLE cg_triggers ON COMMIT DROP AS SELECT oid,to_jsonb(t) data FROM pg_trigger t;
CREATE TEMP TABLE cg_role_attributes ON COMMIT DROP AS SELECT * FROM pg_roles;
CREATE TEMP TABLE cg_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE cg_defaults ON COMMIT DROP AS SELECT * FROM pg_default_acl;
CREATE TEMP TABLE cg_namespaces ON COMMIT DROP AS SELECT oid,nspowner,nspacl FROM pg_namespace;
CREATE TEMP TABLE cg_tables ON COMMIT DROP AS SELECT oid,relowner,relacl,relrowsecurity,relforcerowsecurity FROM pg_class;
CREATE TEMP TABLE cg_columns ON COMMIT DROP AS SELECT attrelid,attnum,attacl FROM pg_attribute;
CREATE TEMP TABLE cg_policies ON COMMIT DROP AS SELECT oid,to_jsonb(p) data FROM pg_policy p;
CREATE TEMP TABLE cg_functions ON COMMIT DROP AS SELECT oid,proowner,proacl,pg_get_functiondef(oid) def FROM pg_proc WHERE prokind='f';
GRANT character_production_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
SET LOCAL ROLE character_production_owner;
CREATE TEMP TABLE cg_rows(name text,data jsonb) ON COMMIT DROP;
DO $$ DECLARE obj record; BEGIN
 FOR obj IN SELECT relname FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relkind='r' LOOP
 EXECUTE format('LOCK TABLE character_production.%I IN SHARE MODE',obj.relname);
 EXECUTE format('INSERT INTO cg_rows SELECT %L,to_jsonb(r) FROM character_production.%I r',obj.relname,obj.relname);
 END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.character_production_scheduler_context(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.character_production_scheduler_reconciled(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.character_production_scheduler_plan(uuid,integer,jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public.character_production_scheduler_due(uuid,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.character_production_scheduler_pending(uuid,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.character_production_scheduler_qa_ready(uuid,integer) TO service_role;
CREATE TEMP TABLE cg_after(name text,data jsonb) ON COMMIT DROP;
DO $$ DECLARE obj record; BEGIN
 FOR obj IN SELECT relname FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relkind='r' LOOP
 EXECUTE format('INSERT INTO cg_after SELECT %L,to_jsonb(r) FROM character_production.%I r',obj.relname,obj.relname);
 END LOOP;
 IF EXISTS((SELECT * FROM cg_rows EXCEPT ALL SELECT * FROM cg_after) UNION ALL (SELECT * FROM cg_after EXCEPT ALL SELECT * FROM cg_rows)) THEN RAISE EXCEPTION 'Ledger rows changed'; END IF;
END $$;
RESET ROLE;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE f record; own oid:='character_production_owner'::regrole; target oid:='service_role'::regrole; BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE prokind='f')<>(SELECT count(*) FROM cg_functions) THEN RAISE EXCEPTION 'Function set changed'; END IF;
 IF (SELECT count(*) FROM cg_expected)<>6 THEN RAISE EXCEPTION 'Expected exact six capabilities'; END IF;
 IF EXISTS(WITH actual AS (SELECT 'drafts' name,to_jsonb(x) data FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x) (SELECT * FROM actual EXCEPT ALL SELECT * FROM cg_source) UNION ALL (SELECT * FROM cg_source EXCEPT ALL SELECT * FROM actual)) THEN RAISE EXCEPTION 'Source rows changed'; END IF;
 IF EXISTS(SELECT 1 FROM cg_triggers b LEFT JOIN pg_trigger t USING(oid) WHERE t.oid IS NULL OR to_jsonb(t) IS DISTINCT FROM b.data) OR (SELECT count(*) FROM pg_trigger)<>(SELECT count(*) FROM cg_triggers) THEN RAISE EXCEPTION 'Triggers changed'; END IF;
 IF EXISTS((SELECT * FROM pg_roles EXCEPT SELECT * FROM cg_role_attributes) UNION ALL (SELECT * FROM cg_role_attributes EXCEPT SELECT * FROM pg_roles)) THEN RAISE EXCEPTION 'Role attributes changed'; END IF;
 IF EXISTS((SELECT * FROM pg_auth_members EXCEPT SELECT * FROM cg_members) UNION ALL (SELECT * FROM cg_members EXCEPT SELECT * FROM pg_auth_members)) OR EXISTS((SELECT * FROM pg_default_acl EXCEPT SELECT * FROM cg_defaults) UNION ALL (SELECT * FROM cg_defaults EXCEPT SELECT * FROM pg_default_acl)) THEN RAISE EXCEPTION 'Membership/default ACL changed'; END IF;
 IF EXISTS(SELECT 1 FROM cg_namespaces b LEFT JOIN pg_namespace n USING(oid) WHERE n.oid IS NULL OR n.nspowner IS DISTINCT FROM b.nspowner OR n.nspacl IS DISTINCT FROM b.nspacl) OR EXISTS(SELECT 1 FROM cg_tables b LEFT JOIN pg_class c USING(oid) WHERE c.oid IS NULL OR c.relowner IS DISTINCT FROM b.relowner OR c.relacl IS DISTINCT FROM b.relacl OR c.relrowsecurity IS DISTINCT FROM b.relrowsecurity OR c.relforcerowsecurity IS DISTINCT FROM b.relforcerowsecurity) OR EXISTS(SELECT 1 FROM cg_columns b LEFT JOIN pg_attribute a USING(attrelid,attnum) WHERE a.attrelid IS NULL OR a.attacl IS DISTINCT FROM b.attacl) THEN RAISE EXCEPTION 'Existing object authority changed'; END IF;
 IF EXISTS(SELECT 1 FROM cg_policies b LEFT JOIN pg_policy p USING(oid) WHERE p.oid IS NULL OR to_jsonb(p) IS DISTINCT FROM b.data) OR (SELECT count(*) FROM pg_policy)<>(SELECT count(*) FROM cg_policies) THEN RAISE EXCEPTION 'Policies changed'; END IF;
 IF EXISTS(SELECT 1 FROM cg_functions b LEFT JOIN pg_proc p USING(oid) WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM b.proowner OR pg_get_functiondef(p.oid) IS DISTINCT FROM b.def OR (NOT EXISTS(SELECT 1 FROM cg_expected e WHERE to_regprocedure(e.sig)=p.oid) AND p.proacl IS DISTINCT FROM b.proacl)) THEN RAISE EXCEPTION 'Unrelated function changed'; END IF;
 FOR f IN SELECT p.* FROM pg_proc p JOIN cg_expected e ON p.oid=to_regprocedure(e.sig) LOOP
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT own,target,'EXECUTE',false) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Scoped wrapper result ACL mismatch'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN cg_expected e WHERE NOT r.rolsuper AND r.oid NOT IN (current_user::regrole,'character_production_owner'::regrole,'service_role'::regrole,'authenticator'::regrole,'supabase_storage_admin'::regrole) AND has_function_privilege(r.oid,to_regprocedure(e.sig),'EXECUTE')) THEN RAISE EXCEPTION 'Unexpected effective wrapper grantee'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Temporary authority remains'; END IF;
END $$;
COMMIT;

