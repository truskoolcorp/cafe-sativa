-- OFFLINE PROPOSAL ONLY. Provider metadata evidence, never content or approval.
-- No install/grants/activation; action-time approval required for new capability.
-- The frozen Nov16 Zaria attempt is excluded, including direct owner inserts.
BEGIN;
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
ROLLBACK;
