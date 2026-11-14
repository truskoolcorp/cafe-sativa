-- DORMANT PROPOSAL ONLY. Not a migration or installation authorization.
-- Apply as existing character_production_owner only after a separately reviewed
-- installer supplies temporary DDL authority. Source policies are separate below.
-- Planner is a trusted owner-context transaction, never an ordinary worker.
BEGIN;
CREATE TABLE character_production.qa_slot_bindings (
 slot_key text PRIMARY KEY REFERENCES character_production.approved_slots(key),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 slot jsonb NOT NULL CHECK(jsonb_typeof(slot)='object'),
 promo_id uuid NOT NULL UNIQUE REFERENCES public.cs_character_promo_drafts(id),
 expected_updated_at timestamptz NOT NULL,
 enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE character_production.qa_slot_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.qa_slot_bindings FROM PUBLIC;
-- Once materialized, disabling/deleting the planner binding must also revoke
-- the existing bridge target. Identity/revision may never be silently retargeted.
CREATE FUNCTION character_production.qa_binding_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM character_production.qa_targets WHERE job_key=OLD.slot_key) THEN
  IF TG_OP='UPDATE' AND (NEW.slot_key IS DISTINCT FROM OLD.slot_key OR NEW.digest IS DISTINCT FROM OLD.digest
   OR NEW.slot IS DISTINCT FROM OLD.slot OR NEW.promo_id IS DISTINCT FROM OLD.promo_id
   OR NEW.expected_updated_at IS DISTINCT FROM OLD.expected_updated_at OR NEW.enabled IS DISTINCT FROM false) THEN
   RAISE EXCEPTION 'Materialized QA binding immutable; revoke only';
  END IF;
  UPDATE character_production.qa_targets SET enabled=false WHERE job_key=OLD.slot_key;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION character_production.qa_binding_guard() FROM PUBLIC;
CREATE TRIGGER qa_binding_guard BEFORE UPDATE OR DELETE ON character_production.qa_slot_bindings
 FOR EACH ROW EXECUTE FUNCTION character_production.qa_binding_guard();
