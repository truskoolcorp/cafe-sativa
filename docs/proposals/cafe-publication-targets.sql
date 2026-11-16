-- OFFLINE source only. No runtime grants, cadence rows, activation or old post edits.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
SET LOCAL ROLE character_production_owner;
DO $$ DECLARE s text; BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.cs_cafe_generation_membership(uuid)'::regprocedure) IS DISTINCT FROM '08ca37b1ab315b1796194570806747f1' THEN RAISE EXCEPTION 'Exact reviewed timing dependency required'; END IF;
 SELECT pg_get_functiondef('public.cs_cafe_generation_membership(uuid)'::regprocedure) INTO s;
 IF position('''draftId'',c.draft_id,''scheduledAt''' IN s)=0 OR position('''slotDigest''' IN s)>0 THEN RAISE EXCEPTION 'Exact generation membership required'; END IF;
 EXECUTE replace(s,'''draftId'',c.draft_id,''scheduledAt''','''draftId'',c.draft_id,''slotDigest'',c.digest,''scheduledAt''');
END $$;
SET LOCAL ROLE cafe_metricool_owner;
CREATE TABLE cafe_metricool_private.publication_cadences(
 scope_id uuid PRIMARY KEY REFERENCES cafe_metricool_private.publication_scopes(id),
 timezone text NOT NULL CHECK(timezone='America/Chicago'),
 local_times time[] NOT NULL CHECK(cardinality(local_times) BETWEEN 1 AND 4 AND array_position(local_times,NULL) IS NULL),
 min_lead_seconds integer NOT NULL CHECK(min_lead_seconds BETWEEN 300 AND 3600),
 max_horizon_seconds integer NOT NULL CHECK(max_horizon_seconds BETWEEN 3600 AND 86400),
 enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE cafe_metricool_private.publication_targets(
 promo_id uuid PRIMARY KEY REFERENCES public.cs_character_promo_drafts(id),
 scope_id uuid NOT NULL REFERENCES cafe_metricool_private.publication_scopes(id),
 enrollment_id uuid NOT NULL, manifest_sha256 text NOT NULL CHECK(manifest_sha256~'^[a-f0-9]{64}$'),
 slot_digest text NOT NULL CHECK(slot_digest~'^[a-f0-9]{64}$'),
 generation_due_at timestamptz NOT NULL, publish_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(publish_at>generation_due_at AND publish_at>created_at)
);
ALTER TABLE cafe_metricool_private.publication_cadences ENABLE ROW LEVEL SECURITY;
ALTER TABLE cafe_metricool_private.publication_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cafe_metricool_private.publication_cadences,cafe_metricool_private.publication_targets FROM PUBLIC;
CREATE TRIGGER publication_cadence_immutable BEFORE UPDATE OR DELETE ON cafe_metricool_private.publication_cadences FOR EACH ROW EXECUTE FUNCTION cafe_metricool_private.publication_immutable();
CREATE TRIGGER publication_target_immutable BEFORE UPDATE OR DELETE ON cafe_metricool_private.publication_targets FOR EACH ROW EXECUTE FUNCTION cafe_metricool_private.publication_immutable();
-- Disabled cadence is NOT a fallback to old timing. Revoke its standing scope.
CREATE FUNCTION cafe_metricool_private.publication_schedule(g jsonb,p_draft uuid,p_scope uuid) RETURNS timestamptz
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c cafe_metricool_private.publication_cadences; t cafe_metricool_private.publication_targets;
BEGIN
 SELECT * INTO c FROM cafe_metricool_private.publication_cadences WHERE scope_id=p_scope;
 IF NOT FOUND THEN RETURN (g->>'scheduledAt')::timestamptz; END IF;
 IF NOT c.enabled THEN RETURN NULL; END IF;
 SELECT * INTO t FROM cafe_metricool_private.publication_targets WHERE promo_id=p_draft AND scope_id=p_scope;
 IF NOT FOUND OR t.enrollment_id::text IS DISTINCT FROM g->>'enrollmentId' OR t.manifest_sha256 IS DISTINCT FROM g->>'manifestSha256' OR t.slot_digest IS DISTINCT FROM g->>'slotDigest' OR t.generation_due_at IS DISTINCT FROM (g->>'scheduledAt')::timestamptz THEN RETURN NULL; END IF;
 RETURN t.publish_at;
END $$;
REVOKE ALL ON FUNCTION cafe_metricool_private.publication_schedule(jsonb,uuid,uuid) FROM PUBLIC;
DO $$ DECLARE s text; BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='cafe_metricool_private.publication_current(uuid,uuid)'::regprocedure) IS DISTINCT FROM '89088b4f759d00040726be14e14218ef' THEN RAISE EXCEPTION 'Exact reviewed timing dependency required'; END IF;
 SELECT pg_get_functiondef('cafe_metricool_private.publication_current(uuid,uuid)'::regprocedure) INTO s;
 IF position('x.scheduled_at=(g->>''scheduledAt'')::timestamptz' IN s)=0 THEN RAISE EXCEPTION 'Exact publication timing dependency required'; END IF;
 EXECUTE replace(s,'x.scheduled_at=(g->>''scheduledAt'')::timestamptz','x.scheduled_at=cafe_metricool_private.publication_schedule(g,d.id,s.id)');
