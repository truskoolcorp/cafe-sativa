-- Existing lock protocol rejects fixed-snapshot transactions. Synthetic only.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL ROLE service_role;
DO $$ BEGIN BEGIN PERFORM concierge_private.lock_v1(); RAISE EXCEPTION 'wrongly allowed snapshot isolation';
EXCEPTION WHEN SQLSTATE '25000' THEN RAISE NOTICE 'REVIEW PASS: REPEATABLE READ rejected'; END; END $$;
ROLLBACK;
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN BEGIN PERFORM concierge_private.lock_v1(); RAISE EXCEPTION 'wrongly allowed snapshot isolation';
EXCEPTION WHEN SQLSTATE '25000' THEN RAISE NOTICE 'REVIEW PASS: SERIALIZABLE rejected'; END; END $$;
ROLLBACK;
