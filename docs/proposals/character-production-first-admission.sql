-- OFFLINE ONLY. Restricted owner, no runtime grants, config rows or activation.
-- Native receipt/media bytes and quote evidence MUST be verified by trusted
-- server code before admission. SQL binds submitted proof but cannot read Storage.
BEGIN;
DO $$ BEGIN IF current_user<>'character_production_owner' THEN RAISE EXCEPTION 'Restricted owner required'; END IF; END $$;
CREATE TABLE character_production.first_admission_config(
 lane_id uuid PRIMARY KEY REFERENCES character_production.preparation_lanes(id),
 policy_id uuid NOT NULL REFERENCES character_production.planning_policies(id),
 policy_revision bigint NOT NULL CHECK(policy_revision>0), policy_snapshot jsonb NOT NULL,
 theme text NOT NULL CHECK(theme~'^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$'),
 image jsonb NOT NULL, account jsonb NOT NULL, quote jsonb NOT NULL,
 rights_evidence_ref text NOT NULL CHECK(length(btrim(rights_evidence_ref)) BETWEEN 1 AND 500),
 enabled boolean NOT NULL DEFAULT false,
 CHECK(jsonb_typeof(policy_snapshot)='object'),
 CHECK(jsonb_typeof(image)='object' AND octet_length(image::text)<=4096),
 CHECK(jsonb_typeof(account)='object' AND octet_length(account::text)<=4096),
 CHECK(jsonb_typeof(quote)='object' AND octet_length(quote::text)<=4096)
);
CREATE TABLE character_production.first_admission_records(
 occurrence_id uuid PRIMARY KEY REFERENCES character_production.preparation_occurrences(id),
 lane_id uuid NOT NULL UNIQUE REFERENCES character_production.first_admission_config(lane_id),
 enrollment_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),draft_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 generation_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 manifest_text text,manifest_sha256 text,
 CHECK(generation_at>created_at),
 CHECK((manifest_text IS NULL AND manifest_sha256 IS NULL) OR
 (manifest_text IS NOT NULL AND manifest_sha256 IS NOT NULL AND octet_length(manifest_text) BETWEEN 2 AND 65536 AND manifest_sha256=encode(sha256(convert_to(manifest_text,'UTF8')),'hex')))
);
ALTER TABLE character_production.first_admission_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.first_admission_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.first_admission_config,character_production.first_admission_records FROM PUBLIC;
CREATE FUNCTION character_production.first_admission_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_TABLE_NAME='first_admission_config' AND TG_OP='UPDATE' THEN
  IF OLD.enabled AND NOT NEW.enabled AND to_jsonb(OLD)-'enabled'=to_jsonb(NEW)-'enabled' THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='first_admission_records' AND TG_OP='UPDATE' THEN
  IF OLD.manifest_text IS NULL AND OLD.manifest_sha256 IS NULL AND NEW.manifest_text IS NOT NULL AND NEW.manifest_sha256 IS NOT NULL AND to_jsonb(OLD)-'manifest_text'-'manifest_sha256'=to_jsonb(NEW)-'manifest_text'-'manifest_sha256' THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'First admission immutable; no reset or successor'; END $$;
CREATE TRIGGER first_admission_config_immutable BEFORE UPDATE OR DELETE ON character_production.first_admission_config FOR EACH ROW EXECUTE FUNCTION character_production.first_admission_immutable();
CREATE TRIGGER first_admission_records_immutable BEFORE UPDATE OR DELETE ON character_production.first_admission_records FOR EACH ROW EXECUTE FUNCTION character_production.first_admission_immutable();
-- Revocation propagation is an explicit lifecycle capability: never enables,
-- replaces or revokes unrelated enrollments. Existing scheduler revoke cascades
-- only its own slots/schedules/QA bindings. No new runtime grants.
CREATE FUNCTION character_production.first_admission_revoke() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lane uuid;
BEGIN
 IF OLD.enabled AND NOT NEW.enabled THEN
  IF TG_TABLE_NAME='preparation_lanes' THEN lane:=OLD.id;
  ELSIF TG_TABLE_NAME='first_admission_config' THEN lane:=OLD.lane_id;
  ELSE RAISE EXCEPTION 'Unexpected revocation source'; END IF;
  UPDATE character_production.scheduler_enrollments SET enabled=false WHERE enabled AND id IN(SELECT enrollment_id FROM character_production.first_admission_records WHERE lane_id=lane);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER first_admission_config_revoke AFTER UPDATE ON character_production.first_admission_config FOR EACH ROW EXECUTE FUNCTION character_production.first_admission_revoke();
