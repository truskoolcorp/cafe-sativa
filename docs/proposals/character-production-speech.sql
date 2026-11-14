-- REVIEW ONLY. Existing dedicated owner applies separately; no grants/activation.
BEGIN;
CREATE TABLE character_production.speech_budgets (
 account text NOT NULL, period text NOT NULL CHECK(period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 cap_cents bigint NOT NULL CHECK(cap_cents BETWEEN 1 AND 1000000000),
 reserved_cents bigint NOT NULL DEFAULT 0 CHECK(reserved_cents>=0 AND reserved_cents<=cap_cents),
 enabled boolean NOT NULL DEFAULT false, PRIMARY KEY(account,period)
);
CREATE TABLE character_production.speech_authorizations (
 key text PRIMARY KEY,slot jsonb NOT NULL CHECK(jsonb_typeof(slot)='object'),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE character_production.speech_jobs (
 key text PRIMARY KEY REFERENCES character_production.speech_authorizations(key),
 token uuid NOT NULL DEFAULT gen_random_uuid(),slot jsonb NOT NULL,digest text NOT NULL,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','unknown','rendered','pending_qa')),
 request_id text UNIQUE,manifest jsonb,manifest_digest text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE character_production.speech_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.speech_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.speech_jobs ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION character_production.speech_current(j character_production.speech_jobs) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM character_production.speech_authorizations a JOIN character_production.speech_budgets b ON b.account=j.slot->>'accountBinding' AND b.period=j.slot->>'period'
 WHERE a.key=j.key AND a.enabled AND a.slot=j.slot AND a.digest=j.digest AND b.enabled
 AND b.cap_cents=(j.slot->>'periodCapCents')::bigint
 AND j.slot->>'period'=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM')
 AND (j.slot->>'expiresAt')::bigint>extract(epoch FROM clock_timestamp())*1000);
$$;
CREATE FUNCTION public.character_production_speech_claim(p_slot jsonb,p_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a character_production.speech_authorizations; b character_production.speech_budgets; j character_production.speech_jobs; cost bigint;
BEGIN
 IF p_slot IS NULL OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_slot)<>'object' OR p_slot->>'key' IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO a FROM character_production.speech_authorizations WHERE key=p_slot->>'key' FOR UPDATE;
 IF NOT FOUND OR NOT a.enabled OR a.slot<>p_slot OR a.digest<>p_digest THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['key','authorizationId','accountBinding','characterId','avatarId','voiceId','voiceModel','canonicalRevision','portraitSha256','script','period','expiresAt','quoteCents','periodCapCents','maxCharacters','maxAudioBytes']) k WHERE p_slot->>k IS NULL) THEN RETURN NULL; END IF;
 IF p_slot->>'period'<>to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM') OR (p_slot->>'expiresAt')::bigint<=extract(epoch FROM clock_timestamp())*1000
 OR length(btrim(p_slot->>'script'))<1 OR length(p_slot->>'script')>5000 OR length(p_slot->>'script')>(p_slot->>'maxCharacters')::integer
 OR (p_slot->>'maxAudioBytes')::bigint NOT BETWEEN 12 AND 33554432
 OR p_slot->>'voiceModel' !~ '^eleven_[a-z0-9_]+$' THEN RETURN NULL; END IF;
 cost:=(p_slot->>'quoteCents')::bigint;
 SELECT * INTO b FROM character_production.speech_budgets WHERE account=p_slot->>'accountBinding' AND period=p_slot->>'period' FOR UPDATE;
 IF NOT FOUND OR NOT b.enabled OR cost IS NULL OR cost<1 OR b.cap_cents<>(p_slot->>'periodCapCents')::bigint OR b.reserved_cents+cost>b.cap_cents THEN RETURN NULL; END IF;
 INSERT INTO character_production.speech_jobs(key,slot,digest) VALUES(a.key,a.slot,a.digest) ON CONFLICT(key) DO NOTHING RETURNING * INTO j;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE character_production.speech_budgets SET reserved_cents=reserved_cents+cost WHERE account=b.account AND period=b.period;
 RETURN jsonb_build_object('token',j.token,'digest',j.digest);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN NULL;
