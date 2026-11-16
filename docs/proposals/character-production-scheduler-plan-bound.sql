-- SOURCE-ONLY proposal. No runtime grants or activation.
BEGIN;
DO $$ BEGIN
 IF current_user <> 'character_production_owner' THEN RAISE EXCEPTION 'Restricted owner required'; END IF;
END $$;
CREATE FUNCTION public.character_production_scheduler_plan_bound(p_enrollment uuid,p_ordinal integer,p_validation jsonb,p_snapshot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e character_production.scheduler_enrollments; c character_production.scheduler_candidates;
BEGIN
 e:=character_production.scheduler_current(p_enrollment); IF e.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO c FROM character_production.scheduler_candidates WHERE enrollment_id=e.id AND ordinal=p_ordinal;
 IF c.enrollment_id IS NULL THEN RETURN NULL; END IF;
 -- Actor, slot, policy and draft are resolved from immutable current enrollment,
 -- never supplied by an unattended caller. Existing planner+snapshot atomicity
 -- and current policy/cap/cadence checks remain authoritative.
 RETURN public.character_production_plan_bound(c.slot,c.digest,
  jsonb_build_object('version',1,'draftId',c.draft_id,'scheduledAt',to_char(c.scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'theme',c.theme,'validation',p_validation),
  e.policy_id,e.policy_revision,e.actor_id,p_snapshot);
END $$;
REVOKE ALL ON FUNCTION public.character_production_scheduler_plan_bound(uuid,integer,jsonb,text) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid='public.character_production_scheduler_plan_bound(uuid,integer,jsonb,text)'::regprocedure),acldefault('f',(SELECT oid FROM pg_roles WHERE rolname=current_user)))) a WHERE a.grantee<>(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN RAISE EXCEPTION 'Unexpected bound planner grant'; END IF;
END $$;
ROLLBACK;