CREATE FUNCTION public.character_production_qa_materialize(p_key text,p_digest text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a character_production.approved_slots; j character_production.jobs;
 b character_production.qa_slot_bindings; d public.cs_character_promo_drafts;
 t character_production.qa_targets;
BEGIN
 IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RETURN false; END IF;
 -- Same lock ordering as qa_manifest; binding is locked before the draft.
 SELECT * INTO a FROM character_production.approved_slots WHERE key=p_key FOR UPDATE;
 IF NOT FOUND OR a.enabled IS DISTINCT FROM true OR a.digest IS DISTINCT FROM p_digest THEN RETURN false; END IF;
 SELECT * INTO j FROM character_production.jobs WHERE key=p_key FOR UPDATE;
 IF NOT FOUND OR j.digest IS DISTINCT FROM p_digest OR a.slot IS DISTINCT FROM j.slot
 OR j.state IS DISTINCT FROM 'pending_qa' OR j.sha IS NULL OR j.sha !~ '^[a-f0-9]{64}$'
 OR j.bytes IS NULL OR j.bytes NOT BETWEEN 16 AND 36700160
 OR j.bucket IS DISTINCT FROM 'character-production-private'
 OR j.object_path IS DISTINCT FROM j.digest||'/'||j.sha||'.mp4' THEN RETURN false; END IF;
 SELECT * INTO b FROM character_production.qa_slot_bindings WHERE slot_key=p_key FOR UPDATE;
 IF NOT FOUND OR b.enabled IS DISTINCT FROM true OR b.digest IS DISTINCT FROM p_digest
 OR b.slot IS DISTINCT FROM a.slot THEN RETURN false; END IF;
 SELECT * INTO t FROM character_production.qa_targets WHERE job_key=p_key FOR UPDATE;
 IF FOUND THEN
  IF t.enabled IS DISTINCT FROM true OR t.digest IS DISTINCT FROM b.digest
  OR t.promo_id IS DISTINCT FROM b.promo_id OR t.expected_updated_at IS DISTINCT FROM b.expected_updated_at THEN RETURN false; END IF;
  -- Includes exact committed replay, but rejects a subsequently edited target.
  RETURN character_production.qa_manifest(p_key,p_digest) IS NOT NULL;
 END IF;
 SELECT * INTO d FROM public.cs_character_promo_drafts WHERE id=b.promo_id FOR UPDATE;
 IF NOT FOUND OR d.updated_at IS DISTINCT FROM b.expected_updated_at
 OR d.character_id IS DISTINCT FROM a.slot->>'characterId'
 OR d.spoken_script IS DISTINCT FROM a.slot->>'script'
 OR a.slot->>'characterId' IS NULL OR a.slot->>'characterId' !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$'
 OR a.slot->>'script' IS NULL OR length(btrim(a.slot->>'script'))=0
 OR d.status IS NULL OR d.status NOT IN ('draft','revision_requested')
 OR d.audio_asset_path IS NOT NULL OR d.video_asset_path IS NOT NULL
 OR d.voice_approved_at IS NOT NULL OR d.video_qa_approved_at IS NOT NULL
 OR d.publication_approved_at IS NOT NULL THEN RETURN false; END IF;
 -- Unique promo_id prevents a second job claiming the same draft. Conflict is
 -- refusal, never reassignment. No job, source, budget or paid state is written.
 INSERT INTO character_production.qa_targets(job_key,digest,promo_id,expected_updated_at,enabled)
 VALUES(p_key,p_digest,b.promo_id,b.expected_updated_at,true) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $$;
CREATE FUNCTION public.character_production_qa_ready_slots(p_limit integer)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(x.identity),'[]'::jsonb) FROM (
 SELECT jsonb_build_object('key',j.key,'digest',j.digest) identity
 FROM character_production.jobs j
 JOIN character_production.approved_slots a ON a.key=j.key AND a.digest=j.digest AND a.slot=j.slot AND a.enabled=true
 JOIN character_production.qa_slot_bindings b ON b.slot_key=j.key AND b.digest=j.digest AND b.slot=j.slot AND b.enabled=true
 JOIN public.cs_character_promo_drafts d ON d.id=b.promo_id
 WHERE j.state='pending_qa' AND d.updated_at=b.expected_updated_at
 AND d.character_id=j.slot->>'characterId' AND d.spoken_script=j.slot->>'script'
 AND j.slot->>'characterId' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$' AND length(btrim(j.slot->>'script'))>0
 AND d.status IN ('draft','revision_requested') AND d.video_asset_path IS NULL AND d.audio_asset_path IS NULL
 AND d.voice_approved_at IS NULL AND d.video_qa_approved_at IS NULL AND d.publication_approved_at IS NULL
 AND j.sha ~ '^[a-f0-9]{64}$' AND j.bytes BETWEEN 16 AND 36700160
 AND j.bucket='character-production-private' AND j.object_path=j.digest||'/'||j.sha||'.mp4'
 AND NOT EXISTS(SELECT 1 FROM character_production.qa_ingestion_receipts r WHERE r.job_key=j.key)
 AND NOT EXISTS(SELECT 1 FROM character_production.qa_targets t WHERE t.job_key=j.key AND
 (t.enabled IS DISTINCT FROM true OR t.digest IS DISTINCT FROM b.digest OR t.promo_id IS DISTINCT FROM b.promo_id OR t.expected_updated_at IS DISTINCT FROM b.expected_updated_at))
 ORDER BY j.created_at,j.key LIMIT greatest(0,least(coalesce(p_limit,0),5)) x
$$;
REVOKE ALL ON FUNCTION public.character_production_qa_materialize(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_qa_ready_slots(integer) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','character_production_generator','character_production_output_broker'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON character_production.qa_slot_bindings FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION character_production.qa_binding_guard() FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_qa_materialize(text,text) FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_qa_ready_slots(integer) FROM %I',r);
 END IF; END LOOP;
END $$;
COMMIT;
