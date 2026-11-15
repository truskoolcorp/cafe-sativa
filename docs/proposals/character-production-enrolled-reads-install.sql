-- OFFLINE REVIEW ONLY. Prerequisites: reviewed recurring QA and HeyGen wallet
-- guard already installed. Three owner-only scoped reads, no runtime grants/rows/activation.
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
 IF (SELECT count(*) FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relname IN ('scheduler_enrollments','scheduler_candidates','scheduler_binding') AND relowner='character_production_owner'::regrole AND relrowsecurity AND NOT relforcerowsecurity)<>3 THEN RAISE EXCEPTION 'Principal tables missing or changed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'character_production'::regnamespace,'auth'::regnamespace) AND proname IN ('character_production_scheduler_due','character_production_scheduler_pending','character_production_scheduler_qa_ready')) THEN RAISE EXCEPTION 'Scoped reads already exist: reconcile'; END IF;
END $$;
DO $$ DECLARE f record; own oid:='character_production_owner'::regrole; extra oid; BEGIN
 FOR f IN SELECT p.* FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.character_production_plan(jsonb,text,jsonb,uuid,bigint,uuid)'),to_regprocedure('public.character_production_planning_policy(uuid)'),to_regprocedure('public.character_production_planned_draft(uuid,jsonb,text,text)')) LOOP
 IF f.proowner<>own OR NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'Planner dependency identity mismatch'; END IF;
 extra:=CASE WHEN f.proname='character_production_planned_draft' THEN current_user::regrole::oid ELSE NULL END;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT own,extra,'EXECUTE',false WHERE extra IS NOT NULL) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Planner dependency ACL mismatch'; END IF;
 END LOOP;
 IF to_regprocedure('public.character_production_planning_policy(uuid)') IS NULL OR to_regprocedure('public.character_production_planned_draft(uuid,jsonb,text,text)') IS NULL THEN RAISE EXCEPTION 'Planner readers missing'; END IF;
END $$;
DO $$ DECLARE f pg_proc; own oid:='character_production_owner'::regrole; extra oid; BEGIN
 SELECT p.* INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='character_production' AND p.proname='scheduler_current' AND p.proargtypes='2950'::oidvector;
 IF NOT FOUND OR f.proowner<>own OR f.prosecdef IS DISTINCT FROM true OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR f.prosrc IS DISTINCT FROM '
DECLARE e character_production.scheduler_enrollments; p character_production.planning_policies; pid uuid;
BEGIN
 SELECT policy_id INTO pid FROM character_production.scheduler_enrollments WHERE id=p_id;
 IF pid IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO p FROM character_production.planning_policies WHERE id=pid FOR UPDATE;
 SELECT * INTO e FROM character_production.scheduler_enrollments WHERE id=p_id FOR UPDATE;
 IF e.id IS NULL OR NOT EXISTS(SELECT 1 FROM character_production.scheduler_binding b
 WHERE b.name=''cafe-character-planner'' AND b.enabled AND b.enrollment_id=e.id)
 OR e.candidate_snapshot IS DISTINCT FROM
 (SELECT coalesce(jsonb_agg(jsonb_build_object(''ordinal'',c.ordinal,''slot'',c.slot,''digest'',c.digest,''draftId'',c.draft_id,''theme'',c.theme,''scheduledAt'',to_char(c.scheduled_at AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'')) ORDER BY c.ordinal),''[]''::jsonb)
 FROM character_production.scheduler_candidates c WHERE c.enrollment_id=e.id)
 OR NOT e.enabled OR NOT p.enabled OR e.policy_revision<>p.revision
 OR e.policy_snapshot IS DISTINCT FROM to_jsonb(p) OR e.approved_at>clock_timestamp()
 OR e.expires_at<=clock_timestamp() OR p.expires_at<=clock_timestamp() OR e.expires_at>p.expires_at
 OR EXISTS(SELECT 1 FROM character_production.scheduler_candidates c WHERE c.enrollment_id=e.id
 AND (c.scheduled_at<e.approved_at OR c.scheduled_at>=e.expires_at OR
 (CASE WHEN jsonb_typeof(c.slot->''authorizationExpiresAt'')=''number''
 AND c.slot->>''authorizationExpiresAt'' ~ ''^[0-9]{1,16}$''
 THEN (c.slot->>''authorizationExpiresAt'')::numeric>extract(epoch FROM c.scheduled_at)*1000
 AND (c.slot->>''authorizationExpiresAt'')::numeric<=extract(epoch FROM e.expires_at)*1000
 ELSE false END) IS NOT TRUE))
 OR public.cs_cafe_metricool_is_admin(e.actor_id) IS DISTINCT FROM true THEN RETURN NULL; END IF;
 RETURN e;
