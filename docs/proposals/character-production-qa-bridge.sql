-- RECONSTRUCTED REVIEW PROPOSAL ONLY. NOT A MIGRATION. Do not apply without approval.
-- Requires character-production-store.sql (including immutable jobs.slot) and
-- existing public.cs_character_promo_drafts. No grants, targets, buckets or cron.
BEGIN;
CREATE TABLE character_production.qa_targets (
 job_key text PRIMARY KEY REFERENCES character_production.jobs(key),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 promo_id uuid NOT NULL UNIQUE REFERENCES public.cs_character_promo_drafts(id),
 expected_updated_at timestamptz NOT NULL,
 enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE character_production.qa_ingestion_receipts (
 job_key text PRIMARY KEY REFERENCES character_production.qa_targets(job_key),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), promo_id uuid NOT NULL UNIQUE,
 expected_updated_at timestamptz NOT NULL, committed_updated_at timestamptz NOT NULL,
 sha text NOT NULL CHECK(sha ~ '^[a-f0-9]{64}$'), bytes bigint NOT NULL CHECK(bytes BETWEEN 16 AND 36700160),
 bucket text NOT NULL CHECK(bucket='cafe-sativa-content'), object_path text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE character_production.qa_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.qa_ingestion_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.qa_targets,character_production.qa_ingestion_receipts FROM PUBLIC;
-- Internal validator holds locks through the entire caller transaction. No
-- worker may enroll targets, modify receipts or invoke this helper directly.
CREATE FUNCTION character_production.qa_manifest(p_key text,p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a character_production.approved_slots; j character_production.jobs;
 t character_production.qa_targets; d public.cs_character_promo_drafts;
 r character_production.qa_ingestion_receipts; dest text; phase text;
BEGIN
 -- Refuse stale repeatable-read snapshots of policy/targets. External callers
 -- must use independent READ COMMITTED transactions, not retained snapshots.
 IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RETURN NULL; END IF;
 SELECT * INTO a FROM character_production.approved_slots WHERE key=p_key FOR UPDATE;
 IF NOT FOUND OR a.enabled IS DISTINCT FROM true OR a.digest IS DISTINCT FROM p_digest THEN RETURN NULL; END IF;
 SELECT * INTO j FROM character_production.jobs WHERE key=p_key FOR UPDATE;
 IF NOT FOUND OR j.digest IS DISTINCT FROM p_digest OR j.digest IS DISTINCT FROM a.digest
 OR a.slot IS DISTINCT FROM j.slot OR j.state IS DISTINCT FROM 'pending_qa'
 OR j.sha IS NULL OR j.sha !~ '^[a-f0-9]{64}$' OR j.bytes IS NULL OR j.bytes NOT BETWEEN 16 AND 36700160
 OR j.bucket IS DISTINCT FROM 'character-production-private'
 OR j.object_path IS DISTINCT FROM j.digest||'/'||j.sha||'.mp4' THEN RETURN NULL; END IF;
 SELECT * INTO t FROM character_production.qa_targets WHERE job_key=j.key FOR UPDATE;
 IF NOT FOUND OR t.enabled IS DISTINCT FROM true OR t.digest IS DISTINCT FROM j.digest THEN RETURN NULL; END IF;
 SELECT * INTO d FROM public.cs_character_promo_drafts WHERE id=t.promo_id FOR UPDATE;
 IF NOT FOUND OR d.character_id IS DISTINCT FROM j.slot->>'characterId' OR d.spoken_script IS DISTINCT FROM j.slot->>'script'
 OR j.slot->>'characterId' IS NULL OR j.slot->>'characterId' !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$'
 OR j.slot->>'script' IS NULL OR length(btrim(j.slot->>'script'))=0
 OR d.status IS NULL OR d.status NOT IN ('draft','revision_requested')
 OR d.audio_asset_path IS NOT NULL OR d.voice_approved_at IS NOT NULL OR d.video_qa_approved_at IS NOT NULL
 OR d.publication_approved_at IS NOT NULL THEN RETURN NULL; END IF;
 dest:='character-promos/'||d.character_id||'/'||d.id::text||'/'||j.sha||'.mp4';
 SELECT * INTO r FROM character_production.qa_ingestion_receipts WHERE job_key=j.key FOR UPDATE;
 IF FOUND THEN
  IF r.digest IS DISTINCT FROM j.digest OR r.promo_id IS DISTINCT FROM d.id
  OR r.expected_updated_at IS DISTINCT FROM t.expected_updated_at OR r.sha IS DISTINCT FROM j.sha
  OR r.bytes IS DISTINCT FROM j.bytes OR r.object_path IS DISTINCT FROM dest
  OR r.bucket IS DISTINCT FROM 'cafe-sativa-content' OR d.video_asset_path IS DISTINCT FROM dest
  OR d.updated_at IS DISTINCT FROM r.committed_updated_at THEN RETURN NULL; END IF;
  phase:='committed';
 ELSE
  IF d.updated_at IS DISTINCT FROM t.expected_updated_at OR d.video_asset_path IS NOT NULL THEN RETURN NULL; END IF;
  phase:='copy';
 END IF;
 RETURN jsonb_build_object('state',phase,'key',j.key,'digest',j.digest,'sha',j.sha,'bytes',j.bytes,
 'characterId',d.character_id,'promoId',d.id,'expectedUpdatedAt',t.expected_updated_at,
 'sourceBucket',j.bucket,'sourcePath',j.object_path,'destinationBucket','cafe-sativa-content','destinationPath',dest);
END $$;
CREATE FUNCTION public.character_production_qa_prepare(p_key text,p_digest text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT character_production.qa_manifest(p_key,p_digest)
$$;
CREATE FUNCTION public.character_production_qa_commit(p_key text,p_digest text,p_sha text,p_bytes bigint,
 p_promo_id uuid,p_expected_updated_at timestamptz,p_destination_bucket text,p_destination_path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m jsonb; stamp timestamptz;
BEGIN
 m:=character_production.qa_manifest(p_key,p_digest);
 -- Compare the exact prepared target, including PostgreSQL microsecond precision.
 -- These are equality guards, not authority to select or enroll another target.
 IF m IS NULL OR m->>'sha' IS DISTINCT FROM p_sha OR (m->>'bytes')::bigint IS DISTINCT FROM p_bytes
 OR (m->>'promoId')::uuid IS DISTINCT FROM p_promo_id
 OR (m->>'expectedUpdatedAt')::timestamptz IS DISTINCT FROM p_expected_updated_at
 OR m->>'destinationBucket' IS DISTINCT FROM p_destination_bucket
 OR m->>'destinationPath' IS DISTINCT FROM p_destination_path THEN RETURN false; END IF;
 IF m->>'state'='committed' THEN RETURN true; END IF;
 -- Only the audited private bridge may attest storage byte verification. SQL
 -- cannot inspect Storage bytes. No ordinary generation-worker EXECUTE access.
 UPDATE public.cs_character_promo_drafts SET video_asset_path=m->>'destinationPath',updated_at=clock_timestamp()
 WHERE id=(m->>'promoId')::uuid AND updated_at=(m->>'expectedUpdatedAt')::timestamptz
 AND video_asset_path IS NULL AND audio_asset_path IS NULL
 AND voice_approved_at IS NULL AND video_qa_approved_at IS NULL AND publication_approved_at IS NULL
 RETURNING updated_at INTO stamp;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO character_production.qa_ingestion_receipts(job_key,digest,promo_id,expected_updated_at,committed_updated_at,sha,bytes,bucket,object_path)
 VALUES(p_key,p_digest,(m->>'promoId')::uuid,(m->>'expectedUpdatedAt')::timestamptz,stamp,p_sha,p_bytes,'cafe-sativa-content',m->>'destinationPath');
 RETURN true;
END $$;
-- Read-only discovery never substitutes for locked prepare/commit validation.
CREATE FUNCTION public.character_production_qa_pending(p_limit integer)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(x.identity),'[]'::jsonb) FROM (
  SELECT jsonb_build_object('key',j.key,'digest',j.digest) AS identity
  FROM character_production.jobs j
  JOIN character_production.qa_targets t ON t.job_key=j.key AND t.digest=j.digest AND t.enabled=true
  JOIN character_production.approved_slots a ON a.key=j.key AND a.digest=j.digest AND a.slot=j.slot AND a.enabled=true
  WHERE j.state='pending_qa'
  AND NOT EXISTS(SELECT 1 FROM character_production.qa_ingestion_receipts r WHERE r.job_key=j.key)
  ORDER BY j.created_at,j.key LIMIT greatest(0,least(coalesce(p_limit,0),5))
 ) x
$$;
REVOKE ALL ON FUNCTION character_production.qa_manifest(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_qa_prepare(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_qa_commit(text,text,text,bigint,uuid,timestamptz,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_qa_pending(integer) FROM PUBLIC;
-- Remove common inherited default grants; grant nothing in this proposal.
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON character_production.qa_targets,character_production.qa_ingestion_receipts FROM %I',r);
   EXECUTE format('REVOKE ALL ON FUNCTION character_production.qa_manifest(text,text) FROM %I',r);
   EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_qa_prepare(text,text) FROM %I',r);
   EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_qa_commit(text,text,text,bigint,uuid,timestamptz,text,text) FROM %I',r);
   EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_qa_pending(integer) FROM %I',r);
  END IF;
 END LOOP;
END $$;
COMMIT;
