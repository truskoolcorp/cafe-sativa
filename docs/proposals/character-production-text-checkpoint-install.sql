-- OFFLINE REVIEW ONLY. Private provider-content checkpoint installation, not provider execution.
-- Requires action-time approval for temporary restricted-owner SET/public CREATE
-- and two persistent service_role EXECUTE capabilities. Default ROLLBACK.
-- Effective runtime principals: service_role and postgres by inheritance;
-- authenticator and supabase_storage_admin through SET ROLE; existing superusers.
-- No anon/authenticated access, direct runtime table access, or generation grant.
-- Retention proposal: review private provider content after 30 days for reconciliation,
-- and obtain owner direction. No automated purge is installed: append-only protection
-- remains until a separate approved retention migration. Only bounded provider content is stored, never prompts/headers.
-- Rollback before COMMIT is atomic. After COMMIT disable the new app feature;
-- a separately approved REVOKE EXECUTE stops new receipts without deleting evidence.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>session_user OR current_user<>'postgres' OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'Direct PG17 postgres required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='character_production_owner' AND NOT(rolcanlogin OR rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'Inert owner required'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole OR member='character_production_owner'::regrole)<>1 OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member='postgres'::regrole AND grantor='supabase_admin'::regrole AND admin_option AND NOT inherit_option AND NOT set_option) THEN RAISE EXCEPTION 'Existing membership changed'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected installer permission'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role' AND NOT rolcanlogin AND NOT rolsuper AND rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolbypassrls) OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator' AND rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN RAISE EXCEPTION 'Service proxy role baseline mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member='service_role'::regrole) OR (SELECT count(*) FROM pg_auth_members WHERE roleid='service_role'::regrole)<>2 OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid='service_role'::regrole AND NOT (m.grantor=(SELECT grantor FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option) AND ((m.member='authenticator'::regrole AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option) OR (m.member=current_user::regrole AND m.admin_option AND m.inherit_option AND m.set_option)))) THEN RAISE EXCEPTION 'Service role membership baseline mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_storage_admin' AND rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND rolconfig=ARRAY['search_path=storage','log_statement=none']::text[]) THEN RAISE EXCEPTION 'Managed Storage role baseline mismatch'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE member='supabase_storage_admin'::regrole OR roleid='supabase_storage_admin'::regrole)<>1 OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member='supabase_storage_admin'::regrole AND roleid='authenticator'::regrole AND grantor=(SELECT oid FROM pg_roles WHERE rolname='supabase_admin') AND NOT admin_option AND NOT inherit_option AND set_option) THEN RAISE EXCEPTION 'Managed Storage membership baseline mismatch'; END IF;
 IF NOT pg_has_role('supabase_storage_admin','service_role','SET') OR pg_has_role('supabase_storage_admin','service_role','USAGE') THEN RAISE EXCEPTION 'Managed Storage effective path mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND r.oid NOT IN (current_user::regrole,'service_role'::regrole,'authenticator'::regrole,'supabase_storage_admin'::regrole) AND (pg_has_role(r.oid,'service_role','USAGE') OR pg_has_role(r.oid,'service_role','SET'))) THEN RAISE EXCEPTION 'Unexpected effective service principal'; END IF;
 IF NOT has_schema_privilege('postgres','public','CREATE WITH GRANT OPTION') THEN RAISE EXCEPTION 'Installer cannot grant temporary schema CREATE'; END IF;
END $$;
CREATE TEMP TABLE private_test_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE private_test_acl ON COMMIT DROP AS
 SELECT 'schema' kind,oid::text identity,nspowner owner,nspacl::text acl FROM pg_namespace WHERE nspname IN('public','character_production')
 UNION ALL SELECT 'function',oid::text,proowner,proacl::text FROM pg_proc WHERE pronamespace IN('public'::regnamespace,'character_production'::regnamespace)
 UNION ALL SELECT 'relation',oid::text,relowner,relacl::text FROM pg_class WHERE relnamespace IN('public'::regnamespace,'character_production'::regnamespace);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname='text_content_checkpoints') OR to_regprocedure('public.character_production_text_checkpoint(text,uuid,text,text,text,text,text,integer,integer,text,text)') IS NOT NULL OR to_regprocedure('public.character_production_text_checkpoint_read(text,uuid,text)') IS NOT NULL THEN RAISE EXCEPTION 'Checkpoint capability already installed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.character_production_text_receipt(text,uuid,text,text,text,text,text,integer,integer,text)') AND proowner='character_production_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog']::text[]) THEN RAISE EXCEPTION 'Reviewed receipt dependency required'; END IF;
