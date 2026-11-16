-- Source-only selector. No installation, grants, policy rows or activation.
BEGIN;
DO $$ BEGIN IF current_user<>'cafe_metricool_owner' THEN RAISE EXCEPTION 'Restricted publication owner required'; END IF; END $$;
CREATE FUNCTION public.cs_cafe_publication_next() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE x record; d public.cs_character_promo_drafts; sc cafe_metricool_private.publication_scopes; g jsonb; pid uuid; at timestamptz:=clock_timestamp();
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN NULL; END IF;
 -- Original scheduled attempts get read-only collection priority, even after
 -- authority expires. Only positive original receipts permit successor work.
 -- Deliberate fail-closed serial lane: a terminal provider failure or absent
 -- observation remains reconciliation-held until separately reviewed recovery.
 -- Do not silently skip an original, mark failure successful, or unlock replay.
 SELECT a.plan_id INTO pid FROM cafe_metricool_private.attempts a
 JOIN public.cs_character_promo_delivery_plans p ON p.id=a.plan_id
 WHERE a.state='scheduled' AND p.scheduled_at<=at
 AND public.cs_cafe_publication_attempt(a.plan_id) IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM cafe_metricool_private.publication_receipts r WHERE r.plan_id=a.plan_id)
 ORDER BY p.scheduled_at,a.plan_id LIMIT 1;
 IF pid IS NOT NULL THEN RETURN jsonb_build_object('phase','reconcile','planId',pid); END IF;
 IF EXISTS(SELECT 1 FROM cafe_metricool_private.attempts WHERE state IN('submitting','submission_unknown')) THEN
  RETURN jsonb_build_object('phase','held','reason','original_submission_unknown');
 END IF;
 SELECT s.* INTO sc FROM cafe_metricool_private.publication_scopes s JOIN cafe_metricool_private.publication_binding b ON b.scope_id=s.id
 WHERE b.name='cafe-routine-publication' AND b.enabled AND s.enabled;
 IF sc.id IS NULL OR public.cs_cafe_metricool_is_admin(sc.actor_id) IS DISTINCT FROM true
 OR NOT coalesce((sc.policy->>'authorizedAt')::timestamptz<=at AND (sc.policy->>'validUntil')::timestamptz>at,false)
 OR sc.policy->'revoked' IS DISTINCT FROM 'false'::jsonb THEN RETURN NULL; END IF;
 FOR d IN SELECT * FROM public.cs_character_promo_drafts WHERE actual_social_account='metricool-brand:7605217' ORDER BY id LOOP
  g:=public.cs_cafe_generation_membership(d.id);
  IF g IS NULL OR g->>'enrollmentId' IS DISTINCT FROM sc.enrollment_id::text OR g->>'manifestSha256' IS DISTINCT FROM sc.manifest_sha256 OR g->>'actorId' IS DISTINCT FROM sc.actor_id::text THEN CONTINUE; END IF;
  -- Immutable existing pair: use exact original IDs, never derive from caption.
  FOR x IN SELECT p.id FROM cafe_metricool_private.initial_editorial e
   JOIN public.cs_character_promo_delivery_plans p ON p.id IN(e.facebook_plan,e.instagram_plan)
   WHERE e.promo_id=d.id AND NOT EXISTS(SELECT 1 FROM cafe_metricool_private.attempts a WHERE a.plan_id=p.id)
   ORDER BY p.network LOOP
   IF cafe_metricool_private.publication_current(x.id,sc.id) IS NOT NULL
    AND EXISTS(SELECT 1 FROM cafe_metricool_private.approvals a JOIN cafe_metricool_private.publication_authorities pa ON pa.plan_id=a.plan_id
      WHERE a.plan_id=x.id AND NOT a.revoked AND a.expires_at>at AND pa.scope_id=sc.id AND pa.schedule_digest=a.digest) THEN
    RETURN jsonb_build_object('phase','dispatch','planId',x.id);
   END IF;
  END LOOP;
  IF d.status IS DISTINCT FROM 'script_approved' OR d.voice_approved_at IS NULL OR d.video_qa_approved_at IS NULL
   OR d.publication_approved_at IS NULL OR d.publication_approved_at>at
   OR d.voice_approved_at>at OR d.video_qa_approved_at>at OR substring(d.video_asset_path FROM '([a-f0-9]{64})[.]mp4$') IS NULL THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM public.cs_character_promo_qa_checks q WHERE q.promo_id=d.id AND q.video_sha256=substring(d.video_asset_path FROM '([a-f0-9]{64})[.]mp4$') AND q.result IS DISTINCT FROM 'pass')
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety','third_party_watermark']) n
    WHERE NOT EXISTS(SELECT 1 FROM public.cs_character_promo_qa_checks q WHERE q.promo_id=d.id AND q.check_name=n AND q.result='pass' AND q.video_sha256=substring(d.video_asset_path FROM '([a-f0-9]{64})[.]mp4$') AND q.created_at<=at)) THEN CONTINUE; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.cs_character_promo_delivery_plans p WHERE p.promo_id=d.id) THEN
   RETURN jsonb_build_object('phase','authority','draftId',d.id);
  END IF;
  IF EXISTS(SELECT 1 FROM cafe_metricool_private.initial_editorial e
    JOIN public.cs_character_promo_delivery_plans p ON p.id IN(e.facebook_plan,e.instagram_plan)
    WHERE e.promo_id=d.id AND NOT EXISTS(SELECT 1 FROM cafe_metricool_private.attempts a WHERE a.plan_id=p.id)
    AND NOT EXISTS(SELECT 1 FROM cafe_metricool_private.approvals a WHERE a.plan_id=p.id)) THEN
   RETURN jsonb_build_object('phase','authority','draftId',d.id);
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.cs_cafe_publication_next() FROM PUBLIC,anon,authenticated,service_role;
ROLLBACK;
