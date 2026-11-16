-- OFFLINE SOURCE ONLY. No installer, runtime grants, rows or activation.
-- Requires reviewed binding snapshots, saved text, standing publication and targets.
-- Future installation needs narrow cross-owner EXECUTE and plan-column INSERT;
-- those material capabilities are NOT granted here.
BEGIN;
SET LOCAL ROLE character_production_owner;
CREATE FUNCTION public.character_production_draft_editorial(p_draft uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r character_production.planning_records; b character_production.binding_snapshots;
 a character_production.text_replenishment_attempts; s jsonb; g jsonb;
BEGIN
 g:=public.cs_cafe_generation_membership(p_draft);
 IF g IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO r FROM character_production.planning_records WHERE promo_id=p_draft AND digest=g->>'slotDigest';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO b FROM character_production.binding_snapshots WHERE slot_key=r.slot_key AND slot_digest=r.digest;
 IF NOT FOUND OR r.plan#>>'{validation,evidenceRef}' IS DISTINCT FROM 'binding-snapshot-sha256:'||b.snapshot_sha256 OR b.snapshot_sha256 IS DISTINCT FROM encode(sha256(convert_to(b.snapshot_text,'UTF8')),'hex') THEN RETURN NULL; END IF;
 s:=b.snapshot_text::jsonb;
 SELECT * INTO a FROM character_production.text_replenishment_attempts WHERE key=s#>>'{speech,textAttemptKey}' AND token::text=s#>>'{speech,textAttemptToken}' AND source_digest=s#>>'{speech,textSourceDigest}' AND state='awaiting_audio_binding_and_qa';
 IF NOT FOUND OR a.output->>'spokenScript' IS DISTINCT FROM r.slot->>'script'
 OR s#>>'{image,audio,scriptSha256}' IS DISTINCT FROM encode(sha256(convert_to(a.output->>'spokenScript','UTF8')),'hex')
 OR a.source_snapshot->>'characterId' IS DISTINCT FROM r.slot->>'characterId'
 OR a.source_snapshot->>'canonicalRevision' IS DISTINCT FROM r.slot->>'canonicalRevision'
 OR a.source_snapshot->>'voiceId' IS DISTINCT FROM r.slot->>'voiceId'
 OR a.source_snapshot->>'portraitSha256' IS DISTINCT FROM r.slot->>'portraitSha256'
 OR NOT coalesce(length(btrim(a.provider_id)) BETWEEN 1 AND 200 AND a.input_tokens>=1 AND a.output_tokens BETWEEN 1 AND 1024,false) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('draftId',p_draft,'slotDigest',r.digest,'snapshotSha256',b.snapshot_sha256,'textKey',a.key,'textToken',a.token,'textDigest',a.source_digest,'editorial',a.output,'characterId',a.source_snapshot->>'characterId','roomKey',a.source_snapshot->>'roomKey','verifiedHandles',a.source_snapshot->'verifiedHandles');
END $$;
REVOKE ALL ON FUNCTION public.character_production_draft_editorial(uuid) FROM PUBLIC;
DO $$ DECLARE r record; BEGIN
 SELECT proowner,proacl INTO r FROM pg_proc WHERE oid='public.character_production_draft_editorial(uuid)'::regprocedure;
 IF r.proowner<>'character_production_owner'::regrole OR EXISTS(SELECT 1 FROM aclexplode(r.proacl) WHERE grantee<>r.proowner) THEN RAISE EXCEPTION 'Owner-only editorial bridge required'; END IF;
END $$;
SET LOCAL ROLE cafe_metricool_owner;
CREATE TABLE cafe_metricool_private.initial_editorial(
 promo_id uuid PRIMARY KEY REFERENCES public.cs_character_promo_drafts(id),
 evidence jsonb NOT NULL, facebook_plan uuid NOT NULL UNIQUE REFERENCES public.cs_character_promo_delivery_plans(id),
 instagram_plan uuid NOT NULL UNIQUE REFERENCES public.cs_character_promo_delivery_plans(id)
);
ALTER TABLE cafe_metricool_private.initial_editorial ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cafe_metricool_private.initial_editorial FROM PUBLIC;
CREATE TRIGGER initial_editorial_immutable BEFORE UPDATE OR DELETE ON cafe_metricool_private.initial_editorial FOR EACH ROW EXECUTE FUNCTION cafe_metricool_private.publication_immutable();
-- No caller policy, owner, captions, media or schedule. The exact existing QA
-- and standing-policy resolver remains the authority for target creation.
CREATE FUNCTION public.cs_prepare_cafe_delivery_plans(p_draft uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.cs_character_promo_drafts; e jsonb; x jsonb; target timestamptz;
 prior cafe_metricool_private.initial_editorial; f uuid:=gen_random_uuid(); i uuid:=gen_random_uuid();
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN NULL; END IF;
 SELECT * INTO d FROM public.cs_character_promo_drafts WHERE id=p_draft FOR UPDATE;
 IF NOT FOUND OR d.actual_social_account IS DISTINCT FROM 'metricool-brand:7605217' THEN RETURN NULL; END IF;
 e:=public.character_production_draft_editorial(d.id); x:=e->'editorial';
 IF e IS NULL OR jsonb_typeof(x) IS DISTINCT FROM 'object'
 OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(x) k) IS DISTINCT FROM ARRAY['caption','collaborators','facebookTitle','hashtags','spokenScript','title','visualBrief']::text[]
 OR x->>'spokenScript' IS DISTINCT FROM d.spoken_script
 OR jsonb_typeof(x->'spokenScript') IS DISTINCT FROM 'string' OR length(btrim(x->>'spokenScript')) NOT BETWEEN 1 AND 600
 OR jsonb_typeof(x->'title') IS DISTINCT FROM 'string' OR length(btrim(x->>'title')) NOT BETWEEN 1 AND 100
 OR jsonb_typeof(x->'visualBrief') IS DISTINCT FROM 'string' OR length(btrim(x->>'visualBrief')) NOT BETWEEN 1 AND 1000
 OR jsonb_typeof(x->'caption') IS DISTINCT FROM 'string' OR length(btrim(x->>'caption')) NOT BETWEEN 1 AND 1800
 OR jsonb_typeof(x->'facebookTitle') IS DISTINCT FROM 'string' OR length(btrim(x->>'facebookTitle')) NOT BETWEEN 1 AND 100
 OR jsonb_typeof(x->'hashtags') IS DISTINCT FROM 'array' OR jsonb_typeof(x->'collaborators') IS DISTINCT FROM 'array'
 OR jsonb_typeof(e->'verifiedHandles') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
 IF jsonb_array_length(x->'hashtags')>5 OR jsonb_array_length(x->'collaborators')>3
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(x->'hashtags') h WHERE jsonb_typeof(h)<>'string' OR NOT coalesce(h#>>'{}' ~ '^[[:alnum:]_]{1,40}$',false))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(x->'collaborators') h WHERE jsonb_typeof(h)<>'string' OR NOT(e->'verifiedHandles' @> jsonb_build_array(h))) THEN RETURN NULL; END IF;
 -- Atomicity: target and both plans commit together or not at all.
 target:=public.cs_resolve_cafe_publication_target(d.id);
 IF target IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO prior FROM cafe_metricool_private.initial_editorial WHERE promo_id=d.id;
 IF FOUND THEN
  IF prior.evidence IS DISTINCT FROM e OR (SELECT count(*) FROM public.cs_character_promo_delivery_plans WHERE promo_id=d.id)<>2
  OR NOT EXISTS(SELECT 1 FROM public.cs_character_promo_delivery_plans WHERE id=prior.facebook_plan AND promo_id=d.id AND character_id=d.character_id AND network='facebook' AND account_id='105363501666032' AND scheduled_at=target AND caption=x->>'caption')
  OR NOT EXISTS(SELECT 1 FROM public.cs_character_promo_delivery_plans WHERE id=prior.instagram_plan AND promo_id=d.id AND character_id=d.character_id AND network='instagram' AND account_id='cafesativainc' AND scheduled_at=target AND caption=x->>'caption') THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('draftId',d.id,'facebookPlanId',prior.facebook_plan,'instagramPlanId',prior.instagram_plan,'scheduledAt',target,'created',false);
 END IF;
 IF EXISTS(SELECT 1 FROM public.cs_character_promo_delivery_plans WHERE promo_id=d.id) THEN RETURN NULL; END IF;
 INSERT INTO public.cs_character_promo_delivery_plans(id,promo_id,character_id,network,account_id,scheduled_at,status,caption)
 VALUES(f,d.id,d.character_id,'facebook','105363501666032',target,'ready_for_delivery',x->>'caption'),(i,d.id,d.character_id,'instagram','cafesativainc',target,'ready_for_delivery',x->>'caption');
 INSERT INTO cafe_metricool_private.initial_editorial VALUES(d.id,e,f,i);
 RETURN jsonb_build_object('draftId',d.id,'facebookPlanId',f,'instagramPlanId',i,'scheduledAt',target,'created',true);
END $$;
REVOKE ALL ON FUNCTION public.cs_prepare_cafe_delivery_plans(uuid) FROM PUBLIC;
CREATE FUNCTION public.cs_cafe_initial_editorial(p_plan uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.cs_character_promo_delivery_plans; d public.cs_character_promo_drafts; e cafe_metricool_private.initial_editorial; current_source jsonb;
BEGIN
 SELECT * INTO p FROM public.cs_character_promo_delivery_plans WHERE id=p_plan;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO e FROM cafe_metricool_private.initial_editorial WHERE promo_id=p.promo_id AND ((facebook_plan=p.id AND p.network='facebook' AND p.account_id='105363501666032') OR (instagram_plan=p.id AND p.network='instagram' AND p.account_id='cafesativainc'));
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO d FROM public.cs_character_promo_drafts WHERE id=p.promo_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 current_source:=public.character_production_draft_editorial(p.promo_id);
 IF current_source IS DISTINCT FROM e.evidence OR p.caption IS DISTINCT FROM e.evidence#>>'{editorial,caption}' THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('planId',p.id,'draftId',p.promo_id,'network',p.network,'accountId',p.account_id,'scheduledAt',p.scheduled_at,'evidence',e.evidence,
 'plan',jsonb_build_object('id',p.id,'promo_id',p.promo_id,'character_id',p.character_id,'network',p.network,'account_id',p.account_id,'scheduled_at',p.scheduled_at,'caption',p.caption),
 'draft',jsonb_build_object('id',d.id,'character_id',d.character_id,'spoken_script',d.spoken_script,'title',d.title,'actual_social_account',d.actual_social_account,'video_asset_path',d.video_asset_path));
END $$;
REVOKE ALL ON FUNCTION public.cs_cafe_initial_editorial(uuid) FROM PUBLIC;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT proowner,proacl FROM pg_proc WHERE oid IN('public.cs_prepare_cafe_delivery_plans(uuid)'::regprocedure,'public.cs_cafe_initial_editorial(uuid)'::regprocedure)
 LOOP IF r.proowner<>'cafe_metricool_owner'::regrole OR EXISTS(SELECT 1 FROM aclexplode(r.proacl) WHERE grantee<>r.proowner) THEN RAISE EXCEPTION 'Owner-only first delivery source required'; END IF; END LOOP;
 IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid='cafe_metricool_private.initial_editorial'::regclass AND a.grantee<>c.relowner) THEN RAISE EXCEPTION 'Owner-only editorial source required'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
