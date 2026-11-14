-- OFFLINE REVIEW ONLY: receipt durability, no worker activation or new jobs.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Expected reviewed direct PG17 installer'; END IF;
 IF to_regprocedure('public.character_production_observe_receipt(text,text,text,text)') IS NOT NULL THEN RAISE EXCEPTION 'Existing receipt function requires reconciliation'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected preexisting owner authority'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor<>current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option)<>1 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor=current_user::regrole) THEN RAISE EXCEPTION 'Missing exact original bootstrap grant'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.character_production_submitted(text,text,text,text)'::regprocedure AND proowner='character_production_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog']) THEN RAISE EXCEPTION 'Unexpected submitted function owner/security'; END IF;
 IF NOT has_function_privilege('service_role','public.character_production_submitted(text,text,text,text)','EXECUTE') OR has_schema_privilege('service_role','character_production','USAGE') THEN RAISE EXCEPTION 'Unexpected backend baseline'; END IF;
END $$;
CREATE TEMP TABLE receipt_members_before ON COMMIT DROP AS SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members;
CREATE TEMP TABLE receipt_functions_before ON COMMIT DROP AS SELECT oid,proowner,proacl,pg_get_functiondef(oid) definition FROM pg_proc WHERE (pronamespace='character_production'::regnamespace OR (pronamespace='public'::regnamespace AND proname LIKE 'character_production_%')) AND prokind='f';
CREATE TEMP TABLE receipt_objects_before ON COMMIT DROP AS SELECT oid,relacl,relowner,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='character_production'::regnamespace;
CREATE TEMP TABLE receipt_schemas_before ON COMMIT DROP AS SELECT oid,nspacl FROM pg_namespace WHERE nspname IN ('public','character_production');
GRANT character_production_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO character_production_owner;
SET LOCAL ROLE character_production_owner;
-- Lock before snapshot so an active concurrent writer cannot be mistaken for install effects.
LOCK TABLE character_production.jobs,character_production.budgets,character_production.approved_slots,character_production.schedules IN SHARE MODE;
CREATE TEMP TABLE receipt_rows_before ON COMMIT DROP AS
 SELECT 'jobs' name,to_jsonb(x) row FROM character_production.jobs x
 UNION ALL SELECT 'budgets',to_jsonb(x) FROM character_production.budgets x
 UNION ALL SELECT 'slots',to_jsonb(x) FROM character_production.approved_slots x
 UNION ALL SELECT 'schedules',to_jsonb(x) FROM character_production.schedules x;

