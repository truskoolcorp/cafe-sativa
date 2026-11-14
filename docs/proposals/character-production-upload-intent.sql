-- REVIEW ONLY. No grants/credentials/routes/activation. Dedicated owner required.
BEGIN;
CREATE TABLE character_production.upload_intents(
 key text PRIMARY KEY REFERENCES character_production.jobs(key),
 job jsonb NOT NULL, sha text NOT NULL CHECK(sha ~ '^[a-f0-9]{64}$'),
 bytes bigint NOT NULL CHECK(bytes BETWEEN 16 AND 36700160),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '120 seconds',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE character_production.upload_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.upload_intents FROM PUBLIC;
CREATE FUNCTION public.character_production_upload_inspect(p_job jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('job',i.job,'sha',i.sha,'bytes',i.bytes,
 'path',(i.job->>'digest')||'/'||i.sha||'.mp4',
 'expiresAt',floor(extract(epoch FROM i.expires_at)*1000)::bigint)
 FROM character_production.upload_intents i
 WHERE i.key=p_job->>'key' AND i.job=p_job AND i.expires_at>clock_timestamp()
 AND public.character_production_broker_authorized(p_job)
$$;
CREATE FUNCTION public.character_production_upload_reserve(p_job jsonb,p_sha text,p_bytes bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_sha IS NULL OR p_sha !~ '^[a-f0-9]{64}$' OR p_bytes IS NULL OR p_bytes NOT BETWEEN 16 AND 36700160 THEN RETURN NULL; END IF;
 -- Job row serializes claims; single immutable signing attempt per job.
 PERFORM 1 FROM character_production.jobs WHERE key=p_job->>'key' AND state='submitted' FOR UPDATE;
 IF NOT FOUND OR NOT public.character_production_broker_authorized(p_job) THEN RETURN NULL; END IF;
 INSERT INTO character_production.upload_intents(key,job,sha,bytes) VALUES(p_job->>'key',p_job,p_sha,p_bytes) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN public.character_production_upload_inspect(p_job);
END $$;
CREATE FUNCTION public.character_production_upload_finalize(p_job jsonb,p_sha text,p_bytes bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j character_production.jobs;
BEGIN
 -- Hold all authorization rows through output attestation to avoid revocation race.
 SELECT * INTO j FROM character_production.jobs WHERE key=p_job->>'key';
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM character_production.approved_slots WHERE key=j.key FOR SHARE;
 PERFORM 1 FROM character_production.budgets WHERE provider=j.provider AND period=j.period FOR SHARE;
 PERFORM 1 FROM character_production.jobs WHERE key=j.key FOR UPDATE;
 IF NOT public.character_production_broker_authorized(p_job) OR NOT EXISTS(
 SELECT 1 FROM character_production.upload_intents i WHERE i.key=j.key AND i.job=p_job
 AND i.sha=p_sha AND i.bytes=p_bytes AND i.expires_at>clock_timestamp()) THEN RETURN false; END IF;
 RETURN public.character_production_output(p_job,p_sha,p_bytes);
END $$;
REVOKE ALL ON FUNCTION public.character_production_upload_reserve(jsonb,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_upload_inspect(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_upload_finalize(jsonb,text,bigint) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','character_production_generator','character_production_output_broker'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON character_production.upload_intents FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_upload_reserve(jsonb,text,bigint),public.character_production_upload_inspect(jsonb),public.character_production_upload_finalize(jsonb,text,bigint) FROM %I',r);
 END IF; END LOOP;
END $$;
COMMIT;
