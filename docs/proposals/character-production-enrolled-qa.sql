-- OFFLINE ONLY. Exact existing qa_ready_slots predicates plus enrollment join before limit.
BEGIN;
CREATE FUNCTION public.character_production_scheduler_qa_ready(p_enrollment uuid,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e character_production.scheduler_enrollments; result jsonb;
BEGIN
 e:=character_production.scheduler_current(p_enrollment);
 IF e.id IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>5 THEN RETURN NULL; END IF;
 SELECT coalesce(jsonb_agg(x.identity ORDER BY x.created_at,x.key),'[]'::jsonb) INTO result FROM (
 SELECT jsonb_build_object('key',j.key,'digest',j.digest) identity,j.created_at,j.key
 FROM character_production.jobs j
 JOIN character_production.scheduler_candidates c ON c.enrollment_id=e.id AND c.slot=j.slot AND c.digest=j.digest AND c.slot->>'key'=j.key
 JOIN character_production.approved_slots a ON a.key=j.key AND a.digest=j.digest AND a.slot=j.slot AND a.enabled=true
 JOIN character_production.qa_slot_bindings b ON b.slot_key=j.key AND b.digest=j.digest AND b.slot=j.slot AND b.enabled=true AND b.promo_id=c.draft_id
 JOIN public.cs_character_promo_drafts d ON d.id=b.promo_id
 WHERE j.state='pending_qa' AND public.character_production_qa_draft_unplanned(b.promo_id) AND d.updated_at=b.expected_updated_at
 AND d.character_id=j.slot->>'characterId' AND d.spoken_script=j.slot->>'script'
 AND j.slot->>'characterId' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$' AND length(btrim(j.slot->>'script'))>0
 AND d.status IN ('draft','revision_requested') AND d.video_asset_path IS NULL AND d.audio_asset_path IS NULL
 AND d.voice_approved_at IS NULL AND d.video_qa_approved_at IS NULL AND d.publication_approved_at IS NULL
 AND j.sha ~ '^[a-f0-9]{64}$' AND j.bytes BETWEEN 16 AND 36700160
 AND j.bucket='character-production-private' AND j.object_path=j.digest||'/'||j.sha||'.mp4'
 AND NOT EXISTS(SELECT 1 FROM character_production.qa_ingestion_receipts r WHERE r.job_key=j.key)
 AND NOT EXISTS(SELECT 1 FROM character_production.qa_targets t WHERE t.job_key=j.key AND
 (t.enabled IS DISTINCT FROM true OR t.digest IS DISTINCT FROM b.digest OR t.promo_id IS DISTINCT FROM b.promo_id OR t.expected_updated_at IS DISTINCT FROM b.expected_updated_at))
 ORDER BY j.created_at,j.key LIMIT p_limit) x;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.character_production_scheduler_qa_ready(uuid,integer) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','character_production_generator','character_production_output_broker'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_scheduler_qa_ready(uuid,integer) FROM %I',r); END IF;
 END LOOP;
END $$;
COMMIT;