END ' THEN RAISE EXCEPTION 'Dependency definition mismatch: character_production.scheduler_current'; END IF;
 extra:=NULL;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT own,extra,'EXECUTE',false WHERE extra IS NOT NULL) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Dependency ACL mismatch'; END IF;
 SELECT p.* INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='character_production' AND p.proname='calendar_period' AND p.proargtypes='25 1184'::oidvector;
 IF NOT FOUND OR f.proowner<>own OR f.prosecdef IS DISTINCT FROM false OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR f.prosrc IS DISTINCT FROM '
 SELECT to_char(p_at AT TIME ZONE CASE WHEN p_provider=''heygen'' THEN ''America/Chicago'' ELSE ''UTC'' END,''YYYY-MM'')
' THEN RAISE EXCEPTION 'Dependency definition mismatch: character_production.calendar_period'; END IF;
 extra:=NULL;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT own,extra,'EXECUTE',false WHERE extra IS NOT NULL) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Dependency ACL mismatch'; END IF;
 SELECT p.* INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='character_production_due' AND p.proargtypes='25 25 23'::oidvector;
 IF NOT FOUND OR f.proowner<>own OR f.prosecdef IS DISTINCT FROM true OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR f.prosrc IS DISTINCT FROM '
 WITH observed AS (SELECT clock_timestamp() AS at), due AS (
  SELECT jsonb_build_object(''slot'',a.slot,''digest'',a.digest,
   ''scheduledAt'',floor(extract(epoch FROM s.scheduled_at)*1000)::bigint,
   ''notAfter'',floor(extract(epoch FROM s.not_after)*1000)::bigint) AS row,
   s.scheduled_at,a.key
  FROM character_production.schedules s
  JOIN character_production.approved_slots a ON a.key=s.key AND a.digest=s.digest
  JOIN character_production.budgets b ON b.provider=a.slot->>''provider'' AND b.period=a.slot->>''period''
  CROSS JOIN observed o
  WHERE s.enabled AND a.enabled AND b.enabled AND (b.provider<>''heygen'' OR b.cap_cents<=2000)
   AND a.slot->>''provider''=p_provider AND a.slot->>''model''=p_model
   AND a.slot->>''period''=character_production.calendar_period(p_provider,o.at)
   AND b.cap_cents=(a.slot->>''periodCapCents'')::bigint
   AND s.scheduled_at<=o.at AND s.not_after>o.at
   AND s.not_after=to_timestamp((a.slot->>''authorizationExpiresAt'')::numeric/1000)
   AND NOT EXISTS (SELECT 1 FROM character_production.jobs j WHERE j.key=a.key)
  ORDER BY s.scheduled_at,a.key LIMIT greatest(0,least(p_limit,25))
 ) SELECT jsonb_build_object(''observedAt'',floor(extract(epoch FROM o.at)*1000)::bigint,
  ''rows'',coalesce((SELECT jsonb_agg(d.row ORDER BY d.scheduled_at,d.key) FROM due d),''[]''::jsonb)) FROM observed o
' THEN RAISE EXCEPTION 'Dependency definition mismatch: public.character_production_due'; END IF;
 extra:='service_role'::regrole;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT own,extra,'EXECUTE',false WHERE extra IS NOT NULL) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Dependency ACL mismatch'; END IF;
 SELECT p.* INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='character_production_pending' AND p.proargtypes='25 25 23'::oidvector;
 IF NOT FOUND OR f.proowner<>own OR f.prosecdef IS DISTINCT FROM true OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR f.prosrc IS DISTINCT FROM '
 SELECT coalesce(jsonb_agg(x.j),''[]''::jsonb) FROM (
 SELECT jsonb_build_object(''key'',key,''token'',token,''digest'',digest,''taskId'',task,''provider'',provider,''model'',model,''providerBindingRevision'',provider_binding_revision) j
 FROM character_production.jobs WHERE state=''submitted'' AND provider=p_provider AND model=p_model
 ORDER BY created_at,key LIMIT greatest(0,least(p_limit,5))) x
