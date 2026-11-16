-- OFFLINE REVIEW ONLY. Exact owner interactive approval, not a standing worker grant.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Exact direct installer required'; END IF;
 IF to_regprocedure('public.cs_cafe_authenticated_owner()') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='cs_record_authenticated_cafe_authority') THEN RAISE EXCEPTION 'Existing owner transport requires reconciliation'; END IF;
 IF pg_has_role(current_user,'cafe_metricool_owner','SET') OR has_schema_privilege('cafe_metricool_owner','auth','USAGE') OR has_schema_privilege('cafe_metricool_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected existing owner authority'; END IF;
 IF NOT has_function_privilege('cafe_metricool_owner','public.cs_cafe_metricool_is_admin(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Existing admin bridge required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.cs_record_cafe_metricool_authority(uuid,jsonb,text,text,text,jsonb,uuid,timestamptz,timestamptz,jsonb)'::regprocedure AND (p.proowner<>'cafe_metricool_owner'::regrole OR a.grantor<>p.proowner OR a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN RAISE EXCEPTION 'Underlying writer must remain owner-only'; END IF;
END $$;
DO $$ DECLARE e record; p record; own oid:='cafe_metricool_owner'::regrole; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE oid=own AND NOT (rolcanlogin OR rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'Exact inert owner required'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid=own OR member=own)<>1 OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=own AND member=current_user::regrole AND grantor=to_regrole('supabase_admin') AND admin_option AND NOT inherit_option AND NOT set_option) THEN RAISE EXCEPTION 'Unexpected owner topology'; END IF;
 FOR e IN SELECT * FROM (VALUES
('cafe_metricool_private','authorized','337c331a3e74f8a61e1e6ffbbda5ff67','cafe_metricool_owner'),('cafe_metricool_private','canonical_json','77401b8a922a0af0840b4858ecd41678','cafe_metricool_owner'),('cafe_metricool_private','guard_source','61cead1510719eaecc0a1b86856e3bf9','cafe_metricool_owner'),('cafe_metricool_private','source_state','f255e350823081de0bc76f147dc89336','cafe_metricool_owner'),('public','cs_cafe_metricool_is_admin','3e4923d21576cbff5411d6a68fa07aaf','postgres'),('public','cs_claim_cafe_metricool','e76ae5792af0711730e3bb3b398e221e','cafe_metricool_owner'),('public','cs_finish_cafe_metricool','b36fd41f2917acf42de0f04c1eadaaeb','cafe_metricool_owner'),('public','cs_identity_cafe_metricool','4a7377e2e01c1a0b92493d0d10261d0b','cafe_metricool_owner'),('public','cs_preflight_cafe_metricool','b6d7d8dd335981afa39a5f30e8bca83c','cafe_metricool_owner'),('public','cs_record_cafe_metricool_authority','c1a81d02e1203b1f545431dac0d4b03a','cafe_metricool_owner'),('auth','uid','ea3b41bf29e2ad573067939329aa088e','supabase_auth_admin'),('auth','role','8a3e05459e07e0633d43c6fba2a2cdf4','supabase_auth_admin')
 ) x(nsp,name,hash,owner_name) LOOP
 IF (SELECT count(*) FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname=e.nsp AND f.proname=e.name)<>1 THEN RAISE EXCEPTION 'Dependency missing/overloaded %',e.name; END IF;
 SELECT f.* INTO p FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname=e.nsp AND f.proname=e.name;
 IF md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM e.hash OR p.proowner<>e.owner_name::regrole THEN RAISE EXCEPTION 'Dependency body/owner drift %',e.name; END IF;
 IF e.nsp='auth' THEN
 IF EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))), expected AS (SELECT p.proowner grantor,x grantee,'EXECUTE'::text privilege_type,false is_grantable FROM unnest(ARRAY[0::oid,p.proowner,'dashboard_user'::regrole::oid]) x) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'Auth dependency ACL drift %',e.name; END IF;
 ELSE
 IF EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))), expected AS (
 SELECT p.proowner grantor,p.proowner grantee,'EXECUTE'::text privilege_type,false is_grantable
 UNION ALL SELECT own,'service_role'::regrole::oid,'EXECUTE',false WHERE e.name IN ('cs_preflight_cafe_metricool','cs_claim_cafe_metricool','cs_identity_cafe_metricool','cs_finish_cafe_metricool')
 UNION ALL SELECT current_user::regrole::oid,r::regrole::oid,'EXECUTE',false FROM unnest(ARRAY['character_production_owner','cafe_metricool_owner']) r WHERE e.name='cs_cafe_metricool_is_admin')
 (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'Dependency ACL drift %',e.name; END IF;
 END IF;
 END LOOP;
END $$;
LOCK TABLE public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks IN SHARE MODE;
CREATE TEMP TABLE ca_source ON COMMIT DROP AS SELECT 'drafts' name,to_jsonb(x) data FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x;
CREATE TEMP TABLE ca_functions ON COMMIT DROP AS SELECT oid,proowner,proacl,pg_get_functiondef(oid) definition FROM pg_proc WHERE prokind='f';
CREATE TEMP TABLE ca_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE ca_schema ON COMMIT DROP AS SELECT oid,nspowner,nspacl FROM pg_namespace WHERE nspname IN ('public','auth');
-- Fixed scalar bridge avoids giving cafe_metricool_owner auth schema/table access.
CREATE FUNCTION public.cs_cafe_authenticated_owner() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $owner$
DECLARE actor uuid; claims jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'Authenticated request role required'; END IF;
 claims:=nullif(current_setting('request.jwt.claims',true),'')::jsonb;
 IF claims->>'role' IS DISTINCT FROM 'authenticated' OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'Authenticated JWT required'; END IF;
 actor:=auth.uid();
 IF actor IS DISTINCT FROM '54b71f3f-19e1-46f0-99e2-28993463caf8'::uuid OR claims->>'sub' IS DISTINCT FROM actor::text OR NOT coalesce(public.cs_cafe_metricool_is_admin(actor),false) THEN RAISE EXCEPTION 'Current exact content owner required'; END IF;
 RETURN actor;
END $owner$;
REVOKE ALL ON FUNCTION public.cs_cafe_authenticated_owner() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cs_cafe_authenticated_owner() TO cafe_metricool_owner;
CREATE TEMP TABLE ca_defaults ON COMMIT DROP AS SELECT * FROM pg_default_acl;
CREATE TEMP TABLE ca_policies ON COMMIT DROP AS SELECT * FROM pg_policy;
CREATE TEMP TABLE ca_tables ON COMMIT DROP AS SELECT oid,relowner,relacl,relrowsecurity,relforcerowsecurity FROM pg_class;
CREATE TEMP TABLE ca_columns ON COMMIT DROP AS SELECT attrelid,attnum,attacl FROM pg_attribute;
CREATE TEMP TABLE ca_triggers ON COMMIT DROP AS SELECT * FROM pg_trigger;
GRANT cafe_metricool_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO cafe_metricool_owner;
SET LOCAL ROLE cafe_metricool_owner;
CREATE TEMP TABLE ca_rows(name text,data jsonb) ON COMMIT DROP;
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT relname FROM pg_class WHERE relnamespace='cafe_metricool_private'::regnamespace AND relkind='r' LOOP
 EXECUTE format('LOCK TABLE cafe_metricool_private.%I IN SHARE MODE',t.relname);
 EXECUTE format('INSERT INTO ca_rows SELECT %L,to_jsonb(r) FROM cafe_metricool_private.%I r',t.relname,t.relname);
 END LOOP;
END $$;

CREATE FUNCTION public.cs_record_authenticated_cafe_authority(
 p_plan uuid,p_snapshot jsonb,p_digest text,p_destination text,p_media text,p_source jsonb,p_expires_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $record$
DECLARE actor uuid; stamp timestamptz;
BEGIN
 actor:=public.cs_cafe_authenticated_owner();
 stamp:=clock_timestamp();
 -- No supplied actor, approval timestamp, policy assertions or chat-message references.
 -- Exact owner approval provenance refers only to this authenticated preview digest.
 RETURN public.cs_record_cafe_metricool_authority(p_plan,p_snapshot,p_digest,p_destination,p_media,p_source,actor,stamp,p_expires_at,
  jsonb_build_object('reference','authenticated-owner-preview:'||actor::text||':'||p_digest,'scheduleDigest',p_digest,'authorizedAt',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'expiresAt',to_char(p_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'revoked',false));
END $record$;
REVOKE ALL ON FUNCTION public.cs_record_authenticated_cafe_authority(uuid,jsonb,text,text,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
-- Proposed explicit interactive capability. No EXECUTE on underlying writer.
GRANT EXECUTE ON FUNCTION public.cs_record_authenticated_cafe_authority(uuid,jsonb,text,text,text,jsonb,timestamptz) TO authenticated;
CREATE TEMP TABLE ca_after(name text,data jsonb) ON COMMIT DROP;
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT relname FROM pg_class WHERE relnamespace='cafe_metricool_private'::regnamespace AND relkind='r' LOOP
 EXECUTE format('INSERT INTO ca_after SELECT %L,to_jsonb(r) FROM cafe_metricool_private.%I r',t.relname,t.relname);
 END LOOP;
 IF EXISTS((SELECT * FROM ca_rows EXCEPT ALL SELECT * FROM ca_after) UNION ALL (SELECT * FROM ca_after EXCEPT ALL SELECT * FROM ca_rows)) THEN RAISE EXCEPTION 'Private rows changed'; END IF;
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM cafe_metricool_owner;
REVOKE cafe_metricool_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE p record; own oid:='cafe_metricool_owner'::regrole; BEGIN
 IF EXISTS(WITH actual AS (SELECT 'drafts' name,to_jsonb(x) data FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x) (SELECT * FROM actual EXCEPT ALL SELECT * FROM ca_source) UNION ALL (SELECT * FROM ca_source EXCEPT ALL SELECT * FROM actual)) THEN RAISE EXCEPTION 'Source rows changed'; END IF;
 IF EXISTS((SELECT * FROM ca_defaults EXCEPT SELECT * FROM pg_default_acl) UNION ALL (SELECT * FROM pg_default_acl EXCEPT SELECT * FROM ca_defaults)) OR EXISTS((SELECT * FROM ca_policies EXCEPT SELECT * FROM pg_policy) UNION ALL (SELECT * FROM pg_policy EXCEPT SELECT * FROM ca_policies)) OR EXISTS((SELECT * FROM ca_triggers EXCEPT SELECT * FROM pg_trigger) UNION ALL (SELECT * FROM pg_trigger EXCEPT SELECT * FROM ca_triggers)) THEN RAISE EXCEPTION 'Defaults policies triggers changed'; END IF;
 IF EXISTS(SELECT 1 FROM ca_tables b LEFT JOIN pg_class c USING(oid) WHERE (b.relowner,b.relacl,b.relrowsecurity,b.relforcerowsecurity) IS DISTINCT FROM (c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity)) OR EXISTS(SELECT 1 FROM ca_columns b LEFT JOIN pg_attribute a USING(attrelid,attnum) WHERE b.attacl IS DISTINCT FROM a.attacl) THEN RAISE EXCEPTION 'Table column authority changed'; END IF;
 IF EXISTS(SELECT 1 FROM ca_functions b LEFT JOIN pg_proc f USING(oid) WHERE (b.proowner,b.proacl,b.definition) IS DISTINCT FROM (f.proowner,f.proacl,pg_get_functiondef(f.oid))) THEN RAISE EXCEPTION 'Existing functions changed'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE prokind='f')<>(SELECT count(*)+2 FROM ca_functions) THEN RAISE EXCEPTION 'Unexpected added functions'; END IF;
 IF EXISTS((SELECT * FROM ca_members EXCEPT SELECT * FROM pg_auth_members) UNION ALL (SELECT * FROM pg_auth_members EXCEPT SELECT * FROM ca_members)) THEN RAISE EXCEPTION 'Membership restoration mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM ca_schema b LEFT JOIN pg_namespace n USING(oid) WHERE (b.nspowner,b.nspacl) IS DISTINCT FROM (n.nspowner,n.nspacl)) OR pg_has_role(current_user,'cafe_metricool_owner','SET') THEN RAISE EXCEPTION 'Temporary authority leaked'; END IF;
 SELECT * INTO p FROM pg_proc WHERE oid='public.cs_cafe_authenticated_owner()'::regprocedure;
 IF p.proowner<>current_user::regrole OR EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))), e AS (SELECT current_user::regrole::oid grantor,current_user::regrole::oid grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT current_user::regrole::oid,own,'EXECUTE',false) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Owner bridge ACL mismatch'; END IF;
 SELECT * INTO p FROM pg_proc WHERE oid='public.cs_record_authenticated_cafe_authority(uuid,jsonb,text,text,text,jsonb,timestamptz)'::regprocedure;
 IF p.proowner<>own OR EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(p.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT own,'authenticated'::regrole::oid,'EXECUTE',false) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Owner wrapper ACL mismatch'; END IF;
 IF has_function_privilege('service_role',p.oid,'EXECUTE') THEN RAISE EXCEPTION 'Service role gained interactive writer'; END IF;
END $$;
COMMIT;
