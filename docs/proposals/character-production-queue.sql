-- REVIEW PROPOSAL ONLY. Apply only after separately approved production-store
-- foundation and dedicated role/grant review. No cron, credentials or grants.
BEGIN;
CREATE TABLE character_production.schedules (
 key text PRIMARY KEY REFERENCES character_production.approved_slots(key),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 scheduled_at timestamptz NOT NULL,
 not_after timestamptz NOT NULL CHECK(not_after>scheduled_at),
 enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE character_production.schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.schedules FROM PUBLIC;
-- Only the trusted policy owner provisions/updates exact schedules. The worker
-- receives a read-only function, never table-write rights. Digest binds schedule
-- to an exact approved slot; changing script/cost/canon requires a new schedule.
CREATE FUNCTION public.character_production_due(p_provider text,p_model text,p_limit integer)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH observed AS (SELECT clock_timestamp() AS at), due AS (
  SELECT jsonb_build_object('slot',a.slot,'digest',a.digest,
   'scheduledAt',floor(extract(epoch FROM s.scheduled_at)*1000)::bigint,
   'notAfter',floor(extract(epoch FROM s.not_after)*1000)::bigint) AS row,
   s.scheduled_at,a.key
  FROM character_production.schedules s
  JOIN character_production.approved_slots a ON a.key=s.key AND a.digest=s.digest
  JOIN character_production.budgets b ON b.provider=a.slot->>'provider' AND b.period=a.slot->>'period'
  CROSS JOIN observed o
  WHERE s.enabled AND a.enabled AND b.enabled
   AND a.slot->>'provider'=p_provider AND a.slot->>'model'=p_model
   AND a.slot->>'period'=to_char(o.at AT TIME ZONE 'UTC','YYYY-MM')
   AND b.cap_cents=(a.slot->>'periodCapCents')::bigint
   AND s.scheduled_at<=o.at AND s.not_after>o.at
   AND s.not_after=to_timestamp((a.slot->>'authorizationExpiresAt')::numeric/1000)
   AND NOT EXISTS (SELECT 1 FROM character_production.jobs j WHERE j.key=a.key)
  ORDER BY s.scheduled_at,a.key LIMIT greatest(0,least(p_limit,25))
 ) SELECT jsonb_build_object('observedAt',floor(extract(epoch FROM o.at)*1000)::bigint,
  'rows',coalesce((SELECT jsonb_agg(d.row ORDER BY d.scheduled_at,d.key) FROM due d),'[]'::jsonb)) FROM observed o
$$;
REVOKE ALL ON FUNCTION public.character_production_due(text,text,integer) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON character_production.schedules FROM %I',r);
   EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_due(text,text,integer) FROM %I',r);
  END IF;
 END LOOP;
END $$;
COMMIT;
