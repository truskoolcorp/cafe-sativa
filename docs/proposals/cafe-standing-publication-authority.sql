-- OFFLINE CONTRACT ONLY, base68f93039. No runtime grants or enrollment rows.
-- Requires installed real scheduler principal and Café store/writer/identity repair.
-- Installer/owner lifecycle is deliberately a separate reviewed operation.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
SET LOCAL ROLE character_production_owner;
CREATE FUNCTION public.cs_cafe_generation_membership(p_draft uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE eid uuid; pid uuid; e character_production.scheduler_enrollments; c character_production.scheduler_candidates;
BEGIN
 SELECT b.enrollment_id INTO eid FROM character_production.scheduler_binding b WHERE b.name='cafe-character-planner' AND b.enabled FOR SHARE NOWAIT;
 SELECT policy_id INTO pid FROM character_production.scheduler_enrollments WHERE id=eid;
 IF pid IS NULL THEN RETURN NULL; END IF;
 -- Fail closed on contention. Never wait with a Café draft lock while an
 -- existing planner holds the policy lock and waits for that same draft.
 PERFORM 1 FROM character_production.planning_policies WHERE id=pid FOR UPDATE NOWAIT;
 PERFORM 1 FROM character_production.scheduler_enrollments WHERE id=eid FOR UPDATE NOWAIT;
 e:=character_production.scheduler_current(eid); IF e.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO c FROM character_production.scheduler_candidates WHERE enrollment_id=e.id AND draft_id=p_draft;
 IF c.enrollment_id IS NULL OR public.character_production_planned_draft(c.draft_id,c.slot,c.digest,c.theme) IS DISTINCT FROM true THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('enrollmentId',e.id,'actorId',e.actor_id,'manifestSha256',e.manifest_sha256,'characterId',c.slot->>'characterId','draftId',c.draft_id,'scheduledAt',to_char(c.scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'expiresAt',to_char(e.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END $$;
REVOKE ALL ON FUNCTION public.cs_cafe_generation_membership(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cs_cafe_generation_membership(uuid) TO cafe_metricool_owner;
SET LOCAL ROLE cafe_metricool_owner;
CREATE TABLE cafe_metricool_private.publication_scopes(
 id uuid PRIMARY KEY, enrollment_id uuid NOT NULL, manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL, policy jsonb NOT NULL, enabled boolean NOT NULL DEFAULT false,
 CHECK(jsonb_typeof(policy)='object' AND octet_length(policy::text)<=16384)
);
CREATE TABLE cafe_metricool_private.publication_binding(
 name text PRIMARY KEY CHECK(name='cafe-routine-publication'), scope_id uuid NOT NULL REFERENCES cafe_metricool_private.publication_scopes(id), enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE cafe_metricool_private.publication_authorities(
 plan_id uuid PRIMARY KEY REFERENCES public.cs_character_promo_delivery_plans(id),
 scope_id uuid NOT NULL REFERENCES cafe_metricool_private.publication_scopes(id),
 schedule_digest text NOT NULL CHECK(schedule_digest ~ '^[a-f0-9]{64}$')
);
ALTER TABLE cafe_metricool_private.publication_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cafe_metricool_private.publication_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE cafe_metricool_private.publication_authorities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cafe_metricool_private.publication_scopes,cafe_metricool_private.publication_binding,cafe_metricool_private.publication_authorities FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION cafe_metricool_private.publication_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='publication_scopes' AND TG_OP='UPDATE' AND OLD.enabled AND NOT NEW.enabled AND to_jsonb(OLD)-'enabled'=to_jsonb(NEW)-'enabled' THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Standing publication provenance immutable; revoke or enroll successor';
END $$;
REVOKE ALL ON FUNCTION cafe_metricool_private.publication_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER publication_scope_immutable BEFORE UPDATE OR DELETE ON cafe_metricool_private.publication_scopes FOR EACH ROW EXECUTE FUNCTION cafe_metricool_private.publication_immutable();
CREATE TRIGGER publication_authority_immutable BEFORE UPDATE OR DELETE ON cafe_metricool_private.publication_authorities FOR EACH ROW EXECUTE FUNCTION cafe_metricool_private.publication_immutable();
CREATE FUNCTION cafe_metricool_private.publication_binding_revoke() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 UPDATE cafe_metricool_private.publication_scopes SET enabled=false WHERE id=OLD.scope_id AND enabled;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION cafe_metricool_private.publication_binding_revoke() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER publication_binding_revoke BEFORE UPDATE OR DELETE ON cafe_metricool_private.publication_binding FOR EACH ROW EXECUTE FUNCTION cafe_metricool_private.publication_binding_revoke();
CREATE FUNCTION cafe_metricool_private.publication_current(p_plan uuid,p_scope uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s cafe_metricool_private.publication_scopes; d public.cs_character_promo_drafts; x public.cs_character_promo_delivery_plans; g jsonb; p jsonb; stamp timestamptz:=clock_timestamp();
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN NULL; END IF;
 SELECT * INTO x FROM public.cs_character_promo_delivery_plans WHERE id=p_plan;
 SELECT * INTO d FROM public.cs_character_promo_drafts WHERE id=x.promo_id;
 IF d.id IS NULL THEN RETURN NULL; END IF;
 PERFORM 1 FROM cafe_metricool_private.publication_binding WHERE name='cafe-routine-publication' AND enabled AND scope_id=p_scope FOR SHARE NOWAIT;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO s FROM cafe_metricool_private.publication_scopes WHERE id=p_scope FOR UPDATE NOWAIT;
 IF s.id IS NULL OR NOT s.enabled OR NOT EXISTS(SELECT 1 FROM cafe_metricool_private.publication_binding WHERE name='cafe-routine-publication' AND enabled AND scope_id=s.id) THEN RETURN NULL; END IF;
 g:=public.cs_cafe_generation_membership(d.id);p:=s.policy;
 IF g IS NULL OR g->>'enrollmentId' IS DISTINCT FROM s.enrollment_id::text OR g->>'manifestSha256' IS DISTINCT FROM s.manifest_sha256 OR g->>'actorId' IS DISTINCT FROM s.actor_id::text OR g->>'characterId' IS DISTINCT FROM d.character_id
 OR public.cs_cafe_metricool_is_admin(s.actor_id) IS DISTINCT FROM true THEN RETURN NULL; END IF;
 -- Stored owner-created policy only. Runtime cannot supply or expand this object.
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p) key) IS DISTINCT FROM ARRAY['accounts','authorizedAt','brandId','characterIds','ownerMessageIds','paidPromotion','reference','revoked','scope','userId','validUntil','version']::text[]
 OR p->'version' IS DISTINCT FROM '1'::jsonb OR p->'revoked' IS DISTINCT FROM 'false'::jsonb OR p->'paidPromotion' IS DISTINCT FROM 'false'::jsonb
 OR p->>'scope' IS DISTINCT FROM 'routine-cafe-persona-brand-promotions' OR p->>'brandId' IS DISTINCT FROM '7605217' OR p->>'userId' IS DISTINCT FROM '4174093'
 OR p->'accounts' IS DISTINCT FROM '[{"network":"facebook","accountId":"105363501666032"},{"network":"instagram","accountId":"cafesativainc"}]'::jsonb
 OR NOT coalesce(p->>'reference' ~ '^[A-Za-z0-9_.:-]{1,200}$',false)
 OR jsonb_typeof(p->'characterIds') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'ownerMessageIds') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
 IF jsonb_array_length(p->'characterIds') NOT BETWEEN 1 AND 20 OR jsonb_array_length(p->'ownerMessageIds') NOT BETWEEN 1 AND 20
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'ownerMessageIds') m WHERE jsonb_typeof(m)<>'string' OR (m#>>'{}') !~ '^Sentinel_[a-f0-9]{32}$')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'characterIds') m WHERE jsonb_typeof(m)<>'string' OR (m#>>'{}') !~ '^[a-z0-9][a-z0-9-]{0,99}$')
 OR NOT(p->'characterIds' ? d.character_id) OR d.character_id IN ('keith','keith-ingram')
 OR NOT ((x.network='facebook' AND x.account_id='105363501666032') OR (x.network='instagram' AND x.account_id='cafesativainc'))
 OR NOT coalesce((p->>'authorizedAt')::timestamptz<=stamp AND (p->>'validUntil')::timestamptz>stamp
 AND (p->>'validUntil')::timestamptz<=(g->>'expiresAt')::timestamptz
 AND x.scheduled_at=(g->>'scheduledAt')::timestamptz AND x.scheduled_at>stamp AND x.scheduled_at<(p->>'validUntil')::timestamptz,false) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('scopeId',s.id,'actorId',s.actor_id,'policy',p);
END $$;
REVOKE ALL ON FUNCTION cafe_metricool_private.publication_current(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION cafe_metricool_private.publication_authorized(p_plan uuid,p_digest text) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE a cafe_metricool_private.publication_authorities;
BEGIN
 SELECT * INTO a FROM cafe_metricool_private.publication_authorities WHERE plan_id=p_plan;
 IF NOT FOUND THEN RETURN true; END IF; -- exact legacy approvals unchanged
 RETURN a.schedule_digest=p_digest AND cafe_metricool_private.publication_current(p_plan,a.scope_id) IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION cafe_metricool_private.publication_authorized(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
-- Exact dependency pin: adds a conjunct, never relaxes existing QA/duplicate checks.
DO $$ DECLARE definition text; body text; BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO body,definition FROM pg_proc WHERE oid='cafe_metricool_private.authorized(uuid,text)'::regprocedure;
 IF md5(body)<>'b851290417cceb49a25ab085e75f4765' THEN RAISE EXCEPTION 'Exact repaired authorized dependency required'; END IF;
 IF position('AND public.cs_cafe_metricool_is_admin(a.approved_by)' IN definition)=0 THEN RAISE EXCEPTION 'Expected authority guard absent'; END IF;
 EXECUTE replace(definition,'AND public.cs_cafe_metricool_is_admin(a.approved_by)','AND cafe_metricool_private.publication_authorized(p,p_digest) AND public.cs_cafe_metricool_is_admin(a.approved_by)');
END $$;
CREATE FUNCTION public.cs_record_enrolled_cafe_authority(p_plan uuid,p_snapshot jsonb,p_digest text,p_source jsonb,p_assessment jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE promo uuid; sid uuid; current_scope jsonb; pol jsonb; stamp timestamptz; expiry timestamptz; evidence text; dest text; media text; result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required'; END IF;
 SELECT promo_id INTO promo FROM public.cs_character_promo_delivery_plans WHERE id=p_plan;
 IF promo IS NULL THEN RAISE EXCEPTION 'Unknown plan'; END IF;
 -- Matches existing claim draft→approval order; every later lock is NOWAIT.
 PERFORM 1 FROM public.cs_character_promo_drafts WHERE id=promo FOR UPDATE;
 PERFORM 1 FROM cafe_metricool_private.approvals WHERE plan_id=p_plan FOR UPDATE;
 SELECT scope_id INTO sid FROM cafe_metricool_private.publication_binding WHERE name='cafe-routine-publication' AND enabled;
 current_scope:=cafe_metricool_private.publication_current(p_plan,sid);
 IF current_scope IS NULL THEN RAISE EXCEPTION 'Standing scope unavailable'; END IF;
 pol:=current_scope->'policy';stamp:=clock_timestamp();
 IF jsonb_typeof(p_assessment) IS DISTINCT FROM 'object' OR octet_length(p_assessment::text)>4096 THEN RAISE EXCEPTION 'Bounded actual assessment required'; END IF;
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_assessment) key) IS DISTINCT FROM ARRAY['assessedAt','classification','containsSensitivePersonalData','evidenceRef','highImpact','paidPromotion','scheduleDigest']::text[]
 OR p_assessment->>'scheduleDigest' IS DISTINCT FROM p_digest OR p_assessment->>'classification' IS DISTINCT FROM 'routine-cafe-persona-brand-promotion'
 OR p_assessment->'highImpact' IS DISTINCT FROM 'false'::jsonb OR p_assessment->'paidPromotion' IS DISTINCT FROM 'false'::jsonb OR p_assessment->'containsSensitivePersonalData' IS DISTINCT FROM 'false'::jsonb
 OR NOT coalesce(p_assessment->>'evidenceRef' ~ '^[A-Za-z0-9_.:-]{1,200}$',false)
 OR NOT coalesce((p_assessment->>'assessedAt')::timestamptz BETWEEN stamp-interval '60 seconds' AND stamp,false) THEN RAISE EXCEPTION 'Exact fresh semantic assessment required'; END IF;
 -- Assessment is an explicitly trusted worker assertion, not independent SQL proof.
 evidence:=cafe_metricool_private.canonical_json(jsonb_build_object('policy',pol,'assessment',p_assessment));
 expiry:=least((pol->>'validUntil')::timestamptz,stamp+interval '24 hours',(p_snapshot->>'scheduledAt')::timestamptz-interval '60 seconds');
 dest:=encode(sha256(convert_to(cafe_metricool_private.canonical_json(jsonb_build_array(p_snapshot->>'brandId',p_snapshot->>'network',p_snapshot->>'accountId',p_snapshot->>'scheduledAt')),'UTF8')),'hex');
 media:=encode(sha256(convert_to(cafe_metricool_private.canonical_json(jsonb_build_array(p_snapshot->>'brandId',p_snapshot->>'network',p_snapshot->>'accountId',p_snapshot->>'videoSha256')),'UTF8')),'hex');
 INSERT INTO cafe_metricool_private.publication_authorities VALUES(p_plan,sid,p_digest);
 result:=public.cs_record_cafe_metricool_authority(p_plan,p_snapshot,p_digest,dest,media,p_source,(current_scope->>'actorId')::uuid,stamp,expiry,
 jsonb_build_object('reference','cafe-policy:'||encode(sha256(convert_to(evidence,'UTF8')),'hex'),'evidenceRecord',evidence,'scheduleDigest',p_digest,'authorizedAt',pol->>'authorizedAt','expiresAt',to_char(expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'revoked',false));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.cs_record_enrolled_cafe_authority(uuid,jsonb,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
RESET ROLE;
COMMIT;
