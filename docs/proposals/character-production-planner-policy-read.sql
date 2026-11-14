-- DORMANT owner-context read-only proposal. No grants, rows, routes or activation.
-- Requires reviewed planner tables. owner_evidence.evidenceRef must point to the
-- actual owner approval; absence fails closed. Do not synthesize an approval.
BEGIN;
CREATE FUNCTION public.character_production_planning_policy(p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('observedAt',floor(extract(epoch FROM clock_timestamp())*1000)::bigint,
 'policy',jsonb_build_object('id',p.id,'revision',p.revision,'enabled',p.enabled,
 'expiresAt',floor(extract(epoch FROM p.expires_at)*1000)::bigint,
 'ownerEvidenceRef',p.owner_evidence->>'evidenceRef','characters',p.characters,
 'themes',p.themes,'capCents',p.cap_cents,'accountId',p.account_id))
 FROM character_production.planning_policies p
 WHERE p.id=p_id AND p.enabled AND p.expires_at>clock_timestamp()
 AND jsonb_typeof(p.owner_evidence->'evidenceRef')='string'
 AND length(btrim(p.owner_evidence->>'evidenceRef')) BETWEEN 1 AND 500
$$;
REVOKE ALL ON FUNCTION public.character_production_planning_policy(uuid) FROM PUBLIC;
COMMIT;
