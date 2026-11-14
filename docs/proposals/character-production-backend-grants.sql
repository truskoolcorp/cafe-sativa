-- REVIEW ONLY: existing backend RPC access, no runtime enablement/budget/slots.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ DECLARE sig text; BEGIN
 IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'PostgreSQL17 required'; END IF;
 IF current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Expected reviewed direct installer'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') THEN RAISE EXCEPTION 'Unexpected preexisting SET owner'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor<>current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option)<>1 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor=current_user::regrole) THEN RAISE EXCEPTION 'Missing exact bootstrap role authority'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE (pronamespace='character_production'::regnamespace OR (pronamespace='public'::regnamespace AND proname LIKE 'character_production_%')) AND has_function_privilege('service_role',oid,'EXECUTE')) THEN RAISE EXCEPTION 'Unexpected preexisting backend function access'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid IN ('character_production_owner'::regrole,'character_production_generator'::regrole,'character_production_output_broker'::regrole))<>3 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN ('character_production_owner'::regrole,'character_production_generator'::regrole,'character_production_output_broker'::regrole) AND (member<>current_user::regrole OR grantor=current_user::regrole OR NOT admin_option OR inherit_option OR set_option)) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member IN ('character_production_owner'::regrole,'character_production_generator'::regrole,'character_production_output_broker'::regrole)) THEN RAISE EXCEPTION 'Unexpected production role membership baseline'; END IF;
 FOREACH sig IN ARRAY ARRAY['public.character_production_authorization(text,text)','public.character_production_broker_authorized(jsonb)','public.character_production_claim(jsonb,text)','public.character_production_due(text,text,integer)','public.character_production_failed(jsonb)','public.character_production_output(jsonb,text,bigint)','public.character_production_output_status(jsonb,text,bigint)','public.character_production_pending(text,text,integer)','public.character_production_submitted(text,text,text,text)','public.character_production_unknown(text,text,text)'] LOOP
 IF to_regprocedure(sig) IS NULL OR (SELECT proowner FROM pg_proc WHERE oid=to_regprocedure(sig))<>'character_production_owner'::regrole OR has_function_privilege('service_role',sig,'EXECUTE') THEN RAISE EXCEPTION 'Unexpected function baseline %',sig; END IF;
 END LOOP;
END $$;
-- Capture the real bootstrap grantor, not a guessed postgres grantor.
CREATE TEMP TABLE backend_members_before ON COMMIT DROP AS
 SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members
 WHERE roleid IN ('character_production_owner'::regrole,'character_production_generator'::regrole,'character_production_output_broker'::regrole,'service_role'::regrole)
 OR member IN ('character_production_owner'::regrole,'character_production_generator'::regrole,'character_production_output_broker'::regrole,'service_role'::regrole);
CREATE TEMP TABLE backend_functions_before ON COMMIT DROP AS
 SELECT p.oid,a.grantee,a.grantor,a.privilege_type,a.is_grantable FROM pg_proc p
 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.pronamespace='character_production'::regnamespace OR (p.pronamespace='public'::regnamespace AND p.proname LIKE 'character_production_%');
CREATE TEMP TABLE backend_objects_before ON COMMIT DROP AS
 SELECT c.oid,c.relacl FROM pg_class c WHERE c.relnamespace='character_production'::regnamespace;
CREATE TEMP TABLE backend_schemas_before ON COMMIT DROP AS
 SELECT oid,nspacl FROM pg_namespace WHERE oid IN ('character_production'::regnamespace,'public'::regnamespace);
CREATE TEMP TABLE backend_expected_functions ON COMMIT DROP AS
 SELECT to_regprocedure(sig)::oid oid FROM unnest(ARRAY[
 'public.character_production_authorization(text,text)','public.character_production_broker_authorized(jsonb)',
 'public.character_production_claim(jsonb,text)','public.character_production_due(text,text,integer)',
 'public.character_production_failed(jsonb)','public.character_production_output(jsonb,text,bigint)',
 'public.character_production_output_status(jsonb,text,bigint)','public.character_production_pending(text,text,integer)',
 'public.character_production_submitted(text,text,text,text)','public.character_production_unknown(text,text,text)']) sig;
