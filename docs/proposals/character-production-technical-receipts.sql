-- Source-only, owner-only technical observations. No publishing or semantic approval.
BEGIN;
DO $$ BEGIN IF current_user<>'character_production_owner' THEN RAISE EXCEPTION 'Restricted owner required'; END IF; END $$;
CREATE TABLE character_production.technical_receipts (
 enrollment_id uuid NOT NULL, original_token uuid NOT NULL,
 slot_key text NOT NULL, slot_digest text NOT NULL CHECK(slot_digest~'^[a-f0-9]{64}$'),
 promo_id uuid NOT NULL, video_sha256 text NOT NULL CHECK(video_sha256~'^[a-f0-9]{64}$'),
 expected_updated_at timestamptz NOT NULL,
 evidence_text text NOT NULL CHECK(octet_length(evidence_text) BETWEEN 2 AND 16384),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256=encode(sha256(convert_to(evidence_text,'UTF8')),'hex')),
 PRIMARY KEY(enrollment_id,slot_digest,promo_id,video_sha256), UNIQUE(enrollment_id,original_token)
);
ALTER TABLE character_production.technical_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.technical_receipts FROM PUBLIC;
CREATE FUNCTION character_production.technical_receipt_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Technical receipt immutable'; END $$;
CREATE TRIGGER technical_receipt_immutable BEFORE UPDATE OR DELETE ON character_production.technical_receipts FOR EACH ROW EXECUTE FUNCTION character_production.technical_receipt_immutable();
REVOKE ALL ON FUNCTION character_production.technical_receipt_immutable() FROM PUBLIC;
CREATE TABLE character_production.technical_attempts (
 enrollment_id uuid NOT NULL, original_token uuid NOT NULL, claim_id uuid NOT NULL UNIQUE,
 slot_key text NOT NULL, slot_digest text NOT NULL, promo_id uuid NOT NULL,
 video_sha256 text NOT NULL, expected_updated_at timestamptz NOT NULL,
 PRIMARY KEY(enrollment_id,slot_digest,promo_id,video_sha256)
);
ALTER TABLE character_production.technical_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.technical_attempts FROM PUBLIC;
CREATE TRIGGER technical_attempt_immutable BEFORE UPDATE OR DELETE ON character_production.technical_attempts FOR EACH ROW EXECUTE FUNCTION character_production.technical_receipt_immutable();
CREATE FUNCTION public.character_production_technical_qa_claim(p_enrollment uuid,p_token uuid,p_expected_updated_at timestamptz,p_claim uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb; m jsonb; a character_production.technical_attempts; fresh boolean;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required'; END IF;
 IF p_claim IS NULL OR p_expected_updated_at IS NULL THEN RETURN NULL; END IF;
 b:=public.character_production_selected_binding(p_enrollment,p_token);
 IF b IS NULL OR b#>>'{selected,phase}' IS DISTINCT FROM 'qa' THEN RETURN NULL; END IF;
 m:=public.character_production_qa_prepare(b#>>'{selected,key}',b#>>'{selected,digest}');
 IF m IS NULL OR m->>'state' IS DISTINCT FROM 'copy' OR (m->>'expectedUpdatedAt')::timestamptz IS DISTINCT FROM p_expected_updated_at THEN RETURN NULL; END IF;
 -- Parent locks serialize claims; ON CONFLICT additionally preserves the
 -- immutable consumed identity, even if an earlier response was lost.
 INSERT INTO character_production.technical_attempts VALUES(p_enrollment,p_token,p_claim,b#>>'{selected,key}',b#>>'{selected,digest}',(m->>'promoId')::uuid,m->>'sha',p_expected_updated_at)
 ON CONFLICT DO NOTHING RETURNING * INTO a;
 fresh:=FOUND;
 IF NOT fresh THEN
  SELECT * INTO a FROM character_production.technical_attempts WHERE enrollment_id=p_enrollment AND slot_digest=b#>>'{selected,digest}' AND promo_id=(m->>'promoId')::uuid AND video_sha256=m->>'sha';
  IF NOT FOUND THEN RETURN NULL; END IF;
 END IF;
 RETURN jsonb_build_object('claimed',fresh,'claimId',a.claim_id,'promoId',a.promo_id,'videoSha256',a.video_sha256);
END $$;
REVOKE ALL ON FUNCTION public.character_production_technical_qa_claim(uuid,uuid,timestamptz,uuid) FROM PUBLIC;
CREATE FUNCTION public.character_production_technical_qa_record(p_enrollment uuid,p_token uuid,p_expected_updated_at timestamptz,p_claim uuid,p_evidence text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb; m jsonb; e jsonb; snap jsonb; prior character_production.technical_receipts; r character_production.technical_receipts; k text; a jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required'; END IF;
 IF p_evidence IS NULL OR octet_length(p_evidence) NOT BETWEEN 2 AND 16384 OR p_expected_updated_at IS NULL THEN RETURN NULL; END IF;
 b:=public.character_production_selected_binding(p_enrollment,p_token);
 IF b IS NULL OR b#>>'{selected,phase}' IS DISTINCT FROM 'qa' THEN RETURN NULL; END IF;
 m:=public.character_production_qa_prepare(b#>>'{selected,key}',b#>>'{selected,digest}');
 IF m IS NULL OR m->>'state' IS DISTINCT FROM 'copy' OR (m->>'expectedUpdatedAt')::timestamptz IS DISTINCT FROM p_expected_updated_at THEN RETURN NULL; END IF;
 IF p_claim IS NULL OR NOT EXISTS(SELECT 1 FROM character_production.technical_attempts t WHERE t.enrollment_id=p_enrollment AND t.original_token=p_token AND t.claim_id=p_claim AND t.slot_key=b#>>'{selected,key}' AND t.slot_digest=b#>>'{selected,digest}' AND t.promo_id=(m->>'promoId')::uuid AND t.video_sha256=m->>'sha' AND t.expected_updated_at=p_expected_updated_at) THEN RETURN NULL; END IF;
 -- qa_prepare retains parent/job/draft locks throughout this transaction.
 e:=p_evidence::jsonb; snap:=(b->>'snapshotText')::jsonb;
 IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(e) x) IS DISTINCT FROM ARRAY['actualDurationSeconds','audioDurationSeconds','audioSha256','checks','decodedAudioIdentical','evaluator','observedAt','pcmHashes','publicationApproved','qaApproved','snapshotSha256','version','videoSha256']::text[] THEN RETURN NULL; END IF;
 IF e->'version' IS DISTINCT FROM '1'::jsonb OR e->'qaApproved' IS DISTINCT FROM 'false'::jsonb OR e->'publicationApproved' IS DISTINCT FROM 'false'::jsonb OR e->>'videoSha256' IS DISTINCT FROM m->>'sha' OR e->>'snapshotSha256' IS DISTINCT FROM b->>'snapshotSha256' OR e->>'audioSha256' IS DISTINCT FROM snap#>>'{image,audio,audioSha256}' OR NOT coalesce(e->>'audioSha256'~'^[a-f0-9]{64}$',false) THEN RETURN NULL; END IF;
 IF jsonb_typeof(e->'actualDurationSeconds') IS DISTINCT FROM 'number' OR jsonb_typeof(e->'audioDurationSeconds') IS DISTINCT FROM 'number' OR NOT ((e->>'actualDurationSeconds')::numeric BETWEEN 8 AND 45) OR NOT ((e->>'audioDurationSeconds')::numeric>0 AND (e->>'audioDurationSeconds')::numeric<=45) THEN RETURN NULL; END IF;
 IF jsonb_typeof(e->'pcmHashes') IS DISTINCT FROM 'array' OR jsonb_array_length(e->'pcmHashes')<>2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(e->'pcmHashes') v WHERE jsonb_typeof(v)<>'string' OR NOT (v#>>'{}'~'^SHA256=[a-f0-9]{64}$')) OR e->'decodedAudioIdentical' IS DISTINCT FROM to_jsonb(e#>>'{pcmHashes,0}'=e#>>'{pcmHashes,1}') THEN RETURN NULL; END IF;
 IF e->'checks' IS DISTINCT FROM '{"mp4_integrity":"pass","duration":"pass","canonical_speech":"needs_review","canonical_likeness":"needs_review","lip_sync":"needs_review","visual_text":"needs_review","rights":"needs_review","brand_safety":"needs_review","third_party_watermark":"needs_review"}'::jsonb THEN RETURN NULL; END IF;
 a:=e->'evaluator';
 IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(a) x) IS DISTINCT FROM ARRAY['ffmpegSha256','ffmpegVersion','ffprobeSha256','ffprobeVersion','kind','version']::text[] OR a->>'kind' IS DISTINCT FROM 'bounded-native-codec' OR a->'version' IS DISTINCT FROM '1'::jsonb THEN RETURN NULL; END IF;
 FOREACH k IN ARRAY ARRAY['ffmpeg','ffprobe'] LOOP
  IF NOT coalesce(a->>(k||'Sha256')~'^[a-f0-9]{64}$',false) OR jsonb_typeof(a->(k||'Version')) IS DISTINCT FROM 'string' OR length(a->>(k||'Version')) NOT BETWEEN 1 AND 512 THEN RETURN NULL; END IF;
 END LOOP;
 IF jsonb_typeof(e->'observedAt') IS DISTINCT FROM 'string' OR (e->>'observedAt')::timestamptz>clock_timestamp() OR (e->>'observedAt')::timestamptz<clock_timestamp()-interval '5 minutes' THEN RETURN NULL; END IF;
 SELECT * INTO prior FROM character_production.technical_receipts WHERE enrollment_id=p_enrollment AND slot_digest=b#>>'{selected,digest}' AND promo_id=(m->>'promoId')::uuid AND video_sha256=m->>'sha';
 IF FOUND THEN
  IF prior.evidence_text IS DISTINCT FROM p_evidence OR prior.expected_updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN NULL; END IF;
  r:=prior;
 ELSE
  INSERT INTO character_production.technical_receipts VALUES(p_enrollment,p_token,b#>>'{selected,key}',b#>>'{selected,digest}',(m->>'promoId')::uuid,m->>'sha',p_expected_updated_at,p_evidence,encode(sha256(convert_to(p_evidence,'UTF8')),'hex')) RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('evidenceText',r.evidence_text,'evidenceSha256',r.evidence_sha256,'promoId',r.promo_id,'videoSha256',r.video_sha256);
END $$;
REVOKE ALL ON FUNCTION public.character_production_technical_qa_record(uuid,uuid,timestamptz,uuid,text) FROM PUBLIC;
CREATE FUNCTION public.character_production_technical_qa_receipt(p_enrollment uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r character_production.technical_receipts; b jsonb; m jsonb;
BEGIN
 SELECT * INTO r FROM character_production.technical_receipts WHERE enrollment_id=p_enrollment AND original_token=p_token;
 IF NOT FOUND THEN
  b:=public.character_production_selected_binding(p_enrollment,p_token);
  IF b IS NULL OR b#>>'{selected,phase}' IS DISTINCT FROM 'qa' THEN RETURN NULL; END IF;
  SELECT t.* INTO r FROM character_production.technical_receipts t JOIN character_production.jobs j ON j.key=t.slot_key AND j.digest=t.slot_digest AND j.sha=t.video_sha256 JOIN character_production.planning_records p ON p.slot_key=t.slot_key AND p.digest=t.slot_digest AND p.promo_id=t.promo_id WHERE t.enrollment_id=p_enrollment AND t.slot_key=b#>>'{selected,key}' AND t.slot_digest=b#>>'{selected,digest}';
  IF NOT FOUND THEN RETURN NULL; END IF;
 END IF;
 RETURN jsonb_build_object('evidenceText',r.evidence_text,'evidenceSha256',r.evidence_sha256,'promoId',r.promo_id,'videoSha256',r.video_sha256);
END $$;
REVOKE ALL ON FUNCTION public.character_production_technical_qa_receipt(uuid,uuid) FROM PUBLIC;
DO $$ DECLARE r record; own oid:='character_production_owner'::regrole; BEGIN
 FOR r IN SELECT relowner owner,relacl acl FROM pg_class WHERE oid IN('character_production.technical_receipts'::regclass,'character_production.technical_attempts'::regclass) UNION ALL SELECT proowner,proacl FROM pg_proc WHERE oid IN('public.character_production_technical_qa_claim(uuid,uuid,timestamptz,uuid)'::regprocedure,'character_production.technical_receipt_immutable()'::regprocedure,'public.character_production_technical_qa_record(uuid,uuid,timestamptz,uuid,text)'::regprocedure,'public.character_production_technical_qa_receipt(uuid,uuid)'::regprocedure) LOOP IF r.owner<>own OR EXISTS(SELECT 1 FROM aclexplode(r.acl) WHERE grantee<>own) THEN RAISE EXCEPTION 'Owner-only technical receipt required'; END IF; END LOOP;
END $$;
ROLLBACK;
