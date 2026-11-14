-- OFFLINE ONLY: install as existing reviewed function owner. No grants or activation.
BEGIN;
CREATE FUNCTION public.character_production_observe_receipt(p_key text,p_token text,p_digest text,p_task text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j character_production.jobs; a jsonb;
BEGIN
 SELECT * INTO j FROM character_production.jobs WHERE key=p_key AND token=p_token AND digest=p_digest FOR UPDATE;
 IF j.key IS NULL OR j.state NOT IN ('submitting','unknown') THEN RETURN false; END IF;
 IF p_task IS NULL THEN
  IF j.state<>'submitting' OR j.task IS NOT NULL THEN RETURN false; END IF;
  a:=public.character_production_authorization(j.key,j.slot->>'authorizationId');
  RETURN coalesce(a->'slot'=j.slot AND a->>'digest'=j.digest AND a->'enabled'='true'::jsonb
   AND (j.slot->>'authorizationExpiresAt')::numeric>extract(epoch FROM clock_timestamp())*1000
   AND j.period=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM'),false);
 END IF;
 -- Evidence may arrive after authority expires: retain it, never promote or spend.
 IF p_task !~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$' THEN RETURN false; END IF;
 UPDATE character_production.jobs SET task=p_task
 WHERE key=p_key AND token=p_token AND digest=p_digest AND state IN ('submitting','unknown') AND (task IS NULL OR task=p_task);
 RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION public.character_production_submitted(p_key text,p_token text,p_digest text,p_task text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_task IS NULL OR p_task !~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$' THEN RETURN false; END IF;
 UPDATE character_production.jobs SET state='submitted',task=p_task
 WHERE key=p_key AND token=p_token AND digest=p_digest AND state='submitting' AND (task IS NULL OR task=p_task);
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.character_production_observe_receipt(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
