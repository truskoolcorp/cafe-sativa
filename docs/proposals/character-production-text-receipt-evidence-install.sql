-- OFFLINE REVIEW ONLY. Receipt-metadata installation, not provider execution.
-- Requires action-time approval for temporary restricted-owner SET/public CREATE
-- and one persistent service_role EXECUTE capability. Default ROLLBACK.
-- Effective runtime principals: service_role and postgres by inheritance;
-- authenticator and supabase_storage_admin through SET ROLE; existing superusers.
-- No anon/authenticated access, direct runtime table access, or generation grant.
-- Retention proposal: retain private metadata at least 90 days for reconciliation,
-- then review with owner. No automated purge is installed: append-only protection
-- remains until a separate approved retention migration. Never retain raw content.
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
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname='text_receipt_evidence') OR to_regprocedure('public.character_production_text_receipt(text,uuid,text,text,text,text,text,integer,integer,text)') IS NOT NULL THEN RAISE EXCEPTION 'Receipt capability already installed: reconcile, never repeat'; END IF;
END $$;
GRANT character_production_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO character_production_owner;
SET LOCAL ROLE character_production_owner;
CREATE TABLE character_production.text_receipt_evidence(
 attempt_key text PRIMARY KEY REFERENCES character_production.text_replenishment_attempts(key),
 attempt_token uuid NOT NULL UNIQUE REFERENCES character_production.text_replenishment_attempts(token),
 source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),
 provider_id text NOT NULL UNIQUE CHECK(provider_id~'^msg_[A-Za-z0-9]{8,196}$'),
 request_id text CHECK(request_id IS NULL OR request_id~'^req_[A-Za-z0-9]{8,196}$'),
 model text NOT NULL CHECK(model='claude-haiku-4-5-20251001'),
 stop_reason text NOT NULL CHECK(stop_reason IN('end_turn','max_tokens','stop_sequence','tool_use','pause_turn','refusal','model_context_window_exceeded')),
 input_tokens integer NOT NULL CHECK(input_tokens BETWEEN 0 AND 200000),
 output_tokens integer NOT NULL CHECK(output_tokens BETWEEN 0 AND 1024),
 -- Fixed content_json_v1: SHA256 of canonical JSON for the bounded provider
 -- content array, before editorial parsing; not raw HTTP or a single text block.
 -- Only the digest is stored; no provider body or generated text is retained.
 response_sha256 text NOT NULL CHECK(response_sha256~'^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(attempt_key<>'daily:2026-11-16:zaria-solenne')
);
ALTER TABLE character_production.text_receipt_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.text_receipt_evidence FROM PUBLIC;
CREATE FUNCTION character_production.text_receipt_evidence_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Provider receipt evidence is append-only'; END IF;
 IF NOT EXISTS(SELECT 1 FROM character_production.text_replenishment_attempts WHERE key=NEW.attempt_key AND token=NEW.attempt_token AND source_digest=NEW.source_digest) THEN RAISE EXCEPTION 'Exact attempt identity required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER text_receipt_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON character_production.text_receipt_evidence FOR EACH ROW EXECUTE FUNCTION character_production.text_receipt_evidence_guard();