END $$;
CREATE FUNCTION public.character_production_speech_unknown(p_key text,p_token text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE character_production.speech_jobs SET state='unknown' WHERE key=p_key AND token::text=p_token AND state='reserved';
 RETURN FOUND;
END $$;
CREATE FUNCTION public.character_production_speech_rendered(p_key text,p_token text,p_digest text,p_manifest jsonb,p_manifest_digest text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j character_production.speech_jobs;
BEGIN
 -- Match claim lock order: authorization, budget, job. Authority is held during receipt.
 PERFORM 1 FROM character_production.speech_authorizations WHERE key=p_key FOR SHARE;
 SELECT * INTO j FROM character_production.speech_jobs WHERE key=p_key;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM character_production.speech_budgets WHERE account=j.slot->>'accountBinding' AND period=j.slot->>'period' FOR SHARE;
 SELECT * INTO j FROM character_production.speech_jobs WHERE key=p_key FOR UPDATE;
 IF j.token::text IS DISTINCT FROM p_token OR j.digest IS DISTINCT FROM p_digest OR j.state NOT IN ('reserved','rendered') OR NOT character_production.speech_current(j) THEN RETURN false; END IF;
 IF p_manifest IS NULL OR p_manifest_digest IS NULL OR p_manifest_digest !~ '^[a-f0-9]{64}$' OR p_manifest->>'provider' IS DISTINCT FROM 'elevenlabs' OR p_manifest->>'mime' IS DISTINCT FROM 'audio/mpeg'
 OR p_manifest->>'characterId' IS DISTINCT FROM j.slot->>'characterId' OR p_manifest->>'avatarId' IS DISTINCT FROM j.slot->>'avatarId' OR p_manifest->>'voiceId' IS DISTINCT FROM j.slot->>'voiceId' OR p_manifest->>'voiceModel' IS DISTINCT FROM j.slot->>'voiceModel'
 OR p_manifest->>'canonicalRevision' IS DISTINCT FROM j.slot->>'canonicalRevision' OR p_manifest->>'portraitSha256' IS DISTINCT FROM j.slot->>'portraitSha256'
 OR p_manifest->>'scriptSha256' IS DISTINCT FROM encode(sha256(convert_to(j.slot->>'script','UTF8')),'hex')
 OR coalesce(p_manifest->>'audioSha256','') !~ '^[a-f0-9]{64}$' OR p_manifest->>'audioBytes' IS NULL OR (p_manifest->>'audioBytes')::bigint NOT BETWEEN 12 AND (j.slot->>'maxAudioBytes')::bigint
 OR coalesce(p_manifest->>'synthesisReceiptId','') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$' THEN RETURN false; END IF;
 IF j.state='rendered' THEN RETURN j.manifest=p_manifest AND j.manifest_digest=p_manifest_digest; END IF;
 UPDATE character_production.speech_jobs SET state='rendered',request_id=p_manifest->>'synthesisReceiptId',manifest=p_manifest,manifest_digest=p_manifest_digest WHERE key=p_key;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR unique_violation THEN RETURN false;
END $$;
CREATE FUNCTION public.character_production_speech_verified(p_key text,p_token text,p_digest text,p_manifest jsonb,p_manifest_digest text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j character_production.speech_jobs;
BEGIN
 PERFORM 1 FROM character_production.speech_authorizations WHERE key=p_key FOR SHARE;
 SELECT * INTO j FROM character_production.speech_jobs WHERE key=p_key;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM character_production.speech_budgets WHERE account=j.slot->>'accountBinding' AND period=j.slot->>'period' FOR SHARE;
 SELECT * INTO j FROM character_production.speech_jobs WHERE key=p_key FOR UPDATE;
 IF j.token::text IS DISTINCT FROM p_token OR j.digest IS DISTINCT FROM p_digest OR j.state NOT IN ('rendered','pending_qa') OR j.manifest IS DISTINCT FROM p_manifest OR j.manifest_digest IS DISTINCT FROM p_manifest_digest OR NOT character_production.speech_current(j) THEN RETURN false; END IF;
 UPDATE character_production.speech_jobs SET state='pending_qa' WHERE key=p_key;
 RETURN true;
END $$;
REVOKE ALL ON character_production.speech_budgets,character_production.speech_authorizations,character_production.speech_jobs FROM PUBLIC;
REVOKE ALL ON FUNCTION character_production.speech_current(character_production.speech_jobs) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_speech_claim(jsonb,text),public.character_production_speech_unknown(text,text),public.character_production_speech_rendered(text,text,text,jsonb,text),public.character_production_speech_verified(text,text,text,jsonb,text) FROM PUBLIC;
DO $$ DECLARE r text; fn record; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','character_production_generator','character_production_output_broker'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
  EXECUTE format('REVOKE ALL ON character_production.speech_budgets,character_production.speech_authorizations,character_production.speech_jobs FROM %I',r);
  FOR fn IN SELECT oid::regprocedure signature FROM pg_proc WHERE (pronamespace='public'::regnamespace AND proname LIKE 'character_production_speech_%') OR (pronamespace='character_production'::regnamespace AND proname='speech_current') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',fn.signature,r); END LOOP;
 END IF; END LOOP;
END $$;
COMMIT;