CREATE FUNCTION public.character_production_observe_receipt(p_key text,p_token text,p_digest text,p_task text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j character_production.jobs; a jsonb;
BEGIN
 SELECT * INTO j FROM character_production.jobs WHERE key=p_key AND token=p_token AND digest=p_digest FOR UPDATE;
 IF j.key IS NULL OR j.state NOT IN ('submitting','unknown') THEN RETURN false; END IF;
 IF p_task IS NULL THEN
  IF j.state<>'submitting' OR j.task IS NOT NULL THEN RETURN false; END IF;
  a:=public.character_production_authorization(j.key,j.slot->>'authorizationId');
  RETURN coalesce(a->'slot'=j.slot AND a->>'digest'=j.digest AND a->'enabled'='true'::jsonb
   AND (j.slot->>'authorizationExpiresAt')::numeric>extract(epoch FROM clock_timestamp())*1000
   AND j.period=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM'),false);
 END IF;
 -- Evidence may arrive after authority expires: retain it, never promote or spend.
 IF p_task !~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$' THEN RETURN false; END IF;
 UPDATE character_production.jobs SET task=p_task
 WHERE key=p_key AND token=p_token AND digest=p_digest AND state IN ('submitting','unknown') AND (task IS NULL OR task=p_task);
 RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION public.character_production_submitted(p_key text,p_token text,p_digest text,p_task text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_task IS NULL OR p_task !~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$' THEN RETURN false; END IF;
 UPDATE character_production.jobs SET state='submitted',task=p_task
 WHERE key=p_key AND token=p_token AND digest=p_digest AND state='submitting' AND (task IS NULL OR task=p_task);
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.character_production_observe_receipt(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.character_production_observe_receipt(text,text,text,text) TO service_role;
DO $$ BEGIN
 IF EXISTS(
 WITH actual AS (SELECT 'jobs' name,to_jsonb(x) row FROM character_production.jobs x UNION ALL SELECT 'budgets',to_jsonb(x) FROM character_production.budgets x UNION ALL SELECT 'slots',to_jsonb(x) FROM character_production.approved_slots x UNION ALL SELECT 'schedules',to_jsonb(x) FROM character_production.schedules x)
 (SELECT * FROM receipt_rows_before EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM receipt_rows_before)
 ) THEN RAISE EXCEPTION 'Receipt install changed production ledger rows'; END IF;
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM character_production_owner;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE r text; BEGIN
 IF EXISTS((SELECT * FROM receipt_members_before EXCEPT SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members) UNION ALL (SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members EXCEPT SELECT * FROM receipt_members_before)) THEN RAISE EXCEPTION 'Memberships changed'; END IF;
 IF EXISTS(SELECT 1 FROM receipt_objects_before b FULL JOIN pg_class c ON c.oid=b.oid AND c.relnamespace='character_production'::regnamespace WHERE b.oid IS NOT NULL AND (c.oid IS NULL OR (b.relacl,b.relowner,b.relrowsecurity,b.relforcerowsecurity) IS DISTINCT FROM (c.relacl,c.relowner,c.relrowsecurity,c.relforcerowsecurity))) OR EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='character_production'::regnamespace AND NOT EXISTS(SELECT 1 FROM receipt_objects_before b WHERE b.oid=c.oid)) THEN RAISE EXCEPTION 'Ledger object ACL/ownership changed'; END IF;
 IF EXISTS(SELECT 1 FROM receipt_schemas_before b JOIN pg_namespace n USING(oid) WHERE b.nspacl IS DISTINCT FROM n.nspacl) THEN RAISE EXCEPTION 'Schema ACL restoration mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM receipt_functions_before b LEFT JOIN pg_proc p USING(oid) WHERE p.oid IS NULL OR (b.proowner,b.proacl) IS DISTINCT FROM (p.proowner,p.proacl) OR (b.oid<>'public.character_production_submitted(text,text,text,text)'::regprocedure AND b.definition IS DISTINCT FROM pg_get_functiondef(p.oid))) THEN RAISE EXCEPTION 'Prior RPC owner/ACL/definition changed outside submitted CAS'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE (pronamespace='character_production'::regnamespace OR (pronamespace='public'::regnamespace AND proname LIKE 'character_production_%')) AND prokind='f' AND NOT EXISTS(SELECT 1 FROM receipt_functions_before b WHERE b.oid=pg_proc.oid))<>1 THEN RAISE EXCEPTION 'Unexpected added RPC'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.character_production_observe_receipt(text,text,text,text)'::regprocedure AND proowner='character_production_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog']) THEN RAISE EXCEPTION 'Wrong evidence RPC owner/security'; END IF;
 IF EXISTS(
 WITH actual AS (SELECT a.grantee,a.grantor,a.privilege_type,a.is_grantable FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.character_production_observe_receipt(text,text,text,text)'::regprocedure),
 expected AS (SELECT 'character_production_owner'::regrole::oid grantee,'character_production_owner'::regrole::oid grantor,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT 'service_role'::regrole::oid,'character_production_owner'::regrole::oid,'EXECUTE'::text,false)
 (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)
 ) THEN RAISE EXCEPTION 'Expected only owner and backend evidence execute'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Temporary owner authority leaked'; END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','character_production_generator','character_production_output_broker'] LOOP
 IF has_function_privilege(r,'public.character_production_observe_receipt(text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Unexpected new evidence recipient'; END IF;
 END LOOP;
 IF has_schema_privilege('service_role','character_production','USAGE') OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relkind='r' AND has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE')) THEN RAISE EXCEPTION 'Unexpected backend ledger access'; END IF;
END $$;
COMMIT;

