-- OFFLINE PROPOSAL: no migration runner, approval writer, grants, or activation.
-- Apply under a reviewed dedicated owner. Empty approvals are deliberately inert.
BEGIN;
CREATE SCHEMA cafe_metricool_private;
REVOKE ALL ON SCHEMA cafe_metricool_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE cafe_metricool_private.approvals(
 plan_id uuid PRIMARY KEY REFERENCES public.cs_character_promo_delivery_plans(id),
 snapshot jsonb NOT NULL, digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 destination_time_key text NOT NULL CHECK(destination_time_key ~ '^[a-f0-9]{64}$'),
 media_destination_key text NOT NULL CHECK(media_destination_key ~ '^[a-f0-9]{64}$'),
 source_state jsonb NOT NULL, approved_by uuid NOT NULL REFERENCES auth.users(id),
 approved_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE cafe_metricool_private.attempts(
 plan_id uuid PRIMARY KEY REFERENCES cafe_metricool_private.approvals(plan_id),
 digest text NOT NULL, destination_time_key text NOT NULL UNIQUE, media_destination_key text NOT NULL UNIQUE,
 token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 state text NOT NULL DEFAULT 'submitting' CHECK(state IN('submitting','submission_unknown','scheduled')),
 provider_id text, provider_uuid text, receipt jsonb,
 claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((provider_id IS NULL)=(provider_uuid IS NULL)),
 CHECK((state='scheduled')=(receipt IS NOT NULL))
);
CREATE TABLE cafe_metricool_private.external_receipts(
 provider_id text NOT NULL, brand_id text NOT NULL, network text NOT NULL, account_id text NOT NULL,
 video_sha256 text NOT NULL CHECK(video_sha256 ~ '^[a-f0-9]{64}$'), scheduled_at timestamptz NOT NULL,
 evidence jsonb NOT NULL, PRIMARY KEY(provider_id,brand_id,network,account_id,video_sha256)
);
-- Negative-only frozen observed receipts. Never app approval or invented attempts.
INSERT INTO cafe_metricool_private.external_receipts SELECT r->>'providerId',r->>'brandId',r->>'network',r->>'accountId',r->>'videoSha256',(r->>'scheduledAt')::timestamptz,r FROM jsonb_array_elements($receipts$[{"provider":"metricool","providerId":"428247704","promoId":"ead1bf18-b531-4070-b74a-d01953c907cf","videoSha256":"5907971bbcfa87654aeb6c0be53acf3e1546f2f8e64e95be3fb97e0f54afe43f","brandId":"7605217","network":"facebook","accountId":"105363501666032","scheduledAt":"2026-11-14T18:00:00-06:00","observedAt":"2026-11-14T18:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428247704","promoId":"ead1bf18-b531-4070-b74a-d01953c907cf","videoSha256":"5907971bbcfa87654aeb6c0be53acf3e1546f2f8e64e95be3fb97e0f54afe43f","brandId":"7605217","network":"instagram","accountId":"cafesativainc","scheduledAt":"2026-11-14T18:00:00-06:00","observedAt":"2026-11-14T18:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428188100","promoId":"573fb8db-a215-491f-8efc-0f48153f2d85","videoSha256":"7e5ecebd41c4ed492d3b16597ac82014078cb5c74f271bb91dac7caa7a5ad1c7","brandId":"7605217","network":"facebook","accountId":"105363501666032","scheduledAt":"2026-11-14T11:33:00-06:00","observedAt":"2026-11-14T17:41:25Z","state":"published"},{"provider":"metricool","providerId":"428188100","promoId":"573fb8db-a215-491f-8efc-0f48153f2d85","videoSha256":"7e5ecebd41c4ed492d3b16597ac82014078cb5c74f271bb91dac7caa7a5ad1c7","brandId":"7605217","network":"instagram","accountId":"cafesativainc","scheduledAt":"2026-11-14T11:33:00-06:00","observedAt":"2026-11-14T17:41:25Z","state":"published"},{"provider":"metricool","providerId":"428083317","promoId":"573fb8db-a215-491f-8efc-0f48153f2d85","videoSha256":"ed8153e2ddd80b3099823eec24c22327cccad3eabdc4c0a039d4425b5f3a52e7","brandId":"7605217","network":"facebook","accountId":"105363501666032","scheduledAt":"2026-11-14T10:00:00-06:00","observedAt":"2026-11-14T14:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428083317","promoId":"573fb8db-a215-491f-8efc-0f48153f2d85","videoSha256":"ed8153e2ddd80b3099823eec24c22327cccad3eabdc4c0a039d4425b5f3a52e7","brandId":"7605217","network":"instagram","accountId":"cafesativainc","scheduledAt":"2026-11-14T10:00:00-06:00","observedAt":"2026-11-14T14:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428083553","promoId":"ead1bf18-b531-4070-b74a-d01953c907cf","videoSha256":"a20bd6a7f813370991031840a105a6b3bbac66d28dddbe13dd6dedf920a4903d","brandId":"7605217","network":"facebook","accountId":"105363501666032","scheduledAt":"2026-11-14T18:00:00-06:00","observedAt":"2026-11-14T14:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428083553","promoId":"ead1bf18-b531-4070-b74a-d01953c907cf","videoSha256":"a20bd6a7f813370991031840a105a6b3bbac66d28dddbe13dd6dedf920a4903d","brandId":"7605217","network":"instagram","accountId":"cafesativainc","scheduledAt":"2026-11-14T18:00:00-06:00","observedAt":"2026-11-14T14:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428101396","promoId":"90d5f842-69cc-4a43-ab6f-20e6eee89cf7","videoSha256":"12017725d1bff3f6c643b4715623de9ca510a05d3ea6952b55d480cf805223d8","brandId":"7605217","network":"facebook","accountId":"105363501666032","scheduledAt":"2026-11-15T10:00:00-06:00","observedAt":"2026-11-14T14:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428101396","promoId":"90d5f842-69cc-4a43-ab6f-20e6eee89cf7","videoSha256":"12017725d1bff3f6c643b4715623de9ca510a05d3ea6952b55d480cf805223d8","brandId":"7605217","network":"instagram","accountId":"cafesativainc","scheduledAt":"2026-11-15T10:00:00-06:00","observedAt":"2026-11-14T14:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428083932","promoId":"4c146dda-4e1c-400f-8371-b49c4dc2eed0","videoSha256":"dceb02ae5576a193a6115bce68c60a5a3328bf3ad9d24978517422eda352b17f","brandId":"7605217","network":"facebook","accountId":"105363501666032","scheduledAt":"2026-11-15T18:00:00-06:00","observedAt":"2026-11-14T14:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428083932","promoId":"4c146dda-4e1c-400f-8371-b49c4dc2eed0","videoSha256":"dceb02ae5576a193a6115bce68c60a5a3328bf3ad9d24978517422eda352b17f","brandId":"7605217","network":"instagram","accountId":"cafesativainc","scheduledAt":"2026-11-15T18:00:00-06:00","observedAt":"2026-11-14T14:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428084028","promoId":"3f85873d-7c7b-48c4-8225-fdf9542d486a","videoSha256":"f502a02a99948121d455aacb883a2eadc83c0306cb0d8d6627fa0d1c48c5fc45","brandId":"7605217","network":"facebook","accountId":"105363501666032","scheduledAt":"2026-11-16T10:00:00-06:00","observedAt":"2026-11-14T14:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428084028","promoId":"3f85873d-7c7b-48c4-8225-fdf9542d486a","videoSha256":"f502a02a99948121d455aacb883a2eadc83c0306cb0d8d6627fa0d1c48c5fc45","brandId":"7605217","network":"instagram","accountId":"cafesativainc","scheduledAt":"2026-11-16T10:00:00-06:00","observedAt":"2026-11-14T14:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428098477","promoId":"770796d6-912c-4670-8434-6a2c387637f1","videoSha256":"b5ed41d82394581fd71e394ba50f4cb2ad81229adfaa1950c945fc2b5e4181f5","brandId":"7605217","network":"facebook","accountId":"105363501666032","scheduledAt":"2026-11-16T18:00:00-06:00","observedAt":"2026-11-14T14:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428098477","promoId":"770796d6-912c-4670-8434-6a2c387637f1","videoSha256":"b5ed41d82394581fd71e394ba50f4cb2ad81229adfaa1950c945fc2b5e4181f5","brandId":"7605217","network":"instagram","accountId":"cafesativainc","scheduledAt":"2026-11-16T18:00:00-06:00","observedAt":"2026-11-14T14:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428099102","promoId":"bfa9cb67-0ff9-4de7-89d9-58536497860a","videoSha256":"620032ee4a6b3684e891c2c85dad5c3458576b7e3503222879cd603c8f98f6b8","brandId":"7605217","network":"facebook","accountId":"105363501666032","scheduledAt":"2026-11-17T10:00:00-06:00","observedAt":"2026-11-14T14:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428099102","promoId":"bfa9cb67-0ff9-4de7-89d9-58536497860a","videoSha256":"620032ee4a6b3684e891c2c85dad5c3458576b7e3503222879cd603c8f98f6b8","brandId":"7605217","network":"instagram","accountId":"cafesativainc","scheduledAt":"2026-11-17T10:00:00-06:00","observedAt":"2026-11-14T14:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428099509","promoId":"9daefd19-9c00-4234-b98d-93c566afb714","videoSha256":"a7d997e0c4b536a447bbc85136aba935375cbe4702e842db8356f56c8a820ada","brandId":"7605217","network":"facebook","accountId":"105363501666032","scheduledAt":"2026-11-17T18:00:00-06:00","observedAt":"2026-11-14T14:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428099509","promoId":"9daefd19-9c00-4234-b98d-93c566afb714","videoSha256":"a7d997e0c4b536a447bbc85136aba935375cbe4702e842db8356f56c8a820ada","brandId":"7605217","network":"instagram","accountId":"cafesativainc","scheduledAt":"2026-11-17T18:00:00-06:00","observedAt":"2026-11-14T14:35:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428080195","promoId":"5094636c-be48-4ac3-ae7b-80acfb729c13","videoSha256":"dc3317c20da4378aa290e7c4dc40ceac617a0267bc11db0444b153399edfb951","brandId":"7605217","network":"facebook","accountId":"105363501666032","scheduledAt":"2026-11-18T10:00:00-06:00","observedAt":"2026-11-14T15:13:00Z","state":"scheduled"},{"provider":"metricool","providerId":"428080195","promoId":"5094636c-be48-4ac3-ae7b-80acfb729c13","videoSha256":"dc3317c20da4378aa290e7c4dc40ceac617a0267bc11db0444b153399edfb951","brandId":"7605217","network":"instagram","accountId":"cafesativainc","scheduledAt":"2026-11-18T10:00:00-06:00","observedAt":"2026-11-14T15:13:00Z","state":"scheduled"}]$receipts$::jsonb) r;
REVOKE ALL ON ALL TABLES IN SCHEMA cafe_metricool_private FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION cafe_metricool_private.source_state(p uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('draft',to_jsonb(d),'plan',to_jsonb(x),'qa',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.cs_character_promo_qa_checks q WHERE q.promo_id=d.id),'[]'::jsonb))
 FROM public.cs_character_promo_delivery_plans x JOIN public.cs_character_promo_drafts d ON d.id=x.promo_id WHERE x.id=p
