-- OFFLINE ONLY. Requires reviewed PR101 store + fixed admin helper installation.
-- No grants, rows, dispatch, credential, or legacy v1 changes.
BEGIN;
CREATE TABLE cafe_metricool_private.owner_authority_provenance(
 plan_id uuid PRIMARY KEY REFERENCES cafe_metricool_private.approvals(plan_id),
 reference text NOT NULL CHECK(reference ~ '^[A-Za-z0-9_.:-]{1,200}$'),
 schedule_digest text NOT NULL CHECK(schedule_digest ~ '^[a-f0-9]{64}$'),
 authorized_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL, evidence_record text,
 CHECK(evidence_record IS NULL OR octet_length(evidence_record) BETWEEN 2 AND 32768),
 CHECK(authorized_at<=recorded_at AND expires_at>recorded_at)
);
REVOKE ALL ON TABLE cafe_metricool_private.owner_authority_provenance FROM PUBLIC,anon,authenticated,service_role;
-- Protocol schedules contain only objects/arrays/strings, boolean and integer1.
-- Sorted keys + compact representation match cafeScheduleDigest (no whitespace).
CREATE FUNCTION cafe_metricool_private.canonical_json(v jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE t text;
BEGIN
 CASE jsonb_typeof(v)
 WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||cafe_metricool_private.canonical_json(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO t FROM jsonb_each(v);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(cafe_metricool_private.canonical_json(value),',' ORDER BY n),'')||']' INTO t FROM jsonb_array_elements(v) WITH ORDINALITY a(value,n);
 ELSE t:=v::text;
 END CASE;
 RETURN t;
END $$;
CREATE FUNCTION public.cs_record_cafe_metricool_authority(
 p_plan uuid,p_snapshot jsonb,p_digest text,p_destination text,p_media text,
 p_source jsonb,p_actor uuid,p_approved_at timestamptz,p_expires_at timestamptz,p_authority jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE promo uuid; stamp timestamptz; expected_digest text; destination text; media text; auth_at timestamptz; auth_exp timestamptz; evidence text; parsed jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required'; END IF;
 -- This exact helper is supplied by the separate reviewed store installer.
 IF NOT coalesce(public.cs_cafe_metricool_is_admin(p_actor),false) THEN RAISE EXCEPTION 'Content admin required'; END IF;
 SELECT promo_id INTO promo FROM public.cs_character_promo_delivery_plans WHERE id=p_plan;
 IF promo IS NULL THEN RAISE EXCEPTION 'Unknown plan'; END IF;
 PERFORM 1 FROM public.cs_character_promo_drafts WHERE id=promo FOR UPDATE;
 PERFORM 1 FROM cafe_metricool_private.approvals WHERE plan_id=p_plan FOR UPDATE;
 stamp:=clock_timestamp();
 IF NOT coalesce(public.cs_cafe_metricool_is_admin(p_actor),false)
 OR EXISTS(SELECT 1 FROM cafe_metricool_private.approvals WHERE plan_id=p_plan)
 OR EXISTS(SELECT 1 FROM cafe_metricool_private.attempts a JOIN public.cs_character_promo_delivery_plans x ON x.id=a.plan_id WHERE x.promo_id=promo)
 OR p_source IS DISTINCT FROM cafe_metricool_private.source_state(p_plan) THEN RAISE EXCEPTION 'Changed or already recorded source'; END IF;
 IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR octet_length(p_snapshot::text)>32768 OR jsonb_typeof(p_source) IS DISTINCT FROM 'object' OR octet_length(p_source::text)>262144 OR jsonb_typeof(p_authority) IS DISTINCT FROM 'object' OR octet_length(p_authority::text)>40000 THEN RAISE EXCEPTION 'Invalid bounded snapshot'; END IF;
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_snapshot) key) IS DISTINCT FROM
 (CASE WHEN p_snapshot->>'network'='facebook' THEN ARRAY['accountId','brandId','caption','characterId','collaborators','contentApprovalDigest','facebookTitle','hashtags','network','planId','promoId','scheduledAt','timezone','userId','version','videoPath','videoSha256']::text[]
 ELSE ARRAY['accountId','brandId','caption','characterId','collaborators','contentApprovalDigest','hashtags','network','planId','promoId','scheduledAt','timezone','userId','version','videoPath','videoSha256']::text[] END) THEN RAISE EXCEPTION 'Unexpected schedule fields'; END IF;
 IF p_snapshot->'version' IS DISTINCT FROM '1'::jsonb OR p_snapshot->>'planId' IS DISTINCT FROM p_plan::text OR p_snapshot->>'promoId' IS DISTINCT FROM promo::text THEN RAISE EXCEPTION 'Wrong schedule identity'; END IF;
 expected_digest:=encode(sha256(convert_to(cafe_metricool_private.canonical_json(p_snapshot),'UTF8')),'hex');
 destination:=encode(sha256(convert_to(cafe_metricool_private.canonical_json(jsonb_build_array(p_snapshot->>'brandId',p_snapshot->>'network',p_snapshot->>'accountId',p_snapshot->>'scheduledAt')),'UTF8')),'hex');
 media:=encode(sha256(convert_to(cafe_metricool_private.canonical_json(jsonb_build_array(p_snapshot->>'brandId',p_snapshot->>'network',p_snapshot->>'accountId',p_snapshot->>'videoSha256')),'UTF8')),'hex');
 IF p_digest IS DISTINCT FROM expected_digest OR p_destination IS DISTINCT FROM destination OR p_media IS DISTINCT FROM media THEN RAISE EXCEPTION 'Digest or reservation mismatch'; END IF;
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_authority) key) IS DISTINCT FROM (CASE WHEN p_authority ? 'evidenceRecord' THEN ARRAY['authorizedAt','evidenceRecord','expiresAt','reference','revoked','scheduleDigest']::text[] ELSE ARRAY['authorizedAt','expiresAt','reference','revoked','scheduleDigest']::text[] END)
 OR p_authority->'revoked' IS DISTINCT FROM 'false'::jsonb OR p_authority->>'scheduleDigest' IS DISTINCT FROM p_digest OR NOT coalesce(p_authority->>'reference' ~ '^[A-Za-z0-9_.:-]{1,200}$',false) THEN RAISE EXCEPTION 'Separate owner authority required'; END IF;
 evidence:=p_authority->>'evidenceRecord';
 IF p_authority->>'reference' LIKE 'cafe-policy:%' THEN
  IF evidence IS NULL OR octet_length(evidence) NOT BETWEEN 2 AND 32768 THEN RAISE EXCEPTION 'Recoverable policy evidence required'; END IF;
  parsed:=evidence::jsonb;
  IF cafe_metricool_private.canonical_json(parsed) IS DISTINCT FROM evidence
   OR p_authority->>'reference' IS DISTINCT FROM 'cafe-policy:'||encode(sha256(convert_to(evidence,'UTF8')),'hex')
   OR parsed->'assessment'->>'scheduleDigest' IS DISTINCT FROM p_digest
   OR parsed->'assessment'->>'classification' IS DISTINCT FROM 'routine-cafe-persona-brand-promotion'
   OR parsed->'assessment'->'highImpact' IS DISTINCT FROM 'false'::jsonb
   OR parsed->'assessment'->'paidPromotion' IS DISTINCT FROM 'false'::jsonb
   OR parsed->'assessment'->'containsSensitivePersonalData' IS DISTINCT FROM 'false'::jsonb
   OR parsed->'policy'->'revoked' IS DISTINCT FROM 'false'::jsonb
   OR parsed->'policy'->>'scope' IS DISTINCT FROM 'routine-cafe-persona-brand-promotions'
   THEN RAISE EXCEPTION 'Policy evidence mismatch'; END IF;
 ELSE
  IF evidence IS NOT NULL THEN RAISE EXCEPTION 'Unbound evidence record'; END IF;
 END IF;
 auth_at:=(p_authority->>'authorizedAt')::timestamptz;auth_exp:=(p_authority->>'expiresAt')::timestamptz;
 IF NOT coalesce(p_approved_at<=stamp AND p_approved_at>=stamp-interval '60 seconds' AND p_expires_at>stamp AND p_expires_at<=p_approved_at+interval '24 hours' AND p_expires_at<=auth_exp AND p_expires_at<=(p_snapshot->>'scheduledAt')::timestamptz-interval '60 seconds' AND auth_at<=p_approved_at AND auth_exp>stamp,false) THEN RAISE EXCEPTION 'Authority interval invalid'; END IF;
 INSERT INTO cafe_metricool_private.approvals VALUES(p_plan,p_snapshot,p_digest,p_destination,p_media,p_source,p_actor,p_approved_at,p_expires_at,false);
 IF NOT cafe_metricool_private.authorized(p_plan,p_digest) THEN RAISE EXCEPTION 'Current final QA rejected'; END IF;
 INSERT INTO cafe_metricool_private.owner_authority_provenance VALUES(p_plan,p_authority->>'reference',p_digest,auth_at,auth_exp,p_actor,stamp,evidence);
 RETURN jsonb_build_object('digest',p_digest,'expiresAt',to_char(p_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END $$;
REVOKE ALL ON FUNCTION cafe_metricool_private.canonical_json(jsonb),public.cs_record_cafe_metricool_authority(uuid,jsonb,text,text,text,jsonb,uuid,timestamptz,timestamptz,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