END $$;
GRANT character_production_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO character_production_owner;
SET LOCAL ROLE character_production_owner;
CREATE TABLE character_production.text_content_checkpoints(
 attempt_key text PRIMARY KEY REFERENCES character_production.text_receipt_evidence(attempt_key),
 attempt_token uuid NOT NULL UNIQUE REFERENCES character_production.text_receipt_evidence(attempt_token),
 source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),
 parser_version text NOT NULL DEFAULT 'fresh-editorial-v1-zaria250' CHECK(parser_version='fresh-editorial-v1-zaria250'),
 content_json text NOT NULL CHECK(octet_length(content_json) BETWEEN 2 AND 262144),
 response_sha256 text NOT NULL CHECK(response_sha256~'^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(attempt_key<>'daily:2026-11-16:zaria-solenne'),
 CHECK(json_typeof(content_json::json)='array'),
 CHECK(encode(sha256(convert_to(content_json,'UTF8')),'hex')=response_sha256)
);
ALTER TABLE character_production.text_content_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.text_content_checkpoints FROM PUBLIC;
CREATE FUNCTION character_production.text_checkpoint_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Content checkpoint is append-only'; END IF;
 IF NOT EXISTS(SELECT 1 FROM character_production.text_receipt_evidence WHERE attempt_key=NEW.attempt_key AND attempt_token=NEW.attempt_token AND source_digest=NEW.source_digest AND response_sha256=NEW.response_sha256) THEN RAISE EXCEPTION 'Exact metadata receipt required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER text_checkpoint_guard BEFORE INSERT OR UPDATE OR DELETE ON character_production.text_content_checkpoints FOR EACH ROW EXECUTE FUNCTION character_production.text_checkpoint_guard();