$$;
-- Coexists with legacy guard: all mutations/claim use the same parent draft lock.
CREATE FUNCTION cafe_metricool_private.guard_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE promo uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required'; END IF;
 IF TG_TABLE_NAME='cs_character_promo_drafts' THEN promo:=OLD.id;
 ELSE
  IF TG_OP='UPDATE' AND NEW.promo_id IS DISTINCT FROM OLD.promo_id THEN RAISE EXCEPTION 'Promo ownership immutable'; END IF;
  IF TG_OP='DELETE' THEN promo:=OLD.promo_id; ELSE promo:=NEW.promo_id; END IF;
 END IF;
 PERFORM 1 FROM public.cs_character_promo_drafts WHERE id=promo FOR UPDATE;
 IF EXISTS(SELECT 1 FROM cafe_metricool_private.attempts a JOIN public.cs_character_promo_delivery_plans p ON p.id=a.plan_id WHERE p.promo_id=promo) THEN RAISE EXCEPTION 'Café claimed source frozen; reconcile manually'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER cafe_metricool_draft_guard BEFORE UPDATE OR DELETE ON public.cs_character_promo_drafts FOR EACH ROW EXECUTE FUNCTION cafe_metricool_private.guard_source();
CREATE TRIGGER cafe_metricool_plan_guard BEFORE INSERT OR UPDATE OR DELETE ON public.cs_character_promo_delivery_plans FOR EACH ROW EXECUTE FUNCTION cafe_metricool_private.guard_source();
CREATE TRIGGER cafe_metricool_qa_guard BEFORE INSERT OR UPDATE OR DELETE ON public.cs_character_promo_qa_checks FOR EACH ROW EXECUTE FUNCTION cafe_metricool_private.guard_source();
CREATE FUNCTION cafe_metricool_private.authorized(p uuid, p_digest text) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE a cafe_metricool_private.approvals; s jsonb; d public.cs_character_promo_drafts; x public.cs_character_promo_delivery_plans;
BEGIN
 SELECT * INTO a FROM cafe_metricool_private.approvals WHERE plan_id=p;
 SELECT * INTO x FROM public.cs_character_promo_delivery_plans WHERE id=p;
 SELECT * INTO d FROM public.cs_character_promo_drafts WHERE id=x.promo_id;
 s:=a.snapshot;
 IF NOT coalesce(NOT a.revoked AND a.digest=p_digest AND a.approved_at<=clock_timestamp() AND a.expires_at>clock_timestamp()
 AND EXISTS(SELECT 1 FROM auth.users WHERE id=a.approved_by AND raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb)
 AND a.source_state=cafe_metricool_private.source_state(p)
 AND s->>'planId'=p::text AND s->>'promoId'=d.id::text AND s->>'characterId'=d.character_id AND x.character_id=d.character_id
 AND NOT EXISTS(SELECT 1 FROM cafe_metricool_private.external_receipts e WHERE e.brand_id=s->>'brandId' AND e.network=s->>'network' AND e.account_id=s->>'accountId' AND (e.video_sha256=s->>'videoSha256' OR e.scheduled_at=(s->>'scheduledAt')::timestamptz))
 AND s->>'brandId'='7605217' AND s->>'userId'='4174093' AND s->>'timezone'='America/Chicago'
 AND s->>'network'=x.network AND s->>'accountId'=x.account_id
 AND ((x.network='facebook' AND x.account_id='105363501666032') OR (x.network='instagram' AND x.account_id='cafesativainc'))
 AND d.actual_social_account='metricool-brand:7605217' AND d.status='script_approved' AND x.status='ready_for_delivery'
 AND s->>'videoPath'=d.video_asset_path AND s->>'videoSha256' ~ '^[a-f0-9]{64}$'
 AND d.video_asset_path='character-promos/'||d.character_id||'/'||d.id::text||'/'||(s->>'videoSha256')||'.mp4'
 AND s->>'videoSha256' NOT IN ('a20bd6a7f813370991031840a105a6b3bbac66d28dddbe13dd6dedf920a4903d','ed8153e2ddd80b3099823eec24c22327cccad3eabdc4c0a039d4425b5f3a52e7','70f2ad3fe14420e472908850576b3240bbad2a3e6d121ae2f89a7da77148f4e0')
 AND s->>'contentApprovalDigest' ~ '^[a-f0-9]{64}$' AND s->>'caption'=x.caption
 AND (s->>'scheduledAt')::timestamptz=x.scheduled_at AND x.scheduled_at>clock_timestamp()+interval '60 seconds'
 AND d.voice_approved_at IS NOT NULL AND d.video_qa_approved_at IS NOT NULL AND d.publication_approved_at IS NOT NULL
 AND greatest(d.voice_approved_at,d.video_qa_approved_at,d.publication_approved_at)<=a.approved_at,false) THEN RETURN false; END IF;
 -- Exactly one passing, attributed evidence row for each current-video check.
 RETURN NOT EXISTS(SELECT 1 FROM unnest(ARRAY['mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety','third_party_watermark']) expected(name)
 WHERE (SELECT count(*) FROM public.cs_character_promo_qa_checks q WHERE q.promo_id=d.id AND q.video_sha256=s->>'videoSha256' AND q.check_name=expected.name)<>1
 OR NOT EXISTS(SELECT 1 FROM public.cs_character_promo_qa_checks q WHERE q.promo_id=d.id AND q.video_sha256=s->>'videoSha256' AND q.check_name=expected.name AND q.result='pass' AND q.reviewer_id IS NOT NULL AND length(btrim(q.evidence))>0 AND q.created_at<=a.approved_at));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION public.cs_preflight_cafe_metricool(p_plan uuid,p_digest text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT cafe_metricool_private.authorized(p_plan,p_digest)
$$;
CREATE FUNCTION public.cs_claim_cafe_metricool(p_plan uuid,p_digest text,p_destination text,p_media text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t uuid; promo uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN NULL; END IF;
 SELECT promo_id INTO promo FROM public.cs_character_promo_delivery_plans WHERE id=p_plan;
 PERFORM 1 FROM public.cs_character_promo_drafts WHERE id=promo FOR UPDATE;
 PERFORM 1 FROM cafe_metricool_private.approvals WHERE plan_id=p_plan FOR UPDATE;
 IF NOT cafe_metricool_private.authorized(p_plan,p_digest) OR NOT EXISTS(SELECT 1 FROM cafe_metricool_private.approvals WHERE plan_id=p_plan AND destination_time_key=p_destination AND media_destination_key=p_media) THEN RETURN NULL; END IF;
 INSERT INTO cafe_metricool_private.attempts(plan_id,digest,destination_time_key,media_destination_key) VALUES(p_plan,p_digest,p_destination,p_media) ON CONFLICT DO NOTHING RETURNING token INTO t;
 RETURN t;
END $$;
CREATE FUNCTION public.cs_identity_cafe_metricool(p_plan uuid,p_token uuid,p_id text,p_uuid text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_id IS NULL OR p_uuid IS NULL OR length(p_id) NOT BETWEEN 1 AND 256 OR length(p_uuid) NOT BETWEEN 1 AND 256 THEN RETURN false; END IF;
 UPDATE cafe_metricool_private.attempts SET provider_id=p_id,provider_uuid=p_uuid WHERE plan_id=p_plan AND token=p_token AND state IN('submitting','submission_unknown') AND (provider_id IS NULL OR (provider_id=p_id AND provider_uuid=p_uuid));
 RETURN FOUND;
END $$;
CREATE FUNCTION public.cs_finish_cafe_metricool(p_plan uuid,p_token uuid,p_state text,p_receipt jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a cafe_metricool_private.attempts; s jsonb; expected jsonb;
BEGIN
 SELECT * INTO a FROM cafe_metricool_private.attempts WHERE plan_id=p_plan AND token=p_token FOR UPDATE;
 IF a.plan_id IS NULL THEN RETURN false; END IF;
 IF p_state='submission_unknown' AND p_receipt IS NULL THEN
  IF a.state='scheduled' THEN RETURN false; END IF;
  UPDATE cafe_metricool_private.attempts SET state='submission_unknown' WHERE plan_id=p_plan; RETURN true;
 END IF;
 IF p_state IS DISTINCT FROM 'scheduled' OR p_receipt IS NULL OR a.provider_id IS NULL THEN RETURN false; END IF;
 SELECT snapshot INTO s FROM cafe_metricool_private.approvals WHERE plan_id=p_plan;
 expected:=jsonb_build_object('providerId',a.provider_id,'providerUuid',a.provider_uuid,'digest',a.digest,'brandId',s->>'brandId','network',s->>'network','accountId',s->>'accountId','scheduledAt',s->>'scheduledAt','state','scheduled','publicationConfirmed',false,'collaborators',coalesce((SELECT jsonb_agg(jsonb_build_object('handle',c->>'handle','state','invitation_requested','acceptanceConfirmed',false) ORDER BY n) FROM jsonb_array_elements(s->'collaborators') WITH ORDINALITY z(c,n)),'[]'::jsonb));
 IF p_receipt IS DISTINCT FROM expected THEN RETURN false; END IF;
 IF a.state='scheduled' THEN RETURN a.receipt=p_receipt; END IF;
 -- Unknown outcomes are not automatically upgraded/retried; separate recovery review required.
 IF a.state<>'submitting' THEN RETURN false; END IF;
 UPDATE cafe_metricool_private.attempts SET state='scheduled',receipt=p_receipt WHERE plan_id=p_plan; RETURN true;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cafe_metricool_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cs_preflight_cafe_metricool(uuid,text),public.cs_claim_cafe_metricool(uuid,text,text,text),public.cs_identity_cafe_metricool(uuid,uuid,text,text),public.cs_finish_cafe_metricool(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
-- Deliberately no role grants. Requires reviewed runtime wiring and authority writer.
COMMIT;
