-- OFFLINE only. No activation, identity change or new auth/table privileges.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Direct reviewed PG17 source owner required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.cs_character_promo_drafts'::regclass AND relowner=current_user::regrole) THEN RAISE EXCEPTION 'Source owner mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='character_production_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN RAISE EXCEPTION 'Restricted ledger owner required'; END IF;
 IF NOT has_schema_privilege(current_user,'auth','USAGE') OR NOT has_column_privilege(current_user,'auth.users','id','SELECT') OR NOT has_column_privilege(current_user,'auth.users','raw_app_meta_data','SELECT') THEN RAISE EXCEPTION 'Existing source identity read capability required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='cs_cafe_metricool_is_admin') THEN RAISE EXCEPTION 'Existing admin bridge requires reconciliation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='auth.users'::regclass AND attname='id' AND atttypid='uuid'::regtype AND NOT attisdropped) OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='auth.users'::regclass AND attname='raw_app_meta_data' AND atttypid='jsonb'::regtype AND NOT attisdropped) THEN RAISE EXCEPTION 'Identity columns mismatch'; END IF;
END $$;
CREATE TEMP TABLE ai_ns ON COMMIT DROP AS SELECT oid,nspacl,nspowner FROM pg_namespace WHERE nspname IN ('auth','public','character_production');
CREATE TEMP TABLE ai_class ON COMMIT DROP AS SELECT oid,relowner,relacl,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('auth.users'::regclass,'public.cs_character_promo_drafts'::regclass);
CREATE TEMP TABLE ai_cols ON COMMIT DROP AS SELECT attrelid,attnum,attacl FROM pg_attribute WHERE attrelid IN (SELECT oid FROM ai_class);
CREATE TEMP TABLE ai_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE ai_policies ON COMMIT DROP AS SELECT oid,to_jsonb(p) data FROM pg_policy p;
CREATE TEMP TABLE ai_funcs ON COMMIT DROP AS SELECT oid,proowner,proacl,pg_get_functiondef(oid) def FROM pg_proc WHERE pronamespace IN ('auth'::regnamespace,'public'::regnamespace) AND prokind='f';

CREATE FUNCTION public.cs_cafe_metricool_is_admin(p_actor uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users u
 WHERE u.id=p_actor AND u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb)
$$;
REVOKE ALL ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) TO character_production_owner;
DO $$ DECLARE bridge record; own oid:=current_user::regrole; target oid:='character_production_owner'::regrole; BEGIN
 IF EXISTS(SELECT 1 FROM ai_ns b LEFT JOIN pg_namespace n USING(oid) WHERE n.oid IS NULL OR n.nspacl IS DISTINCT FROM b.nspacl OR n.nspowner IS DISTINCT FROM b.nspowner) OR EXISTS(SELECT 1 FROM ai_class b LEFT JOIN pg_class c USING(oid) WHERE c.oid IS NULL OR c.relowner IS DISTINCT FROM b.relowner OR c.relacl IS DISTINCT FROM b.relacl OR c.relrowsecurity IS DISTINCT FROM b.relrowsecurity OR c.relforcerowsecurity IS DISTINCT FROM b.relforcerowsecurity) OR EXISTS(SELECT 1 FROM ai_cols b LEFT JOIN pg_attribute a USING(attrelid,attnum) WHERE a.attrelid IS NULL OR a.attacl IS DISTINCT FROM b.attacl) THEN RAISE EXCEPTION 'Existing identity/source authority changed'; END IF;
 IF EXISTS((SELECT * FROM pg_auth_members EXCEPT SELECT * FROM ai_members) UNION ALL (SELECT * FROM ai_members EXCEPT SELECT * FROM pg_auth_members)) THEN RAISE EXCEPTION 'Membership changed'; END IF;
 IF EXISTS(SELECT 1 FROM ai_policies b LEFT JOIN pg_policy p USING(oid) WHERE p.oid IS NULL OR to_jsonb(p) IS DISTINCT FROM b.data) OR (SELECT count(*) FROM pg_policy)<>(SELECT count(*) FROM ai_policies) THEN RAISE EXCEPTION 'Policies changed'; END IF;
 IF EXISTS(SELECT 1 FROM ai_funcs b LEFT JOIN pg_proc p USING(oid) WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM b.proowner OR p.proacl IS DISTINCT FROM b.proacl OR pg_get_functiondef(p.oid) IS DISTINCT FROM b.def) THEN RAISE EXCEPTION 'Existing function changed'; END IF;
 SELECT * INTO bridge FROM pg_proc WHERE oid=to_regprocedure('public.cs_cafe_metricool_is_admin(uuid)');
 IF NOT FOUND OR bridge.proowner<>own OR bridge.proargtypes<>'2950'::oidvector OR bridge.prorettype<>'boolean'::regtype OR NOT bridge.prosecdef OR bridge.provolatile<>'v' OR bridge.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'Admin bridge identity mismatch'; END IF;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(bridge.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT own,target,'EXECUTE',false) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Admin bridge ACL mismatch'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='cs_cafe_metricool_is_admin')<>1 THEN RAISE EXCEPTION 'Unexpected bridge overload'; END IF;
END $$;
COMMIT;