CREATE TRIGGER text_checkpoint_no_truncate BEFORE TRUNCATE ON character_production.text_content_checkpoints FOR EACH STATEMENT EXECUTE FUNCTION character_production.text_checkpoint_guard();
REVOKE ALL ON FUNCTION character_production.text_checkpoint_guard() FROM PUBLIC;
CREATE FUNCTION public.character_production_text_checkpoint(p_key text,p_token uuid,p_digest text,p_provider_id text,p_request_id text,p_model text,p_stop_reason text,p_input_tokens integer,p_output_tokens integer,p_response_sha256 text,p_content_json text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE parsed json;
BEGIN
 IF p_key IS NULL OR p_key='daily:2026-11-16:zaria-solenne' OR p_token IS NULL OR p_digest IS NULL OR p_content_json IS NULL OR octet_length(p_content_json) NOT BETWEEN 2 AND 262144 OR p_response_sha256 IS NULL THEN RETURN false; END IF;
 IF encode(sha256(convert_to(p_content_json,'UTF8')),'hex') IS DISTINCT FROM p_response_sha256 THEN RETURN false; END IF;
 BEGIN parsed:=p_content_json::json; EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
 IF json_typeof(parsed) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 -- The trusted producer supplies content_json_v1 canonical JSON. PostgreSQL
 -- checks its exact bytes/hash and array type, not JS-specific canonicalization.
 -- The reader must independently re-canonicalize/hash before treating it as v1.
 IF NOT public.character_production_text_receipt(p_key,p_token,p_digest,p_provider_id,p_request_id,p_model,p_stop_reason,p_input_tokens,p_output_tokens,p_response_sha256) THEN RETURN false; END IF;
 INSERT INTO character_production.text_content_checkpoints(attempt_key,attempt_token,source_digest,content_json,response_sha256)
 VALUES(p_key,p_token,p_digest,p_content_json,p_response_sha256) ON CONFLICT DO NOTHING;
 RETURN EXISTS(SELECT 1 FROM character_production.text_content_checkpoints WHERE attempt_key=p_key AND attempt_token=p_token AND source_digest=p_digest AND response_sha256=p_response_sha256 AND content_json=p_content_json);
END $$;
REVOKE ALL ON FUNCTION public.character_production_text_checkpoint(text,uuid,text,text,text,text,text,integer,integer,text,text) FROM PUBLIC;
CREATE FUNCTION public.character_production_text_checkpoint_read(p_key text,p_token uuid,p_digest text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('key',c.attempt_key,'token',c.attempt_token,'sourceDigest',c.source_digest,'sourceSnapshot',a.source_snapshot,'parserVersion',c.parser_version,'contentJson',c.content_json,'evidence',jsonb_build_object('providerId',r.provider_id,'requestId',r.request_id,'model',r.model,'stopReason',r.stop_reason,'inputTokens',r.input_tokens,'outputTokens',r.output_tokens,'responseSha256',r.response_sha256))
 FROM character_production.text_content_checkpoints c JOIN character_production.text_receipt_evidence r ON r.attempt_key=c.attempt_key AND r.attempt_token=c.attempt_token AND r.source_digest=c.source_digest AND r.response_sha256=c.response_sha256
 JOIN character_production.text_replenishment_attempts a ON a.key=c.attempt_key AND a.token=c.attempt_token AND a.source_digest=c.source_digest
 WHERE c.attempt_key=p_key AND c.attempt_token=p_token AND c.source_digest=p_digest AND c.attempt_key<>'daily:2026-11-16:zaria-solenne';
$$;
REVOKE ALL ON FUNCTION public.character_production_text_checkpoint_read(text,uuid,text) FROM PUBLIC;
DO $$ DECLARE r record;own oid:='character_production_owner'::regrole;BEGIN
 IF current_user<>'character_production_owner' THEN RAISE EXCEPTION 'Restricted owner required'; END IF;
 FOR r IN SELECT relowner owner,relacl acl FROM pg_class WHERE oid='character_production.text_content_checkpoints'::regclass
 UNION ALL SELECT proowner,proacl FROM pg_proc WHERE oid IN('character_production.text_checkpoint_guard()'::regprocedure,'public.character_production_text_checkpoint(text,uuid,text,text,text,text,text,integer,integer,text,text)'::regprocedure,'public.character_production_text_checkpoint_read(text,uuid,text)'::regprocedure)
 LOOP IF r.owner<>own OR EXISTS(SELECT 1 FROM aclexplode(r.acl) WHERE grantee<>own) THEN RAISE EXCEPTION 'Owner-only checkpoints required'; END IF; END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.character_production_text_checkpoint(text,uuid,text,text,text,text,text,integer,integer,text,text),public.character_production_text_checkpoint_read(text,uuid,text) TO service_role;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM character_production_owner;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE r text; obj record; BEGIN
 IF pg_has_role('postgres','character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Temporary privileges not removed'; END IF;
 IF EXISTS((SELECT * FROM pg_auth_members EXCEPT SELECT * FROM private_test_members) UNION ALL (SELECT * FROM private_test_members EXCEPT SELECT * FROM pg_auth_members)) THEN RAISE EXCEPTION 'Membership changed'; END IF;
 IF EXISTS(WITH current_acl AS (
 SELECT 'schema' kind,oid::text identity,nspowner owner,nspacl::text acl FROM pg_namespace WHERE nspname IN('public','character_production')
 UNION ALL SELECT 'function',oid::text,proowner,proacl::text FROM pg_proc WHERE pronamespace IN('public'::regnamespace,'character_production'::regnamespace)
 UNION ALL SELECT 'relation',oid::text,relowner,relacl::text FROM pg_class WHERE relnamespace IN('public'::regnamespace,'character_production'::regnamespace))
 SELECT 1 FROM private_test_acl old LEFT JOIN current_acl cur USING(kind,identity) WHERE cur.identity IS NULL OR old.owner IS DISTINCT FROM cur.owner OR old.acl IS DISTINCT FROM cur.acl) THEN RAISE EXCEPTION 'Existing object ACL/owner changed'; END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
 IF has_table_privilege(r,(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname='text_content_checkpoints'),'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Runtime table grant'; END IF;
 IF r<>'service_role' AND (has_function_privilege(r,'public.character_production_text_checkpoint(text,uuid,text,text,text,text,text,integer,integer,text,text)','EXECUTE') OR has_function_privilege(r,'public.character_production_text_checkpoint_read(text,uuid,text)','EXECUTE')) THEN RAISE EXCEPTION 'Public recovery RPC leak'; END IF;
 END LOOP;
 FOR obj IN SELECT oid,proowner,proacl FROM pg_proc WHERE oid IN('public.character_production_text_checkpoint(text,uuid,text,text,text,text,text,integer,integer,text,text)'::regprocedure,'public.character_production_text_checkpoint_read(text,uuid,text)'::regprocedure) LOOP
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND (has_function_privilege(r.oid,obj.oid,'EXECUTE') OR pg_has_role(r.oid,'service_role','SET') OR pg_has_role(r.oid,'character_production_owner','SET')) IS DISTINCT FROM (r.rolname IN('postgres','service_role','authenticator','supabase_storage_admin','character_production_owner'))) THEN RAISE EXCEPTION 'Unexpected effective receipt principal'; END IF;
 IF obj.proowner<>'character_production_owner'::regrole OR EXISTS(SELECT 1 FROM aclexplode(obj.proacl) WHERE grantee NOT IN('character_production_owner'::regrole,'service_role'::regrole) OR privilege_type<>'EXECUTE' OR is_grantable) OR NOT has_function_privilege('service_role',obj.oid,'EXECUTE') THEN RAISE EXCEPTION 'Exact non-grantable RPC capability required'; END IF;
 END LOOP;
END $$;
-- Only replace final ROLLBACK after independent review, exact rehearsal and
-- action-time approval covering temporary SET/CREATE plus two runtime grants.
ROLLBACK;
