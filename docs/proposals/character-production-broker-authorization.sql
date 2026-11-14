-- REVIEW ONLY. No roles/grants/activation. Requires production store proposal.
-- Broker must use this exact authoritative check, never worker-provided boolean.
-- Fail closed if slot expired or revoked, even for already-paid collection.
BEGIN;
CREATE FUNCTION public.character_production_broker_authorized(p_job jsonb)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS (
  SELECT 1 FROM character_production.jobs j
  JOIN character_production.approved_slots a ON a.key=j.key
  JOIN character_production.budgets b ON b.provider=j.provider AND b.period=j.period
  WHERE j.key=p_job->>'key' AND j.token=p_job->>'token'
   AND j.digest=p_job->>'digest' AND j.task=p_job->>'taskId'
   AND j.provider=p_job->>'provider' AND j.model=p_job->>'model'
   AND j.provider_binding_revision=p_job->>'providerBindingRevision'
   AND j.state IN ('submitted','pending_qa') AND a.enabled=true
   AND a.digest=j.digest AND a.slot=j.slot AND b.enabled=true
   AND b.cap_cents=(a.slot->>'periodCapCents')::bigint
   AND (a.slot->>'authorizationExpiresAt')::numeric>extract(epoch FROM clock_timestamp())*1000
 )
$$;
REVOKE ALL ON FUNCTION public.character_production_broker_authorized(jsonb) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_broker_authorized(jsonb) FROM %I',r);
  END IF;
 END LOOP;
END $$;
COMMIT;