CREATE TRIGGER first_admission_lane_revoke AFTER UPDATE ON character_production.preparation_lanes FOR EACH ROW EXECUTE FUNCTION character_production.first_admission_revoke();
-- Compact scalar arrays match productionSlotDigest and media binding digests.
CREATE FUNCTION character_production.first_admission_hash(p jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to('['||string_agg(v::text,',' ORDER BY ord)||']','UTF8')),'hex') FROM jsonb_array_elements(p) WITH ORDINALITY a(v,ord)
$$;
CREATE FUNCTION public.character_production_first_admission_context() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c character_production.first_admission_config;l character_production.preparation_lanes;p character_production.planning_policies;r character_production.first_admission_records;o character_production.preparation_occurrences;
 prep jsonb;active boolean;stamp timestamptz;expiry timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN NULL; END IF;
 SELECT x.* INTO c FROM character_production.first_admission_config x JOIN character_production.preparation_binding b ON b.lane_id=x.lane_id WHERE b.name='zaria-gallery-preparation' FOR SHARE OF x NOWAIT;
 IF c.lane_id IS NULL THEN RETURN NULL; END IF;
 -- Policy precedes lane and enrollment locks, matching the existing planner.
 SELECT * INTO p FROM character_production.planning_policies WHERE id=c.policy_id FOR UPDATE NOWAIT;
 prep:=public.character_production_preparation_context();
 IF prep IS NULL OR prep->'identity' IS NULL OR prep->'identity'='null'::jsonb THEN RETURN NULL; END IF;
 SELECT * INTO o FROM character_production.preparation_occurrences WHERE id=(prep->>'occurrenceId')::uuid AND lane_id=c.lane_id;
 IF o.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO l FROM character_production.preparation_lanes WHERE id=c.lane_id FOR SHARE NOWAIT;
 SELECT * INTO r FROM character_production.first_admission_records WHERE occurrence_id=o.id FOR UPDATE;
 stamp:=clock_timestamp();expiry:=least(l.expires_at,p.expires_at);
 active:=c.enabled AND p.enabled AND prep->'active'='true'::jsonb AND p.revision=c.policy_revision AND to_jsonb(p)=c.policy_snapshot
 AND p.period=to_char(stamp AT TIME ZONE 'America/Chicago','YYYY-MM') AND p.expires_at>stamp AND l.expires_at>stamp
 AND 'zaria-solenne'=ANY(p.characters) AND c.theme=ANY(p.themes)
 AND public.cs_cafe_metricool_is_admin(l.actor_id) IS TRUE
 AND (length(coalesce(p.owner_evidence->>'evidenceRef','')) BETWEEN 1 AND 500 AND coalesce(p.owner_evidence->>'evidenceRef','')~'^[A-Za-z0-9_.:/-]+$')
