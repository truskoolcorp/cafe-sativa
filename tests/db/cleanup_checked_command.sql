-- DISPOSABLE CI FIXTURE ONLY. These are synthetic timeout/batch values, not policy.
-- Do not install or schedule this file.
-- Exercises the exact combined first-install candidate. Production timings,
-- batch and cadence remain unselected; this is not release/schedule approval.
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';
DO $cleanup_job$
DECLARE started timestamptz := clock_timestamp(); result jsonb; heartbeat timestamptz;
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_proc f
   WHERE f.oid='concierge_private.maintain_v1(integer)'::regprocedure
     AND f.proowner=(current_user::regrole)::oid AND NOT f.prosecdef
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_class c
       WHERE c.oid IN ('concierge_private.requests'::regclass,'concierge_private.policy'::regclass,'concierge_private.lifecycle'::regclass)
         AND c.relowner<>f.proowner))
 THEN RAISE EXCEPTION 'cleanup requires its reviewed object owner' USING ERRCODE='42501'; END IF;
 result:=concierge_private.maintain_v1(100);
 IF result IS NULL OR jsonb_typeof(result)<>'object' OR result?'error'
   OR NOT (result?'processed') OR jsonb_typeof(result->'processed')<>'number'
 THEN RAISE EXCEPTION 'cleanup did not return success' USING ERRCODE='55000'; END IF;
 IF NOT (result?'inspected') OR jsonb_typeof(result->'inspected')<>'number' OR (result->>'inspected')::integer NOT BETWEEN 0 AND 100
 THEN RAISE EXCEPTION 'cleanup exceeded its reviewed inspection limit' USING ERRCODE='55000'; END IF;
 IF NOT (result?'sweep_completed') OR jsonb_typeof(result->'sweep_completed')<>'boolean'
 THEN RAISE EXCEPTION 'cleanup omitted sweep status' USING ERRCODE='55000'; END IF;
 IF (result->>'processed')::integer NOT BETWEEN 0 AND (result->>'inspected')::integer
 THEN RAISE EXCEPTION 'cleanup exceeded its reviewed row limit' USING ERRCODE='55000'; END IF;
 SELECT last_cleanup_at INTO heartbeat FROM concierge_private.lifecycle WHERE singleton;
 IF heartbeat IS NULL OR heartbeat<started OR heartbeat>clock_timestamp()
 THEN RAISE EXCEPTION 'cleanup did not advance its heartbeat' USING ERRCODE='55000'; END IF;
END $cleanup_job$;
COMMIT;