CREATE TRIGGER text_receipt_evidence_no_truncate BEFORE TRUNCATE ON character_production.text_receipt_evidence FOR EACH STATEMENT EXECUTE FUNCTION character_production.text_receipt_evidence_guard();
REVOKE ALL ON FUNCTION character_production.text_receipt_evidence_guard() FROM PUBLIC;
CREATE FUNCTION public.character_production_text_receipt(p_key text,p_token uuid,p_digest text,p_provider_id text,p_request_id text,p_model text,p_stop_reason text,p_input_tokens integer,p_output_tokens integer,p_response_sha256 text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- No raw provider body, prompt, generated text, credentials or open-ended JSON.
 IF p_key IS NULL OR p_key='daily:2026-11-16:zaria-solenne' OR p_token IS NULL OR p_digest IS NULL OR p_digest!~'^[a-f0-9]{64}$'
 OR p_provider_id IS NULL OR p_provider_id!~'^msg_[A-Za-z0-9]{8,196}$' OR (p_request_id IS NOT NULL AND p_request_id!~'^req_[A-Za-z0-9]{8,196}$')
 OR p_model IS DISTINCT FROM 'claude-haiku-4-5-20251001' OR p_stop_reason IS NULL OR p_stop_reason NOT IN('end_turn','max_tokens','stop_sequence','tool_use','pause_turn','refusal','model_context_window_exceeded')
 OR p_input_tokens IS NULL OR p_input_tokens NOT BETWEEN 0 AND 200000 OR p_output_tokens IS NULL OR p_output_tokens NOT BETWEEN 0 AND 1024
 OR p_response_sha256 IS NULL OR p_response_sha256!~'^[a-f0-9]{64}$' THEN RETURN false; END IF;
 -- Evidence may arrive after authority expires: it cannot authorize dispatch,
 -- save generated content, change attempt state, refund, release or retry.
 IF NOT EXISTS(SELECT 1 FROM character_production.text_replenishment_attempts WHERE key=p_key AND token=p_token AND source_digest=p_digest) THEN RETURN false; END IF;
 INSERT INTO character_production.text_receipt_evidence(attempt_key,attempt_token,source_digest,provider_id,request_id,model,stop_reason,input_tokens,output_tokens,response_sha256)
 VALUES(p_key,p_token,p_digest,p_provider_id,p_request_id,p_model,p_stop_reason,p_input_tokens,p_output_tokens,p_response_sha256) ON CONFLICT DO NOTHING;
 -- Identical transport retries are idempotent evidence readback, not generation.
 RETURN EXISTS(SELECT 1 FROM character_production.text_receipt_evidence WHERE attempt_key=p_key AND attempt_token=p_token AND source_digest=p_digest AND provider_id=p_provider_id AND request_id IS NOT DISTINCT FROM p_request_id AND model=p_model AND stop_reason=p_stop_reason AND input_tokens=p_input_tokens AND output_tokens=p_output_tokens AND response_sha256=p_response_sha256);
END $$;
REVOKE ALL ON FUNCTION public.character_production_text_receipt(text,uuid,text,text,text,text,text,integer,integer,text) FROM PUBLIC;
DO $$ DECLARE r record; own oid:='character_production_owner'::regrole; BEGIN
 IF current_user<>'character_production_owner' THEN RAISE EXCEPTION 'Restricted owner required'; END IF;
 FOR r IN SELECT relowner owner,relacl acl FROM pg_class WHERE oid='character_production.text_receipt_evidence'::regclass
 UNION ALL SELECT proowner,proacl FROM pg_proc WHERE oid IN('character_production.text_receipt_evidence_guard()'::regprocedure,'public.character_production_text_receipt(text,uuid,text,text,text,text,text,integer,integer,text)'::regprocedure)
 LOOP IF r.owner<>own OR EXISTS(SELECT 1 FROM aclexplode(r.acl) WHERE grantee<>own) THEN RAISE EXCEPTION 'Owner-only evidence required'; END IF; END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.character_production_text_receipt(text,uuid,text,text,text,text,text,integer,integer,text) TO service_role;
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
 IF has_table_privilege(r,(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname='text_receipt_evidence'),'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Runtime table grant'; END IF;
 IF r<>'service_role' AND (has_function_privilege(r,'public.character_production_text_receipt(text,uuid,text,text,text,text,text,integer,integer,text)','EXECUTE')) THEN RAISE EXCEPTION 'Public recovery RPC leak'; END IF;
 END LOOP;
 FOR obj IN SELECT oid,proowner,proacl FROM pg_proc WHERE oid IN('public.character_production_text_receipt(text,uuid,text,text,text,text,text,integer,integer,text)'::regprocedure) LOOP
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND (has_function_privilege(r.oid,obj.oid,'EXECUTE') OR pg_has_role(r.oid,'service_role','SET') OR pg_has_role(r.oid,'character_production_owner','SET')) IS DISTINCT FROM (r.rolname IN('postgres','service_role','authenticator','supabase_storage_admin','character_production_owner'))) THEN RAISE EXCEPTION 'Unexpected effective receipt principal'; END IF;
 IF obj.proowner<>'character_production_owner'::regrole OR EXISTS(SELECT 1 FROM aclexplode(obj.proacl) WHERE grantee NOT IN('character_production_owner'::regrole,'service_role'::regrole) OR privilege_type<>'EXECUTE' OR is_grantable) OR NOT has_function_privilege('service_role',obj.oid,'EXECUTE') THEN RAISE EXCEPTION 'Exact non-grantable RPC capability required'; END IF;
 END LOOP;
END $$;
-- Only replace final ROLLBACK after independent review, exact rehearsal and
-- action-time approval covering temporary SET/CREATE plus one runtime grant.
ROLLBACK;