END $$;
CREATE FUNCTION public.cs_resolve_cafe_publication_target(p_draft uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sc cafe_metricool_private.publication_scopes; cadence cafe_metricool_private.publication_cadences;
 d public.cs_character_promo_drafts; p jsonb; g jsonb; at timestamptz:=clock_timestamp(); target timestamptz; until_at timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN NULL; END IF;
 SELECT * INTO d FROM public.cs_character_promo_drafts WHERE id=p_draft FOR UPDATE;
 IF d.id IS NULL THEN RETURN NULL; END IF;
 PERFORM 1 FROM cafe_metricool_private.publication_binding WHERE name='cafe-routine-publication' AND enabled FOR SHARE NOWAIT;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT s.* INTO sc FROM cafe_metricool_private.publication_scopes s JOIN cafe_metricool_private.publication_binding b ON b.scope_id=s.id WHERE b.name='cafe-routine-publication' AND b.enabled AND s.enabled FOR UPDATE OF s NOWAIT;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO cadence FROM cafe_metricool_private.publication_cadences WHERE scope_id=sc.id AND enabled;
 IF NOT FOUND THEN RETURN NULL; END IF;
 g:=public.cs_cafe_generation_membership(d.id);p:=sc.policy;at:=clock_timestamp();
 IF g IS NULL OR g->>'enrollmentId' IS DISTINCT FROM sc.enrollment_id::text OR g->>'manifestSha256' IS DISTINCT FROM sc.manifest_sha256 OR g->>'actorId' IS DISTINCT FROM sc.actor_id::text OR g->>'characterId' IS DISTINCT FROM d.character_id OR NOT coalesce(g->>'slotDigest' ~ '^[a-f0-9]{64}$',false) OR public.cs_cafe_metricool_is_admin(sc.actor_id) IS DISTINCT FROM true THEN RETURN NULL; END IF;
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
 OR NOT coalesce((p->>'authorizedAt')::timestamptz<=at AND (p->>'validUntil')::timestamptz>at AND (p->>'validUntil')::timestamptz<=(g->>'expiresAt')::timestamptz,false) THEN RETURN NULL; END IF;
 -- Target selection is not QA approval. Require existing actual QA and no failed
 -- check; downstream authority writer still performs full exact source checks.
 IF d.status IS DISTINCT FROM 'script_approved' OR d.video_asset_path IS NULL OR d.voice_approved_at IS NULL OR d.video_qa_approved_at IS NULL OR d.voice_approved_at>at OR d.video_qa_approved_at>at
 OR substring(d.video_asset_path FROM '([a-f0-9]{64})[.]mp4$') IS NULL
 OR EXISTS(SELECT 1 FROM public.cs_character_promo_qa_checks q WHERE q.promo_id=d.id AND q.video_sha256=substring(d.video_asset_path FROM '([a-f0-9]{64})[.]mp4$') AND q.result IS DISTINCT FROM 'pass')
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety','third_party_watermark']) n WHERE NOT EXISTS(SELECT 1 FROM public.cs_character_promo_qa_checks q WHERE q.promo_id=d.id AND q.check_name=n AND q.result='pass' AND q.video_sha256=substring(d.video_asset_path FROM '([a-f0-9]{64})[.]mp4$') AND q.created_at<=at)) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM cafe_metricool_private.publication_targets WHERE promo_id=d.id) THEN
  target:=cafe_metricool_private.publication_schedule(g,d.id,sc.id);
  IF target<=at OR target>=(p->>'validUntil')::timestamptz THEN RETURN NULL; END IF;
  RETURN target;
 END IF;
 -- Existing delivery plans/legacy introductions are never edited or replayed.
 IF EXISTS(SELECT 1 FROM public.cs_character_promo_delivery_plans WHERE promo_id=d.id) OR (g->>'scheduledAt')::timestamptz>at THEN RETURN NULL; END IF;
 until_at:=least(at+make_interval(secs=>cadence.max_horizon_seconds),(p->>'validUntil')::timestamptz,(g->>'expiresAt')::timestamptz);
 SELECT min(candidate) INTO target FROM (
 SELECT (((at AT TIME ZONE cadence.timezone)::date+day)+t) AT TIME ZONE cadence.timezone candidate
 FROM generate_series(0,2) day CROSS JOIN unnest(cadence.local_times) t
 ) times WHERE candidate>=at+make_interval(secs=>cadence.min_lead_seconds) AND candidate<until_at AND candidate>(g->>'scheduledAt')::timestamptz;
 IF target IS NULL THEN RETURN NULL; END IF;
 INSERT INTO cafe_metricool_private.publication_targets(promo_id,scope_id,enrollment_id,manifest_sha256,slot_digest,generation_due_at,publish_at)
 VALUES(d.id,sc.id,sc.enrollment_id,sc.manifest_sha256,g->>'slotDigest',(g->>'scheduledAt')::timestamptz,target);
 RETURN target;
END $$;
REVOKE ALL ON FUNCTION public.cs_resolve_cafe_publication_target(uuid) FROM PUBLIC;
DO $$ DECLARE r record; own oid:='cafe_metricool_owner'::regrole; BEGIN
 FOR r IN SELECT relowner owner,relacl acl FROM pg_class WHERE oid IN('cafe_metricool_private.publication_cadences'::regclass,'cafe_metricool_private.publication_targets'::regclass)
 UNION ALL SELECT proowner,proacl FROM pg_proc WHERE oid IN('cafe_metricool_private.publication_schedule(jsonb,uuid,uuid)'::regprocedure,'public.cs_resolve_cafe_publication_target(uuid)'::regprocedure)
 LOOP IF r.owner<>own OR EXISTS(SELECT 1 FROM aclexplode(r.acl) WHERE grantee<>own) THEN RAISE EXCEPTION 'Owner-only timing proposal required'; END IF; END LOOP;
END $$;
RESET ROLE;
ROLLBACK;
