-- Source-only owner-scoped positive publication evidence. No install/grants.
-- Provider observation must originate in the reviewed read-only reconciler.
BEGIN;
DO $$ BEGIN IF current_user<>'cafe_metricool_owner' THEN RAISE EXCEPTION 'Restricted publication owner required'; END IF; END $$;
CREATE TABLE cafe_metricool_private.publication_receipts(
 plan_id uuid PRIMARY KEY REFERENCES cafe_metricool_private.attempts(plan_id),
 attempt_token uuid NOT NULL, digest text NOT NULL, receipt jsonb NOT NULL,
 evidence_text text NOT NULL CHECK(octet_length(evidence_text) BETWEEN 2 AND 8192),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256~'^[a-f0-9]{64}$'),
 CHECK(evidence_sha256=encode(sha256(convert_to(evidence_text,'UTF8')),'hex'))
);
ALTER TABLE cafe_metricool_private.publication_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cafe_metricool_private.publication_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION cafe_metricool_private.publication_receipt_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Original publication evidence immutable'; END $$;
CREATE TRIGGER publication_receipt_immutable BEFORE UPDATE OR DELETE ON cafe_metricool_private.publication_receipts FOR EACH ROW EXECUTE FUNCTION cafe_metricool_private.publication_receipt_immutable();
REVOKE ALL ON FUNCTION cafe_metricool_private.publication_receipt_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.cs_cafe_publication_attempt(p_plan uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a cafe_metricool_private.attempts; s jsonb;
BEGIN
 SELECT * INTO a FROM cafe_metricool_private.attempts WHERE plan_id=p_plan;
 SELECT snapshot INTO s FROM cafe_metricool_private.approvals WHERE plan_id=p_plan;
 IF a.plan_id IS NULL OR a.state<>'scheduled' OR a.provider_id IS NULL OR a.provider_uuid IS NULL OR s->>'brandId' IS DISTINCT FROM '7605217'
 OR NOT coalesce(((s->>'network'='facebook' AND s->>'accountId'='105363501666032') OR (s->>'network'='instagram' AND s->>'accountId'='cafesativainc')),false) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('planId',a.plan_id,'token',a.token,'digest',a.digest,'providerId',a.provider_id,'providerUuid',a.provider_uuid,'network',s->>'network','accountId',s->>'accountId','scheduledAt',s->>'scheduledAt');
END $$;
REVOKE ALL ON FUNCTION public.cs_cafe_publication_attempt(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.cs_record_cafe_publication_receipt(p_plan uuid,p_token uuid,p_digest text,p_receipt jsonb,p_evidence text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a cafe_metricool_private.attempts; expected jsonb; e jsonb; stamp timestamptz:=clock_timestamp(); old cafe_metricool_private.publication_receipts;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR p_evidence IS NULL OR octet_length(p_evidence) NOT BETWEEN 2 AND 8192 THEN RETURN false; END IF;
 SELECT * INTO a FROM cafe_metricool_private.attempts WHERE plan_id=p_plan FOR UPDATE;
 expected:=public.cs_cafe_publication_attempt(p_plan);
 IF expected IS NULL OR a.token IS DISTINCT FROM p_token OR a.digest IS DISTINCT FROM p_digest THEN RETURN false; END IF;
 SELECT * INTO old FROM cafe_metricool_private.publication_receipts WHERE plan_id=p_plan;
 IF FOUND THEN RETURN old.attempt_token=p_token AND old.digest=p_digest AND old.receipt=p_receipt AND old.evidence_text=p_evidence; END IF;
 IF jsonb_typeof(p_receipt) IS DISTINCT FROM 'object' OR (p_receipt-'version'-'brandId'-'destinationId'-'publicUrl'-'observedAt'-'evidenceSha256') IS DISTINCT FROM expected
 OR jsonb_typeof(p_receipt->'publicUrl') IS DISTINCT FROM 'string' OR length(p_receipt->>'publicUrl') NOT BETWEEN 1 AND 500 OR p_receipt->'version' IS DISTINCT FROM '1'::jsonb OR p_receipt->>'brandId' IS DISTINCT FROM '7605217'
 OR p_receipt->>'evidenceSha256' IS DISTINCT FROM encode(sha256(convert_to(p_evidence,'UTF8')),'hex')
 OR NOT coalesce((p_receipt->>'observedAt')::timestamptz BETWEEN stamp-interval '60 seconds' AND stamp,false)
 OR (expected->>'scheduledAt')::timestamptz>stamp THEN RETURN false; END IF;
 e:=p_evidence::jsonb;
 IF e->>'status' IS DISTINCT FROM 'PUBLISHED' OR e->>'postId' IS DISTINCT FROM a.provider_id OR e->>'postUuid' IS DISTINCT FROM a.provider_uuid
 OR e->>'network' IS DISTINCT FROM expected->>'network' OR e->>'destinationId' IS DISTINCT FROM p_receipt->>'destinationId' OR e->>'publicUrl' IS DISTINCT FROM p_receipt->>'publicUrl'
 OR e->>'brand' IS DISTINCT FROM '[7605217,4174093,"America/Chicago","105363501666032","cafesativainc"]' OR e->'creatorUserId' IS DISTINCT FROM '4174093'::jsonb OR e#>>'{publicationDate,timezone}' IS DISTINCT FROM 'America/Chicago'
 OR e#>>'{publicationDate,dateTime}' IS DISTINCT FROM to_char((expected->>'scheduledAt')::timestamptz AT TIME ZONE 'America/Chicago','YYYY-MM-DD"T"HH24:MI:SS') THEN RETURN false; END IF;
 IF expected->>'network'='facebook' THEN
  IF NOT coalesce(p_receipt->>'destinationId'~'^[0-9]{1,40}$',false) OR NOT(p_receipt->>'publicUrl'=ANY(ARRAY['https://facebook.com/reel/'||(p_receipt->>'destinationId'),'https://facebook.com/reel/'||(p_receipt->>'destinationId')||'/','https://www.facebook.com/reel/'||(p_receipt->>'destinationId'),'https://www.facebook.com/reel/'||(p_receipt->>'destinationId')||'/'])) THEN RETURN false; END IF;
 ELSE
  IF p_receipt->>'destinationId' IS DISTINCT FROM p_receipt->>'publicUrl' OR NOT coalesce(p_receipt->>'publicUrl'~'^https://(www\.)?instagram\.com/reel/[A-Za-z0-9_-]{1,100}/?$',false) THEN RETURN false; END IF;
 END IF;
 INSERT INTO cafe_metricool_private.publication_receipts VALUES(p_plan,p_token,p_digest,p_receipt,p_evidence,p_receipt->>'evidenceSha256');
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.cs_record_cafe_publication_receipt(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
-- Positive receipts for BOTH exact Café destinations, not schedule disappearance.
-- This does not itself revoke authority, retarget bindings or enroll a successor.
CREATE FUNCTION public.cs_cafe_publication_terminal(p_draft uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT count(*)=2 AND count(DISTINCT p.network)=2 AND bool_and(
  coalesce(a.state='scheduled',false) AND r.plan_id IS NOT NULL AND r.attempt_token=a.token AND r.digest=a.digest AND
  ((p.network='facebook' AND p.account_id='105363501666032') OR (p.network='instagram' AND p.account_id='cafesativainc')))
 FROM public.cs_character_promo_delivery_plans p LEFT JOIN cafe_metricool_private.attempts a ON a.plan_id=p.id
 LEFT JOIN cafe_metricool_private.publication_receipts r ON r.plan_id=p.id
 WHERE p.promo_id=p_draft;
$$;
REVOKE ALL ON FUNCTION public.cs_cafe_publication_terminal(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE r record; own oid:='cafe_metricool_owner'::regrole; BEGIN
 FOR r IN SELECT relowner owner,relacl acl FROM pg_class WHERE oid='cafe_metricool_private.publication_receipts'::regclass
 UNION ALL SELECT proowner,proacl FROM pg_proc WHERE oid IN('cafe_metricool_private.publication_receipt_immutable()'::regprocedure,'public.cs_cafe_publication_attempt(uuid)'::regprocedure,'public.cs_record_cafe_publication_receipt(uuid,uuid,text,jsonb,text)'::regprocedure,'public.cs_cafe_publication_terminal(uuid)'::regprocedure)
 LOOP IF r.owner<>own OR EXISTS(SELECT 1 FROM aclexplode(r.acl) WHERE grantee<>own) THEN RAISE EXCEPTION 'Owner-only publication receipts required'; END IF; END LOOP;
END $$;
ROLLBACK;
