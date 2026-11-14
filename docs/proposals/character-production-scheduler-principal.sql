-- OFFLINE PROPOSAL ONLY. Apply only under reviewed restricted ledger owner.
-- No grants, enrollment, installer, credentials or activation included.
BEGIN;
CREATE TABLE character_production.scheduler_enrollments(
 id uuid PRIMARY KEY, policy_id uuid NOT NULL REFERENCES character_production.planning_policies(id),
 policy_revision bigint NOT NULL CHECK(policy_revision>0), actor_id uuid NOT NULL,
 policy_snapshot jsonb NOT NULL CHECK(jsonb_typeof(policy_snapshot)='object'),
 candidate_snapshot jsonb NOT NULL CHECK(jsonb_typeof(candidate_snapshot)='array' AND jsonb_array_length(candidate_snapshot) BETWEEN 1 AND 32),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 owner_evidence_ref text NOT NULL CHECK(length(btrim(owner_evidence_ref)) BETWEEN 1 AND 500),
 approved_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 enabled boolean NOT NULL DEFAULT false, CHECK(expires_at>approved_at)
);
CREATE TABLE character_production.scheduler_candidates(
 enrollment_id uuid NOT NULL REFERENCES character_production.scheduler_enrollments(id),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 31),
 slot jsonb NOT NULL CHECK(jsonb_typeof(slot)='object'), digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 draft_id uuid NOT NULL UNIQUE, theme text NOT NULL, scheduled_at timestamptz NOT NULL,
 PRIMARY KEY(enrollment_id,ordinal)
);
-- Single named internal scheduler can use only its explicitly bound enrollment.
-- Binding is owner-provisioned, never caller-selected authority.
CREATE TABLE character_production.scheduler_binding(
 name text PRIMARY KEY CHECK(name='cafe-character-planner'),
 enrollment_id uuid NOT NULL UNIQUE REFERENCES character_production.scheduler_enrollments(id),
 enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE character_production.scheduler_binding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.scheduler_binding FROM PUBLIC;
ALTER TABLE character_production.scheduler_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.scheduler_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.scheduler_enrollments,character_production.scheduler_candidates FROM PUBLIC;
CREATE FUNCTION character_production.scheduler_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='scheduler_enrollments' AND TG_OP='UPDATE' AND OLD.enabled AND NOT NEW.enabled
 AND (to_jsonb(OLD)-'enabled')=(to_jsonb(NEW)-'enabled') THEN
  UPDATE character_production.approved_slots SET enabled=false WHERE key IN
   (SELECT c.slot->>'key' FROM character_production.scheduler_candidates c WHERE c.enrollment_id=OLD.id);
  UPDATE character_production.schedules SET enabled=false WHERE key IN
   (SELECT c.slot->>'key' FROM character_production.scheduler_candidates c WHERE c.enrollment_id=OLD.id);
  UPDATE character_production.qa_slot_bindings SET enabled=false WHERE slot_key IN
   (SELECT c.slot->>'key' FROM character_production.scheduler_candidates c WHERE c.enrollment_id=OLD.id);
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'Scheduler authority immutable; revoke enrollment or create reviewed successor';
END $$;
REVOKE ALL ON FUNCTION character_production.scheduler_immutable() FROM PUBLIC;
CREATE TRIGGER scheduler_enrollment_immutable BEFORE UPDATE OR DELETE ON character_production.scheduler_enrollments FOR EACH ROW EXECUTE FUNCTION character_production.scheduler_immutable();
CREATE TRIGGER scheduler_candidate_immutable BEFORE UPDATE OR DELETE ON character_production.scheduler_candidates FOR EACH ROW EXECUTE FUNCTION character_production.scheduler_immutable();
-- Shared guard locks policy first, then enrollment, matching planner ordering.
-- source-owner provisioning must use same order when changing both relations.
-- Any binding removal/disable/retarget irreversibly revokes the old enrollment.
CREATE FUNCTION character_production.scheduler_binding_revoke() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 UPDATE character_production.scheduler_enrollments SET enabled=false WHERE id=OLD.enrollment_id AND enabled;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scheduler_binding_revoke BEFORE UPDATE OR DELETE ON character_production.scheduler_binding FOR EACH ROW EXECUTE FUNCTION character_production.scheduler_binding_revoke();
REVOKE ALL ON FUNCTION character_production.scheduler_binding_revoke() FROM PUBLIC;
CREATE FUNCTION character_production.scheduler_current(p_id uuid)
RETURNS character_production.scheduler_enrollments LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e character_production.scheduler_enrollments; p character_production.planning_policies; pid uuid;
BEGIN
 SELECT policy_id INTO pid FROM character_production.scheduler_enrollments WHERE id=p_id;
 IF pid IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO p FROM character_production.planning_policies WHERE id=pid FOR UPDATE;
 SELECT * INTO e FROM character_production.scheduler_enrollments WHERE id=p_id FOR UPDATE;
 IF e.id IS NULL OR NOT EXISTS(SELECT 1 FROM character_production.scheduler_binding b
 WHERE b.name='cafe-character-planner' AND b.enabled AND b.enrollment_id=e.id)
 OR e.candidate_snapshot IS DISTINCT FROM
 (SELECT coalesce(jsonb_agg(jsonb_build_object('ordinal',c.ordinal,'slot',c.slot,'digest',c.digest,'draftId',c.draft_id,'theme',c.theme,'scheduledAt',to_char(c.scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY c.ordinal),'[]'::jsonb)
 FROM character_production.scheduler_candidates c WHERE c.enrollment_id=e.id)
 OR NOT e.enabled OR NOT p.enabled OR e.policy_revision<>p.revision
 OR e.policy_snapshot IS DISTINCT FROM to_jsonb(p) OR e.approved_at>clock_timestamp()
 OR e.expires_at<=clock_timestamp() OR p.expires_at<=clock_timestamp() OR e.expires_at>p.expires_at
 OR EXISTS(SELECT 1 FROM character_production.scheduler_candidates c WHERE c.enrollment_id=e.id
 AND (c.scheduled_at<e.approved_at OR c.scheduled_at>=e.expires_at OR
 (CASE WHEN jsonb_typeof(c.slot->'authorizationExpiresAt')='number'
 AND c.slot->>'authorizationExpiresAt' ~ '^[0-9]{1,16}$'
 THEN (c.slot->>'authorizationExpiresAt')::numeric>extract(epoch FROM c.scheduled_at)*1000
 AND (c.slot->>'authorizationExpiresAt')::numeric<=extract(epoch FROM e.expires_at)*1000
 ELSE false END) IS NOT TRUE))
 OR public.cs_cafe_metricool_is_admin(e.actor_id) IS DISTINCT FROM true THEN RETURN NULL; END IF;
 RETURN e;
END $$;
REVOKE ALL ON FUNCTION character_production.scheduler_current(uuid) FROM PUBLIC;
CREATE FUNCTION public.character_production_scheduler_context(p_enrollment uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e character_production.scheduler_enrollments;
BEGIN
 e:=character_production.scheduler_current(p_enrollment); IF e.id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('enrollmentId',e.id,'actorId',e.actor_id,'manifestSha256',e.manifest_sha256,
 'policy',public.character_production_planning_policy(e.policy_id),'candidates',
 (SELECT coalesce(jsonb_agg(jsonb_build_object('ordinal',c.ordinal,'slot',c.slot,'digest',c.digest,'draftId',c.draft_id,'theme',c.theme,'scheduledAt',to_char(c.scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY c.ordinal),'[]'::jsonb)
 FROM character_production.scheduler_candidates c WHERE c.enrollment_id=e.id));
END $$;
CREATE FUNCTION public.character_production_scheduler_reconciled(p_enrollment uuid,p_ordinal integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e character_production.scheduler_enrollments; c character_production.scheduler_candidates;
BEGIN
 e:=character_production.scheduler_current(p_enrollment); IF e.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO c FROM character_production.scheduler_candidates WHERE enrollment_id=e.id AND ordinal=p_ordinal;
 IF c.enrollment_id IS NULL THEN RETURN NULL; END IF;
 RETURN public.character_production_planned_draft(c.draft_id,c.slot,c.digest,c.theme);
END $$;
CREATE FUNCTION public.character_production_scheduler_plan(p_enrollment uuid,p_ordinal integer,p_validation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e character_production.scheduler_enrollments; c character_production.scheduler_candidates;
BEGIN
 e:=character_production.scheduler_current(p_enrollment); IF e.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO c FROM character_production.scheduler_candidates WHERE enrollment_id=e.id AND ordinal=p_ordinal;
 IF c.enrollment_id IS NULL THEN RETURN NULL; END IF;
 RETURN public.character_production_plan(c.slot,c.digest,jsonb_build_object('version',1,'draftId',c.draft_id,'scheduledAt',to_char(c.scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'theme',c.theme,'validation',p_validation),e.policy_id,e.policy_revision,e.actor_id);
END $$;
REVOKE ALL ON FUNCTION public.character_production_scheduler_context(uuid),public.character_production_scheduler_reconciled(uuid,integer),public.character_production_scheduler_plan(uuid,integer,jsonb) FROM PUBLIC;
COMMIT;
