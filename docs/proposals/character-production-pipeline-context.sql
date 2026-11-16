-- Source-only current occurrence selector; no grants/configuration/activation.
BEGIN;
DO $$ BEGIN IF current_user<>'character_production_owner' THEN RAISE EXCEPTION 'Restricted production owner required'; END IF; END $$;
CREATE FUNCTION public.character_production_pipeline_context() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p jsonb;r character_production.first_admission_records;g jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN NULL; END IF;
 p:=public.character_production_preparation_context();
 IF p IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO r FROM character_production.first_admission_records WHERE occurrence_id=(p->>'occurrenceId')::uuid;
 IF r.manifest_text IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM character_production.planning_records WHERE promo_id=r.draft_id) THEN
   g:=public.cs_cafe_generation_membership(r.draft_id);
   IF g IS NULL OR g->>'enrollmentId' IS DISTINCT FROM r.enrollment_id::text OR g->>'manifestSha256' IS DISTINCT FROM r.manifest_sha256 THEN
    RETURN jsonb_build_object('phase','held','reason','original_enrollment_not_current');
   END IF;
   RETURN jsonb_build_object('phase','work','occurrenceId',r.occurrence_id,'enrollmentId',r.enrollment_id,'manifestSha256',r.manifest_sha256,'manifest',r.manifest_text);
  END IF;
 END IF;
 IF p->'identity' IS NOT NULL AND p->'identity'<>'null'::jsonb AND p->'speechStarted'='true'::jsonb THEN
  -- This is ONLY an instruction to inspect the original immutable receipt.
  -- Server verifies private audio BEFORE invoking admission/planning.
  RETURN jsonb_build_object('phase','admit','occurrenceId',p->>'occurrenceId','identity',p->'identity');
 END IF;
 RETURN jsonb_build_object('phase','prepare','occurrenceId',p->>'occurrenceId');
END $$;
REVOKE ALL ON FUNCTION public.character_production_pipeline_context() FROM PUBLIC,anon,authenticated,service_role;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.character_production_pipeline_context()'::regprocedure AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'Pipeline context must remain owner-only'; END IF; END $$;
ROLLBACK;