' THEN RAISE EXCEPTION 'Dependency definition mismatch: public.character_production_pending'; END IF;
 extra:='service_role'::regrole;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT own,extra,'EXECUTE',false WHERE extra IS NOT NULL) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Dependency ACL mismatch'; END IF;
 SELECT p.* INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='character_production_qa_ready_slots' AND p.proargtypes='23'::oidvector;
 IF NOT FOUND OR f.proowner<>own OR f.prosecdef IS DISTINCT FROM true OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR f.prosrc IS DISTINCT FROM '
 SELECT coalesce(jsonb_agg(x.identity),''[]''::jsonb) FROM (
 SELECT jsonb_build_object(''key'',j.key,''digest'',j.digest) identity
 FROM character_production.jobs j
 JOIN character_production.approved_slots a ON a.key=j.key AND a.digest=j.digest AND a.slot=j.slot AND a.enabled=true
 JOIN character_production.qa_slot_bindings b ON b.slot_key=j.key AND b.digest=j.digest AND b.slot=j.slot AND b.enabled=true
 JOIN public.cs_character_promo_drafts d ON d.id=b.promo_id
 WHERE j.state=''pending_qa'' AND public.character_production_qa_draft_unplanned(b.promo_id) AND d.updated_at=b.expected_updated_at
 AND d.character_id=j.slot->>''characterId'' AND d.spoken_script=j.slot->>''script''
 AND j.slot->>''characterId'' ~ ''^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$'' AND length(btrim(j.slot->>''script''))>0
 AND d.status IN (''draft'',''revision_requested'') AND d.video_asset_path IS NULL AND d.audio_asset_path IS NULL
 AND d.voice_approved_at IS NULL AND d.video_qa_approved_at IS NULL AND d.publication_approved_at IS NULL
 AND j.sha ~ ''^[a-f0-9]{64}$'' AND j.bytes BETWEEN 16 AND 36700160
 AND j.bucket=''character-production-private'' AND j.object_path=j.digest||''/''||j.sha||''.mp4''
 AND NOT EXISTS(SELECT 1 FROM character_production.qa_ingestion_receipts r WHERE r.job_key=j.key)
 AND NOT EXISTS(SELECT 1 FROM character_production.qa_targets t WHERE t.job_key=j.key AND
 (t.enabled IS DISTINCT FROM true OR t.digest IS DISTINCT FROM b.digest OR t.promo_id IS DISTINCT FROM b.promo_id OR t.expected_updated_at IS DISTINCT FROM b.expected_updated_at))
 ORDER BY j.created_at,j.key LIMIT greatest(0,least(coalesce(p_limit,0),5))) x
' THEN RAISE EXCEPTION 'Dependency definition mismatch: public.character_production_qa_ready_slots'; END IF;
 extra:='service_role'::regrole;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT own,extra,'EXECUTE',false WHERE extra IS NOT NULL) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Dependency ACL mismatch'; END IF;
 SELECT p.* INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='character_production_qa_materialize' AND p.proargtypes='25 25'::oidvector;
 IF NOT FOUND OR f.proowner<>own OR f.prosecdef IS DISTINCT FROM true OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR f.prosrc IS DISTINCT FROM '
DECLARE a character_production.approved_slots; j character_production.jobs;
 b character_production.qa_slot_bindings; d public.cs_character_promo_drafts;
 t character_production.qa_targets;
