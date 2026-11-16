-- OFFLINE owner-only proposal. No installer, grants, data or activation.
-- Uses existing atomic planner/draft writer and selected-token authority.
BEGIN;
DO $$ BEGIN IF current_user<>'character_production_owner' THEN RAISE EXCEPTION 'Restricted owner required'; END IF; END $$;
CREATE TABLE character_production.binding_snapshots(
 slot_key text PRIMARY KEY REFERENCES character_production.planning_records(slot_key),
 slot_digest text NOT NULL CHECK(slot_digest~'^[a-f0-9]{64}$'),
 snapshot_text text NOT NULL CHECK(octet_length(snapshot_text) BETWEEN 2 AND 32768),
 snapshot_sha256 text NOT NULL CHECK(snapshot_sha256~'^[a-f0-9]{64}$'),
 CHECK(snapshot_sha256=encode(sha256(convert_to(snapshot_text,'UTF8')),'hex'))
);
ALTER TABLE character_production.binding_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.binding_snapshots FROM PUBLIC;
CREATE FUNCTION character_production.binding_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Original media binding immutable'; END $$;
CREATE TRIGGER binding_snapshot_immutable BEFORE UPDATE OR DELETE ON character_production.binding_snapshots FOR EACH ROW EXECUTE FUNCTION character_production.binding_snapshot_immutable();
REVOKE ALL ON FUNCTION character_production.binding_snapshot_immutable() FROM PUBLIC;
CREATE FUNCTION public.character_production_plan_bound(p_slot jsonb,p_digest text,p_plan jsonb,p_policy_id uuid,p_policy_revision bigint,p_actor uuid,p_snapshot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s jsonb; h text; result jsonb; prior character_production.binding_snapshots;
BEGIN
 IF p_snapshot IS NULL OR octet_length(p_snapshot) NOT BETWEEN 2 AND 32768 THEN RETURN NULL; END IF;
 s:=p_snapshot::jsonb;
 IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(s) k) IS DISTINCT FROM ARRAY['account','image','speech','version']::text[] OR s->>'version' IS DISTINCT FROM '1' THEN RETURN NULL; END IF;
 IF s#>>'{account,model}' IS DISTINCT FROM 'avatar_iv' OR s#>>'{image,characterId}' IS DISTINCT FROM p_slot->>'characterId' OR s#>>'{image,canonicalRevision}' IS DISTINCT FROM p_slot->>'canonicalRevision' OR s#>>'{image,portraitSha256}' IS DISTINCT FROM p_slot->>'portraitSha256' OR s#>>'{image,audio,voiceId}' IS DISTINCT FROM p_slot->>'voiceId' OR s#>>'{image,audio,scriptSha256}' IS DISTINCT FROM encode(sha256(convert_to(p_slot->>'script','UTF8')),'hex') THEN RETURN NULL; END IF;
 h:=encode(sha256(convert_to(p_snapshot,'UTF8')),'hex');
 IF p_plan#>>'{validation,evidenceRef}' IS DISTINCT FROM 'binding-snapshot-sha256:'||h THEN RETURN NULL; END IF;
 -- Serialize on existing policy lock before checking prior provenance. Planner
 -- takes this same lock; a concurrent wrapper cannot observe half a commit.
 PERFORM 1 FROM character_production.planning_policies WHERE id=p_policy_id FOR UPDATE;
 SELECT * INTO prior FROM character_production.binding_snapshots WHERE slot_key=p_slot->>'key';
 IF FOUND AND (prior.slot_digest IS DISTINCT FROM p_digest OR prior.snapshot_text IS DISTINCT FROM p_snapshot OR prior.snapshot_sha256 IS DISTINCT FROM h) THEN RETURN NULL; END IF;
 result:=public.character_production_plan(p_slot,p_digest,p_plan,p_policy_id,p_policy_revision,p_actor);
 IF result IS NULL THEN RETURN NULL; END IF;
 IF prior.slot_key IS NULL THEN
  IF result->'replayed' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Existing plan has no original snapshot'; END IF;
  INSERT INTO character_production.binding_snapshots VALUES(p_slot->>'key',p_digest,p_snapshot,h);
 END IF;
 RETURN result||jsonb_build_object('snapshotSha256',h);
END $$;
REVOKE ALL ON FUNCTION public.character_production_plan_bound(jsonb,text,jsonb,uuid,bigint,uuid,text) FROM PUBLIC;
CREATE FUNCTION public.character_production_selected_binding(p_enrollment uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected jsonb; s character_production.binding_snapshots;
BEGIN
 selected:=public.character_production_recurring_selected(p_enrollment,p_token);
 IF selected IS NULL OR selected->>'phase' NOT IN ('generate','collect','qa') THEN RETURN NULL; END IF;
 SELECT * INTO s FROM character_production.binding_snapshots WHERE slot_key=selected->>'key' AND slot_digest=selected->>'digest';
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- QA additionally retains exact pending_qa job, pristine enrolled draft and
 -- unconsumed original ingestion eligibility from recurring_selected.
 -- Existing selected reader verifies the exact enrolled slot, enabled authority
 -- and original submitted job token/task/binding for collection. Never read a
 -- replacement manifest or select another pending job.
 RETURN jsonb_build_object('selected',selected,'slot',(SELECT r.slot FROM character_production.planning_records r WHERE r.slot_key=s.slot_key AND r.digest=s.slot_digest),'snapshotText',s.snapshot_text,'snapshotSha256',s.snapshot_sha256);
END $$;
REVOKE ALL ON FUNCTION public.character_production_selected_binding(uuid,uuid) FROM PUBLIC;
DO $$ DECLARE r record; own oid:='character_production_owner'::regrole; BEGIN
 FOR r IN SELECT relowner owner,relacl acl FROM pg_class WHERE oid='character_production.binding_snapshots'::regclass
 UNION ALL SELECT proowner,proacl FROM pg_proc WHERE oid IN('character_production.binding_snapshot_immutable()'::regprocedure,'public.character_production_plan_bound(jsonb,text,jsonb,uuid,bigint,uuid,text)'::regprocedure,'public.character_production_selected_binding(uuid,uuid)'::regprocedure)
 LOOP IF r.owner<>own OR EXISTS(SELECT 1 FROM aclexplode(r.acl) WHERE grantee<>own) THEN RAISE EXCEPTION 'Owner-only binding source required'; END IF; END LOOP;
END $$;
ROLLBACK;

