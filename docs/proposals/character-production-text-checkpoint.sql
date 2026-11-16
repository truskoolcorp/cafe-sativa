-- OFFLINE ONLY. Private bounded provider-content checkpoint, no prompt/headers.
-- Installation and runtime EXECUTE grants require separate future approval.
-- Not approval, new authority, output/state advance, refund, retry or generation.
BEGIN;
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
ROLLBACK;