BEGIN
 IF current_setting(''transaction_isolation'') IS DISTINCT FROM ''read committed'' THEN RETURN false; END IF;
 -- Same lock ordering as qa_manifest; binding is locked before the draft.
 SELECT * INTO a FROM character_production.approved_slots WHERE key=p_key FOR UPDATE;
 IF NOT FOUND OR a.enabled IS DISTINCT FROM true OR a.digest IS DISTINCT FROM p_digest THEN RETURN false; END IF;
 SELECT * INTO j FROM character_production.jobs WHERE key=p_key FOR UPDATE;
 IF NOT FOUND OR j.digest IS DISTINCT FROM p_digest OR a.slot IS DISTINCT FROM j.slot
 OR j.state IS DISTINCT FROM ''pending_qa'' OR j.sha IS NULL OR j.sha !~ ''^[a-f0-9]{64}$''
 OR j.bytes IS NULL OR j.bytes NOT BETWEEN 16 AND 36700160
 OR j.bucket IS DISTINCT FROM ''character-production-private''
 OR j.object_path IS DISTINCT FROM j.digest||''/''||j.sha||''.mp4'' THEN RETURN false; END IF;
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
 OR d.character_id IS DISTINCT FROM a.slot->>''characterId''
 OR d.spoken_script IS DISTINCT FROM a.slot->>''script''
 OR a.slot->>''characterId'' IS NULL OR a.slot->>''characterId'' !~ ''^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$''
 OR a.slot->>''script'' IS NULL OR length(btrim(a.slot->>''script''))=0
 OR d.status IS NULL OR d.status NOT IN (''draft'',''revision_requested'')
 OR d.audio_asset_path IS NOT NULL OR d.video_asset_path IS NOT NULL
 OR d.voice_approved_at IS NOT NULL OR d.video_qa_approved_at IS NOT NULL
 OR d.publication_approved_at IS NOT NULL THEN RETURN false; END IF;
 -- Unique promo_id prevents a second job claiming the same draft. Conflict is
 -- refusal, never reassignment. No job, source, budget or paid state is written.
 INSERT INTO character_production.qa_targets(job_key,digest,promo_id,expected_updated_at,enabled)
 VALUES(p_key,p_digest,b.promo_id,b.expected_updated_at,true) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END ' THEN RAISE EXCEPTION 'Dependency definition mismatch: public.character_production_qa_materialize'; END IF;
 extra:='service_role'::regrole;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT own,extra,'EXECUTE',false WHERE extra IS NOT NULL) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Dependency ACL mismatch'; END IF;
 SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('public.character_production_qa_draft_unplanned(uuid)');
 IF NOT FOUND OR f.proowner<>current_user::regrole OR NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR f.prosrc IS DISTINCT FROM '
 SELECT p_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.cs_character_promo_drafts d WHERE d.id=p_id)
 AND NOT EXISTS(SELECT 1 FROM public.cs_character_promo_delivery_plans p WHERE p.promo_id=p_id)
' THEN RAISE EXCEPTION 'Source-owned unplanned dependency mismatch'; END IF;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner)))), e AS (SELECT f.proowner grantor,f.proowner grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT f.proowner,own,'EXECUTE',false) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Source-owned unplanned ACL mismatch'; END IF;
END $$;
LOCK TABLE public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks IN SHARE MODE;
CREATE TEMP TABLE si_source ON COMMIT DROP AS SELECT 'drafts' name,to_jsonb(x) row FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x;
CREATE TEMP TABLE si_roles ON COMMIT DROP AS SELECT * FROM pg_roles;
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