GRANT character_production_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
SET LOCAL ROLE character_production_owner;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM character_production.jobs) OR EXISTS(SELECT 1 FROM character_production.approved_slots) OR EXISTS(SELECT 1 FROM character_production.budgets) THEN RAISE EXCEPTION 'Nonempty ledger requires separate reconciliation'; END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.character_production_authorization(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.character_production_broker_authorized(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.character_production_claim(jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.character_production_due(text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.character_production_failed(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.character_production_output(jsonb,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.character_production_output_status(jsonb,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.character_production_pending(text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.character_production_submitted(text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.character_production_unknown(text,text,text) TO service_role;
RESET ROLE;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE r text; p record; BEGIN
 IF (SELECT count(*) FROM pg_temp.backend_expected_functions)<>10 OR EXISTS(SELECT 1 FROM pg_temp.backend_expected_functions e WHERE NOT has_function_privilege('service_role',e.oid,'EXECUTE')) THEN RAISE EXCEPTION 'Exact ten RPC grants missing'; END IF;
 IF EXISTS(
 (SELECT * FROM pg_temp.backend_members_before EXCEPT SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members)
 UNION ALL
 (SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members WHERE roleid IN ('character_production_owner'::regrole,'character_production_generator'::regrole,'character_production_output_broker'::regrole,'service_role'::regrole) OR member IN ('character_production_owner'::regrole,'character_production_generator'::regrole,'character_production_output_broker'::regrole,'service_role'::regrole) EXCEPT SELECT * FROM pg_temp.backend_members_before)
 ) THEN RAISE EXCEPTION 'Original bootstrap memberships changed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.backend_objects_before b FULL JOIN pg_class c ON c.oid=b.oid AND c.relnamespace='character_production'::regnamespace WHERE b.oid IS NOT NULL AND (c.oid IS NULL OR c.relacl IS DISTINCT FROM b.relacl)) OR EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='character_production'::regnamespace AND NOT EXISTS(SELECT 1 FROM pg_temp.backend_objects_before b WHERE b.oid=c.oid)) THEN RAISE EXCEPTION 'Table or sequence ACL changed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.backend_schemas_before b JOIN pg_namespace n USING(oid) WHERE b.nspacl IS DISTINCT FROM n.nspacl) THEN RAISE EXCEPTION 'Schema ACL changed'; END IF;
 -- Exact before ACL plus owner-issued, non-grantable EXECUTE on only ten RPCs.
 IF EXISTS(
 WITH expected AS (SELECT * FROM pg_temp.backend_functions_before UNION SELECT oid,'service_role'::regrole::oid,'character_production_owner'::regrole::oid,'EXECUTE'::text,false FROM pg_temp.backend_expected_functions),
 actual AS (SELECT p.oid,a.grantee,a.grantor,a.privilege_type,a.is_grantable FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.pronamespace='character_production'::regnamespace OR (p.pronamespace='public'::regnamespace AND p.proname LIKE 'character_production_%'))
 (SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)
 ) THEN RAISE EXCEPTION 'Unexpected function ACL delta'; END IF;
 IF pg_has_role('postgres','character_production_owner','SET') THEN RAISE EXCEPTION 'Temporary SET not removed'; END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
 FOR p IN SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'character_production_%' LOOP
 IF has_function_privilege(r,p.oid,'EXECUTE') THEN RAISE EXCEPTION 'Public API execution leak'; END IF;
 END LOOP; END LOOP;
 IF has_schema_privilege('service_role','character_production','USAGE') OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relkind='r' AND has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE')) THEN RAISE EXCEPTION 'Unexpected direct ledger privilege'; END IF;
END $$;
COMMIT;
