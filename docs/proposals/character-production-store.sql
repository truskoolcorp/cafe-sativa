-- FRESH RECONSTRUCTION. REVIEW PROPOSAL ONLY, NOT A MIGRATION.
-- PostgreSQL 17. No production changes, grants, credentials, bucket creation or cron.
-- A separate approved deployment must choose dedicated owner/worker roles.
BEGIN;
CREATE SCHEMA character_production;
REVOKE ALL ON SCHEMA character_production FROM PUBLIC;
CREATE TABLE character_production.budgets (
 provider text NOT NULL, period text NOT NULL CHECK(period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 cap_cents bigint NOT NULL CHECK(cap_cents>0 AND cap_cents<=9007199254740991),
 reserved_cents bigint NOT NULL DEFAULT 0 CHECK(reserved_cents>=0 AND reserved_cents<=cap_cents),
 enabled boolean NOT NULL DEFAULT false, revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(provider,period)
);
-- Exact slots are provisioned by a separate trusted policy owner, never worker.
CREATE TABLE character_production.approved_slots (
 key text PRIMARY KEY, slot jsonb NOT NULL, digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 enabled boolean NOT NULL DEFAULT false, revision bigint NOT NULL DEFAULT 1,
 CHECK(jsonb_typeof(slot)='object' AND (slot->>'key') IS NOT DISTINCT FROM key)
);
CREATE FUNCTION character_production.bump_revision() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$ BEGIN NEW.revision:=OLD.revision+1; RETURN NEW; END $$;
CREATE TRIGGER approved_slot_revision BEFORE UPDATE ON character_production.approved_slots
FOR EACH ROW EXECUTE FUNCTION character_production.bump_revision();
CREATE TRIGGER budget_revision BEFORE UPDATE OF cap_cents,enabled ON character_production.budgets
FOR EACH ROW EXECUTE FUNCTION character_production.bump_revision();
CREATE TABLE character_production.jobs (
 key text PRIMARY KEY REFERENCES character_production.approved_slots(key),
 slot jsonb NOT NULL CHECK(jsonb_typeof(slot)='object' AND (slot->>'key') IS NOT DISTINCT FROM key),
 token text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 provider text NOT NULL, model text NOT NULL, period text NOT NULL,
 provider_binding_revision text NOT NULL CHECK(provider_binding_revision ~ '^[a-f0-9]{64}$'),
 cost bigint NOT NULL CHECK(cost>0), state text NOT NULL DEFAULT 'submitting'
 CHECK(state IN ('submitting','submitted','unknown','failed','pending_qa')),
 task text, sha text CHECK(sha ~ '^[a-f0-9]{64}$'), bytes bigint,
 bucket text, object_path text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(provider,period) REFERENCES character_production.budgets(provider,period),
 UNIQUE(provider,task),
 CHECK((state='pending_qa')=(sha IS NOT NULL AND bytes IS NOT NULL AND bucket IS NOT NULL AND object_path IS NOT NULL)),
 CHECK(bytes IS NULL OR bytes BETWEEN 12 AND 50000000)
);
ALTER TABLE character_production.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.approved_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA character_production FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA character_production FROM PUBLIC;

CREATE FUNCTION public.character_production_authorization(p_key text,p_authorization_id text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('slot',a.slot,'digest',a.digest,'enabled',a.enabled AND b.enabled,
 'revision',a.revision::text||':'||b.revision::text,
 'observedAt',floor(extract(epoch FROM clock_timestamp())*1000)::bigint)
 FROM character_production.approved_slots a JOIN character_production.budgets b
 ON b.provider=a.slot->>'provider' AND b.period=a.slot->>'period'
 WHERE a.key=p_key AND a.slot->>'authorizationId'=p_authorization_id
 AND b.cap_cents=(a.slot->>'periodCapCents')::bigint
$$;
CREATE FUNCTION public.character_production_claim(p_slot jsonb,p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a character_production.approved_slots; b character_production.budgets;
 j character_production.jobs; cost bigint;
BEGIN
 IF p_slot IS NULL OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 SELECT * INTO a FROM character_production.approved_slots WHERE key=p_slot->>'key' FOR UPDATE;
 IF NOT FOUND OR a.enabled IS DISTINCT FROM true OR a.slot IS DISTINCT FROM p_slot OR a.digest IS DISTINCT FROM p_digest THEN RETURN NULL; END IF;
 IF a.slot->>'providerBindingRevision' IS NULL OR a.slot->>'providerBindingRevision' !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 SELECT * INTO b FROM character_production.budgets
 WHERE provider=a.slot->>'provider' AND period=a.slot->>'period' FOR UPDATE;
 IF NOT FOUND OR b.enabled IS DISTINCT FROM true OR b.cap_cents IS DISTINCT FROM (a.slot->>'periodCapCents')::bigint THEN RETURN NULL; END IF;
 -- Locks may wait across expiry/month rollover: check server time after both.
 IF a.slot->>'authorizationExpiresAt' IS NULL
 OR a.slot->>'authorizationExpiresAt' !~ '^[0-9]{1,16}$' THEN RETURN NULL; END IF;
 IF (a.slot->>'authorizationExpiresAt')::numeric <= extract(epoch FROM clock_timestamp())*1000
 OR a.slot->>'period' IS DISTINCT FROM to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM') THEN RETURN NULL; END IF;
 cost:=(a.slot->>'quoteCents')::bigint;
 IF cost IS NULL OR cost<=0 OR cost>b.cap_cents-b.reserved_cents THEN RETURN NULL; END IF;
 INSERT INTO character_production.jobs(key,digest,provider,model,period,cost,provider_binding_revision,slot)
 VALUES(a.key,a.digest,b.provider,a.slot->>'model',b.period,cost,a.slot->>'providerBindingRevision',a.slot)
 ON CONFLICT(key) DO NOTHING RETURNING * INTO j;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE character_production.budgets SET reserved_cents=reserved_cents+cost
 WHERE provider=b.provider AND period=b.period;
 RETURN jsonb_build_object('token',j.token,'digest',j.digest);
END $$;
CREATE FUNCTION public.character_production_submitted(p_key text,p_token text,p_digest text,p_task text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_task IS NULL OR p_task !~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$' THEN RETURN false; END IF;
 UPDATE character_production.jobs SET state='submitted',task=p_task
 WHERE key=p_key AND token=p_token AND digest=p_digest AND state='submitting';
 RETURN FOUND;
END $$;
CREATE FUNCTION public.character_production_unknown(p_key text,p_token text,p_digest text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE character_production.jobs SET state='unknown'
 WHERE key=p_key AND token=p_token AND digest=p_digest AND state='submitting'
$$;
CREATE FUNCTION public.character_production_pending(p_provider text,p_model text,p_limit integer)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(x.j),'[]'::jsonb) FROM (
 SELECT jsonb_build_object('key',key,'token',token,'digest',digest,'taskId',task,'provider',provider,'model',model,'providerBindingRevision',provider_binding_revision) j
 FROM character_production.jobs WHERE state='submitted' AND provider=p_provider AND model=p_model
 ORDER BY created_at,key LIMIT greatest(0,least(p_limit,5))) x
$$;
CREATE FUNCTION public.character_production_failed(p_job jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE character_production.jobs SET state='failed'
 WHERE key=p_job->>'key' AND token=p_job->>'token' AND digest=p_job->>'digest'
 AND task=p_job->>'taskId' AND provider=p_job->>'provider' AND model=p_job->>'model'
 AND provider_binding_revision=p_job->>'providerBindingRevision' AND state='submitted'
$$;
CREATE FUNCTION public.character_production_output_status(p_job jsonb,p_sha text,p_bytes bigint)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN state='submitted' THEN 'upload'
 WHEN state='pending_qa' AND sha=p_sha AND bytes=p_bytes
 AND bucket='character-production-private' AND object_path=digest||'/'||p_sha||'.mp4' THEN 'committed' ELSE 'held' END
 FROM character_production.jobs
 WHERE key=p_job->>'key' AND token=p_job->>'token' AND digest=p_job->>'digest'
 AND task=p_job->>'taskId' AND provider=p_job->>'provider' AND model=p_job->>'model'
 AND provider_binding_revision=p_job->>'providerBindingRevision'
 AND p_sha ~ '^[a-f0-9]{64}$' AND p_bytes BETWEEN 12 AND 50000000
$$;
CREATE FUNCTION public.character_production_output(p_job jsonb,p_sha text,p_bytes bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_sha IS NULL OR p_sha !~ '^[a-f0-9]{64}$' OR p_bytes IS NULL OR p_bytes NOT BETWEEN 12 AND 50000000 THEN RETURN false; END IF;
 UPDATE character_production.jobs SET state='pending_qa',sha=p_sha,bytes=p_bytes,
 bucket='character-production-private',object_path=digest||'/'||p_sha||'.mp4'
 WHERE key=p_job->>'key' AND token=p_job->>'token' AND digest=p_job->>'digest'
 AND task=p_job->>'taskId' AND provider=p_job->>'provider' AND model=p_job->>'model'
 AND provider_binding_revision=p_job->>'providerBindingRevision' AND state='submitted';
 IF FOUND THEN RETURN true; END IF;
 RETURN coalesce(public.character_production_output_status(p_job,p_sha,p_bytes)='committed',false);
END $$;
REVOKE ALL ON FUNCTION public.character_production_authorization(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_claim(jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_submitted(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_unknown(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_pending(text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_failed(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_output_status(jsonb,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_output(jsonb,text,bigint) FROM PUBLIC;
-- Remove default-privilege role grants too; no role gets new access here.
DO $$ DECLARE r text; f record; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON SCHEMA character_production FROM %I',r);
   EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA character_production FROM %I',r);
   EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA character_production FROM %I',r);
   FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'character_production_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);
   END LOOP;
  END IF;
 END LOOP;
END $$;
COMMIT;