CREATE FUNCTION public.character_production_scheduler_due(p_enrollment uuid,p_provider text,p_model text,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
END $$;
CREATE FUNCTION public.character_production_scheduler_pending(p_enrollment uuid,p_provider text,p_model text,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.character_production_scheduler_due(uuid,text,text,integer),public.character_production_scheduler_pending(uuid,text,text,integer) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','character_production_generator','character_production_output_broker'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_scheduler_due(uuid,text,text,integer),public.character_production_scheduler_pending(uuid,text,text,integer) FROM %I',r);
 END IF; END LOOP;
END $$;
CREATE FUNCTION public.character_production_scheduler_qa_ready(p_enrollment uuid,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.character_production_scheduler_qa_ready(uuid,integer) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','character_production_generator','character_production_output_broker'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_scheduler_qa_ready(uuid,integer) FROM %I',r); END IF;
 END LOOP;
END $$;
SET LOCAL ROLE character_production_owner;
DO $$ DECLARE t record; BEGIN
 CREATE TEMP TABLE si_rows_after(name text,row jsonb) ON COMMIT DROP;
 FOR t IN SELECT relname FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relkind='r' LOOP
 EXECUTE format('INSERT INTO si_rows_after SELECT %L,to_jsonb(x) FROM character_production.%I x',t.relname,t.relname);
 END LOOP;
 IF EXISTS((SELECT * FROM si_rows EXCEPT ALL SELECT * FROM si_rows_after) UNION ALL (SELECT * FROM si_rows_after EXCEPT ALL SELECT * FROM si_rows)) THEN RAISE EXCEPTION 'Ledger data changed'; END IF;
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM character_production_owner;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE new_function_row record; new_table_row record; own oid:='character_production_owner'::regrole; expected_owner oid; extra oid; BEGIN
 IF EXISTS((SELECT * FROM pg_roles EXCEPT SELECT * FROM si_roles) UNION ALL (SELECT * FROM si_roles EXCEPT SELECT * FROM pg_roles)) THEN RAISE EXCEPTION 'Role attributes changed'; END IF;
 IF EXISTS((SELECT * FROM pg_default_acl EXCEPT SELECT * FROM si_defaults) UNION ALL (SELECT * FROM si_defaults EXCEPT SELECT * FROM pg_default_acl)) THEN RAISE EXCEPTION 'Default ACL changed'; END IF;
 IF EXISTS((SELECT * FROM pg_auth_members EXCEPT SELECT * FROM si_members) UNION ALL (SELECT * FROM si_members EXCEPT SELECT * FROM pg_auth_members)) THEN RAISE EXCEPTION 'Membership changed'; END IF;
 IF EXISTS(SELECT 1 FROM si_ns b LEFT JOIN pg_namespace n USING(oid) WHERE n.oid IS NULL OR n.nspacl IS DISTINCT FROM b.nspacl OR n.nspowner IS DISTINCT FROM b.nspowner) THEN RAISE EXCEPTION 'Schema authority changed'; END IF;
 IF EXISTS(SELECT 1 FROM si_objects b LEFT JOIN pg_class c USING(oid) WHERE c.oid IS NULL OR c.relowner IS DISTINCT FROM b.relowner OR c.relacl IS DISTINCT FROM b.relacl OR c.relrowsecurity IS DISTINCT FROM b.relrowsecurity OR c.relforcerowsecurity IS DISTINCT FROM b.relforcerowsecurity) OR EXISTS(SELECT 1 FROM si_cols b LEFT JOIN pg_attribute a USING(attrelid,attnum) WHERE a.attrelid IS NULL OR a.attacl IS DISTINCT FROM b.attacl) THEN RAISE EXCEPTION 'Existing object authority changed'; END IF;
 IF EXISTS(SELECT 1 FROM si_functions b LEFT JOIN pg_proc p USING(oid) WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM b.proowner OR p.proacl IS DISTINCT FROM b.proacl OR pg_get_functiondef(p.oid) IS DISTINCT FROM b.def) THEN RAISE EXCEPTION 'Existing function changed'; END IF;
 IF EXISTS(SELECT 1 FROM si_policies b LEFT JOIN pg_policy p USING(oid) WHERE p.oid IS NULL OR to_jsonb(p) IS DISTINCT FROM b.data) OR (SELECT count(*) FROM pg_policy)<>(SELECT count(*) FROM si_policies) THEN RAISE EXCEPTION 'Policies changed'; END IF;
 IF EXISTS(SELECT 1 FROM si_triggers b LEFT JOIN pg_trigger t USING(oid) WHERE t.oid IS NULL OR to_jsonb(t) IS DISTINCT FROM b.data) THEN RAISE EXCEPTION 'Existing triggers changed'; END IF;
 IF EXISTS(WITH actual AS (SELECT 'drafts' name,to_jsonb(x) row FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x) (SELECT * FROM actual EXCEPT ALL SELECT * FROM si_source) UNION ALL (SELECT * FROM si_source EXCEPT ALL SELECT * FROM actual)) THEN RAISE EXCEPTION 'Source rows changed'; END IF;
 SELECT * INTO new_function_row FROM pg_proc WHERE oid=to_regprocedure('public.character_production_scheduler_due(uuid,text,text,integer)');
 IF NOT FOUND OR new_function_row.proowner<>own OR NOT new_function_row.prosecdef OR new_function_row.prorettype<>'jsonb'::regtype OR new_function_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR new_function_row.prosrc IS DISTINCT FROM '
DECLARE e character_production.scheduler_enrollments; result jsonb;
BEGIN
 e:=character_production.scheduler_current(p_enrollment);
 IF e.id IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>25 THEN RETURN NULL; END IF;
 WITH observed AS (SELECT clock_timestamp() at), due AS (
 SELECT jsonb_build_object(''slot'',a.slot,''digest'',a.digest,''scheduledAt'',floor(extract(epoch FROM s.scheduled_at)*1000)::bigint,''notAfter'',floor(extract(epoch FROM s.not_after)*1000)::bigint) row,s.scheduled_at,a.key
 FROM character_production.scheduler_candidates c
 JOIN character_production.approved_slots a ON a.key=c.slot->>''key'' AND a.digest=c.digest AND a.slot=c.slot
 JOIN character_production.schedules s ON s.key=a.key AND s.digest=a.digest AND s.scheduled_at=c.scheduled_at
 JOIN character_production.budgets b ON b.provider=a.slot->>''provider'' AND b.period=a.slot->>''period''
 CROSS JOIN observed o
 WHERE c.enrollment_id=e.id AND s.enabled AND a.enabled AND b.enabled
 AND (b.provider<>''heygen'' OR b.cap_cents<=2000)
 AND a.slot->>''provider''=p_provider AND a.slot->>''model''=p_model
 AND a.slot->>''period''=character_production.calendar_period(p_provider,o.at)
 AND b.cap_cents=(a.slot->>''periodCapCents'')::bigint
 AND s.scheduled_at<=o.at AND s.not_after>o.at
 AND s.not_after=to_timestamp((a.slot->>''authorizationExpiresAt'')::numeric/1000)
 AND NOT EXISTS(SELECT 1 FROM character_production.jobs j WHERE j.key=a.key)
 ORDER BY s.scheduled_at,a.key LIMIT p_limit
 ) SELECT jsonb_build_object(''observedAt'',floor(extract(epoch FROM o.at)*1000)::bigint,''rows'',coalesce((SELECT jsonb_agg(d.row ORDER BY d.scheduled_at,d.key) FROM due d),''[]''::jsonb)) INTO result FROM observed o;
 RETURN result;
END ' THEN RAISE EXCEPTION 'Scoped function identity mismatch'; END IF;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(new_function_row.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Scoped function ACL mismatch'; END IF;
 SELECT * INTO new_function_row FROM pg_proc WHERE oid=to_regprocedure('public.character_production_scheduler_pending(uuid,text,text,integer)');
 IF NOT FOUND OR new_function_row.proowner<>own OR NOT new_function_row.prosecdef OR new_function_row.prorettype<>'jsonb'::regtype OR new_function_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR new_function_row.prosrc IS DISTINCT FROM '
DECLARE e character_production.scheduler_enrollments; result jsonb;
BEGIN
 e:=character_production.scheduler_current(p_enrollment);
 IF e.id IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>5 THEN RETURN NULL; END IF;
 SELECT coalesce(jsonb_agg(x.j ORDER BY x.created_at,x.key),''[]''::jsonb) INTO result FROM (
 SELECT jsonb_build_object(''key'',j.key,''token'',j.token,''digest'',j.digest,''taskId'',j.task,''provider'',j.provider,''model'',j.model,''providerBindingRevision'',j.provider_binding_revision) j,j.created_at,j.key
 FROM character_production.jobs j
 JOIN character_production.scheduler_candidates c ON c.slot->>''key''=j.key AND c.digest=j.digest AND c.slot=j.slot
 WHERE c.enrollment_id=e.id AND j.state=''submitted'' AND j.provider=p_provider AND j.model=p_model
 ORDER BY j.created_at,j.key LIMIT p_limit
 ) x;
 RETURN result;
END ' THEN RAISE EXCEPTION 'Scoped function identity mismatch'; END IF;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(new_function_row.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Scoped function ACL mismatch'; END IF;
 SELECT * INTO new_function_row FROM pg_proc WHERE oid=to_regprocedure('public.character_production_scheduler_qa_ready(uuid,integer)');
 IF NOT FOUND OR new_function_row.proowner<>own OR NOT new_function_row.prosecdef OR new_function_row.prorettype<>'jsonb'::regtype OR new_function_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR new_function_row.prosrc IS DISTINCT FROM '
DECLARE e character_production.scheduler_enrollments; result jsonb;
BEGIN
 e:=character_production.scheduler_current(p_enrollment);
 IF e.id IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>5 THEN RETURN NULL; END IF;
 SELECT coalesce(jsonb_agg(x.identity ORDER BY x.created_at,x.key),''[]''::jsonb) INTO result FROM (
 SELECT jsonb_build_object(''key'',j.key,''digest'',j.digest) identity,j.created_at,j.key
 FROM character_production.jobs j
 JOIN character_production.scheduler_candidates c ON c.enrollment_id=e.id AND c.slot=j.slot AND c.digest=j.digest AND c.slot->>''key''=j.key
 JOIN character_production.approved_slots a ON a.key=j.key AND a.digest=j.digest AND a.slot=j.slot AND a.enabled=true
 JOIN character_production.qa_slot_bindings b ON b.slot_key=j.key AND b.digest=j.digest AND b.slot=j.slot AND b.enabled=true AND b.promo_id=c.draft_id
 JOIN public.cs_character_promo_drafts d ON d.id=b.promo_id
 WHERE j.state=''pending_qa'' AND public.character_production_qa_draft_unplanned(b.promo_id) AND d.updated_at=b.expected_updated_at
 AND d.character_id=j.slot->>''characterId'' AND d.spoken_script=j.slot->>''script''
 AND j.slot->>''characterId'' ~ ''^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$'' AND length(btrim(j.slot->>''script''))>0
 AND d.status IN (''draft'',''revision_requested'') AND d.video_asset_path IS NULL AND d.audio_asset_path IS NULL
 AND d.voice_approved_at IS NULL AND d.video_qa_approved_at IS NULL AND d.publication_approved_at IS NULL
 AND j.sha ~ ''^[a-f0-9]{64}$'' AND j.bytes BETWEEN 16 AND 36700160
 AND j.bucket=''character-production-private'' AND j.object_path=j.digest||''/''||j.sha||''.mp4''
 AND NOT EXISTS(SELECT 1 FROM character_production.qa_ingestion_receipts r WHERE r.job_key=j.key)
 AND NOT EXISTS(SELECT 1 FROM character_production.qa_targets t WHERE t.job_key=j.key AND
 (t.enabled IS DISTINCT FROM true OR t.digest IS DISTINCT FROM b.digest OR t.promo_id IS DISTINCT FROM b.promo_id OR t.expected_updated_at IS DISTINCT FROM b.expected_updated_at))
 ORDER BY j.created_at,j.key LIMIT p_limit) x;
 RETURN result;
END ' THEN RAISE EXCEPTION 'Scoped function identity mismatch'; END IF;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(new_function_row.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Scoped function ACL mismatch'; END IF;
 IF (SELECT count(*) FROM pg_proc p WHERE NOT EXISTS(SELECT 1 FROM si_functions b WHERE b.oid=p.oid) AND p.pronamespace IN ('public'::regnamespace,'character_production'::regnamespace,'auth'::regnamespace))<>3 THEN RAISE EXCEPTION 'Unexpected new functions'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace IN ('public'::regnamespace,'character_production'::regnamespace,'auth'::regnamespace) AND NOT EXISTS(SELECT 1 FROM si_objects b WHERE b.oid=c.oid)) THEN RAISE EXCEPTION 'Unexpected new relation'; END IF;
 IF (SELECT count(*) FROM pg_trigger)<>(SELECT count(*) FROM si_triggers) THEN RAISE EXCEPTION 'Triggers changed'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Temporary authority remains'; END IF;
END $$;
COMMIT;