;
 -- Fixed reviewed config must be well formed before IDs/time are allocated.
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(c.account) k) IS DISTINCT FROM ARRAY['aspectRatio','expectedUsername','linkId','model']::text[]
 OR c.account->>'model' IS DISTINCT FROM 'avatar_iv' OR c.account->>'expectedUsername' IS DISTINCT FROM p.account_id
 OR NOT coalesce(c.account->>'aspectRatio' IN('9:16','16:9'),false) OR NOT coalesce(c.account->>'linkId'~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$',false)
 OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(c.image) k) IS DISTINCT FROM (CASE WHEN c.image?'approvedScene' THEN ARRAY['approvedScene','avatarId','canonicalRevision','imageBytes','mime','portraitSha256']::text[] ELSE ARRAY['avatarId','canonicalRevision','imageBytes','mime','portraitSha256']::text[] END)
 OR NOT coalesce(c.image->>'avatarId'~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$',false)
 OR NOT coalesce(c.image->>'canonicalRevision'~'^[a-f0-9]{64}$' AND c.image->>'portraitSha256'~'^[a-f0-9]{64}$',false)
 OR NOT coalesce(c.image->>'mime' IN('image/png','image/jpeg'),false)
 OR jsonb_typeof(c.image->'imageBytes') IS DISTINCT FROM 'number' OR NOT coalesce(c.image->>'imageBytes'~'^[0-9]{1,8}$',false)
 OR (c.image->>'imageBytes')::bigint NOT BETWEEN 12 AND 10485760
 OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(c.quote) k) IS DISTINCT FROM ARRAY['cents','durationSeconds','evidenceRef','expiresAt','observedAt']::text[]
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['cents','durationSeconds','expiresAt','observedAt']) k WHERE jsonb_typeof(c.quote->k) IS DISTINCT FROM 'number' OR NOT coalesce(c.quote->>k~'^[0-9]{1,16}$',false))
 OR NOT coalesce(length(c.quote->>'evidenceRef') BETWEEN 1 AND 500 AND c.quote->>'evidenceRef'~'^[A-Za-z0-9_.:/-]+$',false)
 OR (c.quote->>'durationSeconds')::bigint NOT BETWEEN 8 AND p.max_duration OR (c.quote->>'cents')::bigint NOT BETWEEN 1 AND p.cap_cents THEN RETURN NULL; END IF;
 IF c.image?'approvedScene' THEN
  IF jsonb_typeof(c.image->'approvedScene') IS DISTINCT FROM 'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(c.image->'approvedScene') k) IS DISTINCT FROM ARRAY['approvalReference','imageSha256']::text[] OR NOT coalesce(c.image#>>'{approvedScene,imageSha256}'~'^[a-f0-9]{64}$',false) OR NOT coalesce(length(btrim(c.image#>>'{approvedScene,approvalReference}')) BETWEEN 1 AND 500,false) OR c.image#>>'{approvedScene,approvalReference}'~E'[\\r\\n]' THEN RETURN NULL; END IF;
 END IF;
 active:=active AND (c.quote->>'observedAt')::numeric<=extract(epoch FROM stamp)*1000 AND (c.quote->>'expiresAt')::numeric>extract(epoch FROM stamp)*1000 AND (c.quote->>'expiresAt')::numeric<=(c.quote->>'observedAt')::numeric+86400000;
 IF r.occurrence_id IS NULL THEN
  IF active IS DISTINCT FROM true OR expiry<=stamp+interval '5 minutes' OR EXISTS(SELECT 1 FROM character_production.scheduler_binding) THEN RETURN NULL; END IF;
  INSERT INTO character_production.first_admission_records(occurrence_id,lane_id,generation_at) VALUES(o.id,c.lane_id,date_trunc('milliseconds',stamp+interval '5 minutes')) ON CONFLICT DO NOTHING;
  SELECT * INTO r FROM character_production.first_admission_records WHERE occurrence_id=o.id FOR UPDATE;
 END IF;
 -- Any unique collision must reconcile to this exact original occurrence/lane.
 IF r.occurrence_id IS DISTINCT FROM o.id OR r.lane_id IS DISTINCT FROM c.lane_id THEN RETURN NULL; END IF;
 active:=active AND r.generation_at>stamp AND r.generation_at<expiry;
 IF EXISTS(SELECT 1 FROM character_production.scheduler_binding b WHERE b.enrollment_id<>r.enrollment_id OR NOT b.enabled) THEN active:=false; END IF;
 RETURN jsonb_build_object('active',coalesce(active,false),'occurrenceId',o.id,'identity',prep->'identity','actorId',l.actor_id,'policyId',p.id,'policyRevision',p.revision,'period',p.period,'capCents',p.cap_cents,'expiresAt',floor(extract(epoch FROM expiry)*1000)::bigint,'theme',c.theme,'ownerEvidenceRef',p.owner_evidence->>'evidenceRef','generationAt',to_char(r.generation_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'draftId',r.draft_id,'enrollmentId',r.enrollment_id,'image',c.image,'account',c.account,'quote',c.quote,'rightsEvidenceRef',c.rights_evidence_ref,'accepted',CASE WHEN r.manifest_text IS NOT NULL THEN jsonb_build_object('id',r.enrollment_id,'manifestSha256',r.manifest_sha256,'ordinals',jsonb_build_array(0),'manifest',r.manifest_text) END);
END $$;
CREATE FUNCTION public.character_production_first_admit(p_occurrence uuid,p_manifest_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;r character_production.first_admission_records;cfg character_production.first_admission_config;p character_production.planning_policies;a character_production.text_replenishment_attempts;
 m jsonb;i jsonb;c jsonb;s jsonb;b jsonb;audio jsonb;speech jsonb;image jsonb;slot_digest text;audio_digest text;image_digest text;binding_digest text;h text;stamp timestamptz;candidate jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR p_manifest_text IS NULL OR octet_length(p_manifest_text) NOT BETWEEN 2 AND 65536 THEN RETURN NULL; END IF;
 ctx:=public.character_production_first_admission_context();
 IF ctx IS NULL OR ctx->>'occurrenceId' IS DISTINCT FROM p_occurrence::text THEN RETURN NULL; END IF;
 SELECT * INTO r FROM character_production.first_admission_records WHERE occurrence_id=p_occurrence FOR UPDATE;
 IF r.manifest_text IS NOT NULL THEN
  IF r.manifest_text IS DISTINCT FROM p_manifest_text THEN RETURN NULL; END IF;
  RETURN (ctx->'accepted')||jsonb_build_object('currentAuthority',ctx->'active');
 END IF;
 IF ctx->'active' IS DISTINCT FROM 'true'::jsonb OR EXISTS(SELECT 1 FROM character_production.scheduler_binding) THEN RETURN NULL; END IF;
 SELECT * INTO cfg FROM character_production.first_admission_config WHERE lane_id=r.lane_id;
 SELECT * INTO p FROM character_production.planning_policies WHERE id=cfg.policy_id;
 SELECT * INTO a FROM character_production.text_replenishment_attempts WHERE key=ctx#>>'{identity,textAttemptKey}' AND token=(ctx#>>'{identity,textAttemptToken}')::uuid AND source_digest=ctx#>>'{identity,textSourceDigest}' AND state='awaiting_audio_binding_and_qa';
 IF a.key IS NULL OR a.source_snapshot->>'canonicalRevision' IS DISTINCT FROM cfg.image->>'canonicalRevision' OR a.source_snapshot->>'portraitSha256' IS DISTINCT FROM cfg.image->>'portraitSha256' OR a.source_snapshot->>'voiceId' IS DISTINCT FROM '5zneNR4v1Uw5AjIZ9Un4' OR length(a.output->>'spokenScript') NOT BETWEEN 1 AND 250 THEN RETURN NULL; END IF;
 m:=p_manifest_text::jsonb;
 IF jsonb_typeof(m) IS DISTINCT FROM 'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(m) k) IS DISTINCT FROM ARRAY['candidates','deadlineMs','enabled','expectedUsername','heygen','images']::text[] OR m->'enabled' IS DISTINCT FROM 'true'::jsonb OR m->'deadlineMs' IS DISTINCT FROM '30000'::jsonb OR m->>'expectedUsername' IS DISTINCT FROM p.account_id OR m->'heygen' IS DISTINCT FROM cfg.account-'expectedUsername' OR jsonb_typeof(m->'images') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'images')<>1 OR jsonb_typeof(m->'candidates') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'candidates')<>1 THEN RETURN NULL; END IF;
 i:=m->'images'->0;c:=m->'candidates'->0;s:=c->'slot';
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(i) k) IS DISTINCT FROM ARRAY['durationSeconds','image','quoteCents','quoteEvidenceRef','quoteExpiresAt','quoteObservedAt','rightsEvidenceRef','snapshotText','themes']::text[] OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(c) k) IS DISTINCT FROM ARRAY['draftId','policyId','policyRevision','scheduledAt','slot','theme']::text[]
 OR c->>'draftId' IS DISTINCT FROM r.draft_id::text OR c->>'policyId' IS DISTINCT FROM p.id::text OR c->'policyRevision' IS DISTINCT FROM to_jsonb(p.revision) OR c->>'scheduledAt' IS DISTINCT FROM ctx->>'generationAt' OR c->>'theme' IS DISTINCT FROM cfg.theme
 OR i->'themes' IS DISTINCT FROM jsonb_build_array(cfg.theme) OR i->>'rightsEvidenceRef' IS DISTINCT FROM cfg.rights_evidence_ref OR i->'quoteCents' IS DISTINCT FROM cfg.quote->'cents' OR i->'durationSeconds' IS DISTINCT FROM cfg.quote->'durationSeconds' OR i->'quoteObservedAt' IS DISTINCT FROM cfg.quote->'observedAt' OR i->'quoteExpiresAt' IS DISTINCT FROM cfg.quote->'expiresAt' OR i->>'quoteEvidenceRef' IS DISTINCT FROM cfg.quote->>'evidenceRef' OR jsonb_typeof(i->'snapshotText') IS DISTINCT FROM 'string' OR octet_length(i->>'snapshotText') NOT BETWEEN 2 AND 32768 THEN RETURN NULL; END IF;
 b:=(i->>'snapshotText')::jsonb;image:=b->'image';audio:=image->'audio';speech:=b->'speech';
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(b) k) IS DISTINCT FROM ARRAY['account','image','speech','version']::text[] OR b->'version' IS DISTINCT FROM '1'::jsonb OR b->'account' IS DISTINCT FROM cfg.account OR image IS DISTINCT FROM i->'image' OR image-'audio' IS DISTINCT FROM (cfg.image-'avatarId')||jsonb_build_object('characterId','zaria-solenne')
 OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(audio) k) IS DISTINCT FROM ARRAY['audioBytes','audioSha256','avatarId','canonicalRevision','characterId','mime','portraitSha256','provider','scriptSha256','synthesisReceiptId','voiceId','voiceModel']::text[]
 OR audio->>'characterId' IS DISTINCT FROM 'zaria-solenne' OR audio->>'avatarId' IS DISTINCT FROM cfg.image->>'avatarId' OR audio->>'canonicalRevision' IS DISTINCT FROM cfg.image->>'canonicalRevision' OR audio->>'portraitSha256' IS DISTINCT FROM cfg.image->>'portraitSha256' OR audio->>'voiceId' IS DISTINCT FROM a.source_snapshot->>'voiceId' OR audio->>'voiceModel' IS DISTINCT FROM 'eleven_multilingual_v2' OR audio->>'provider' IS DISTINCT FROM 'elevenlabs' OR audio->>'scriptSha256' IS DISTINCT FROM ctx#>>'{identity,scriptSha256}' OR NOT coalesce(audio->>'audioSha256'~'^[a-f0-9]{64}$',false) OR jsonb_typeof(audio->'audioBytes') IS DISTINCT FROM 'number' OR NOT coalesce(audio->>'audioBytes'~'^[0-9]{1,8}$',false) OR (audio->>'audioBytes')::bigint NOT BETWEEN 12 AND 33554432 OR NOT coalesce(audio->>'mime' IN('audio/mpeg','audio/wav'),false) OR NOT coalesce(audio->>'synthesisReceiptId'~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$',false)
 OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(speech) k) IS DISTINCT FROM ARRAY['claimSha256','key','receiptSha256','scopeId','textAttemptKey','textAttemptToken','textSourceDigest']::text[] OR speech->>'textAttemptKey' IS DISTINCT FROM a.key OR speech->>'textAttemptToken' IS DISTINCT FROM a.token::text OR speech->>'textSourceDigest' IS DISTINCT FROM a.source_digest OR NOT coalesce(speech->>'scopeId'~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false) OR NOT coalesce(speech->>'claimSha256'~'^[a-f0-9]{64}$' AND speech->>'receiptSha256'~'^[a-f0-9]{64}$',false)
 OR speech->>'key' IS DISTINCT FROM 'fresh-zaria-'||character_production.first_admission_hash(jsonb_build_array(a.key,a.token::text,ctx#>>'{identity,scriptSha256}')) THEN RETURN NULL; END IF;
 audio_digest:=character_production.first_admission_hash(jsonb_build_array('rendered-audio-v1',audio->'characterId',audio->'avatarId',audio->'voiceId',audio->'voiceModel',audio->'canonicalRevision',audio->'portraitSha256',audio->'scriptSha256',audio->'audioSha256',audio->'audioBytes',audio->'mime',audio->'provider',audio->'synthesisReceiptId'));
 IF image?'approvedScene' THEN image_digest:=character_production.first_admission_hash(jsonb_build_array('canonical-scene-image-v2',image->'characterId',image->'canonicalRevision',image->'portraitSha256',image#>'{approvedScene,imageSha256}',image#>'{approvedScene,approvalReference}',image->'imageBytes',image->'mime',audio_digest));
 ELSE image_digest:=character_production.first_admission_hash(jsonb_build_array('canonical-image-v1',image->'characterId',image->'canonicalRevision',image->'portraitSha256',image->'imageBytes',image->'mime',audio_digest)); END IF;
 binding_digest:=character_production.first_admission_hash(jsonb_build_array('heygen-avatar-binding-v1','heygen',cfg.account->'linkId','avatar_iv','zaria-solenne',cfg.image->'canonicalRevision',cfg.image->'portraitSha256',audio->'voiceId',cfg.image->'avatarId',cfg.account->'aspectRatio','mp4','1080p','rendered-audio-v1',audio_digest,'canonical-image-v1',image_digest));
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(s) k) IS DISTINCT FROM ARRAY['authorizationExpiresAt','authorizationId','canonicalRevision','characterId','durationSeconds','key','model','period','periodCapCents','portraitSha256','provider','providerBindingRevision','quoteCents','script','voiceId']::text[]
 OR s IS DISTINCT FROM jsonb_build_object('key','first:'||p_occurrence::text,'authorizationId','first:'||p_occurrence::text,'characterId','zaria-solenne','script',a.output->>'spokenScript','canonicalRevision',cfg.image->'canonicalRevision','voiceId',audio->'voiceId','portraitSha256',cfg.image->'portraitSha256','provider','heygen','model','avatar_iv','durationSeconds',cfg.quote->'durationSeconds','authorizationExpiresAt',ctx->'expiresAt','period',p.period,'quoteCents',cfg.quote->'cents','periodCapCents',p.cap_cents,'providerBindingRevision',binding_digest) THEN RETURN NULL; END IF;
 slot_digest:=character_production.first_admission_hash(jsonb_build_array(s->'key',s->'characterId',s->'script',s->'canonicalRevision',s->'voiceId',s->'portraitSha256',s->'provider',s->'model',s->'durationSeconds',s->'authorizationId',s->'authorizationExpiresAt',s->'period',s->'quoteCents',s->'periodCapCents',s->'providerBindingRevision'));
 h:=encode(sha256(convert_to(p_manifest_text,'UTF8')),'hex');stamp:=clock_timestamp();
 IF r.generation_at<=stamp OR (cfg.quote->>'expiresAt')::numeric<=extract(epoch FROM stamp)*1000 THEN RETURN NULL; END IF;
 candidate:=jsonb_build_object('ordinal',0,'slot',s,'digest',slot_digest,'draftId',r.draft_id,'theme',cfg.theme,'scheduledAt',ctx->>'generationAt');
 INSERT INTO character_production.scheduler_enrollments(id,policy_id,policy_revision,actor_id,policy_snapshot,candidate_snapshot,manifest_sha256,owner_evidence_ref,approved_at,expires_at,enabled) VALUES(r.enrollment_id,p.id,p.revision,(ctx->>'actorId')::uuid,to_jsonb(p),jsonb_build_array(candidate),h,ctx->>'ownerEvidenceRef',stamp,to_timestamp((ctx->>'expiresAt')::numeric/1000),true);
 INSERT INTO character_production.scheduler_candidates VALUES(r.enrollment_id,0,s,slot_digest,r.draft_id,cfg.theme,r.generation_at);
 INSERT INTO character_production.scheduler_binding VALUES('cafe-character-planner',r.enrollment_id,true);
 UPDATE character_production.first_admission_records SET manifest_text=p_manifest_text,manifest_sha256=h WHERE occurrence_id=p_occurrence;
 RETURN jsonb_build_object('id',r.enrollment_id,'manifestSha256',h,'ordinals',jsonb_build_array(0),'manifest',p_manifest_text,'currentAuthority',true);
END $$;
REVOKE ALL ON FUNCTION character_production.first_admission_immutable(),character_production.first_admission_revoke(),character_production.first_admission_hash(jsonb),public.character_production_first_admission_context(),public.character_production_first_admit(uuid,text) FROM PUBLIC;
DO $$ DECLARE r record; own oid:='character_production_owner'::regrole; BEGIN
 FOR r IN SELECT relowner owner,relacl acl FROM pg_class WHERE oid IN('character_production.first_admission_config'::regclass,'character_production.first_admission_records'::regclass)
 UNION ALL SELECT proowner,proacl FROM pg_proc WHERE oid IN('character_production.first_admission_immutable()'::regprocedure,'character_production.first_admission_revoke()'::regprocedure,'character_production.first_admission_hash(jsonb)'::regprocedure,'public.character_production_first_admission_context()'::regprocedure,'public.character_production_first_admit(uuid,text)'::regprocedure)
 LOOP IF r.owner<>own OR EXISTS(SELECT 1 FROM aclexplode(r.acl) WHERE grantee<>own) THEN RAISE EXCEPTION 'Owner-only first admission required'; END IF; END LOOP;
END $$;
ROLLBACK;
