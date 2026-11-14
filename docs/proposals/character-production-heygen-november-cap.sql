-- SEPARATE REVIEW TEMPLATE, NOT APPLIED. Execute under existing owner only via
-- separately reviewed temporary-owner wrapper. No evidence, slots or activation.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s';
DO $$ DECLARE b character_production.budgets; j character_production.jobs; BEGIN
 SELECT * INTO b FROM character_production.budgets WHERE provider='heygen' AND period='2026-11' FOR UPDATE;
 IF NOT FOUND OR b.cap_cents<>40 OR b.reserved_cents<>35 THEN RAISE EXCEPTION 'Original budget differs; reconcile'; END IF;
 SELECT * INTO j FROM character_production.jobs WHERE key='zaria-gallery-image-canary-20261114' FOR UPDATE;
 IF NOT FOUND OR j.provider<>'heygen' OR j.period<>'2026-11' OR j.cost<>35 OR j.state<>'pending_qa'
 OR j.task IS DISTINCT FROM 'c8246007ce21cee14e38f409b4492967' OR j.digest<>'01931ca6d67b17badbf9c89ee8841ebdba11d73f0390f90ed95c842da887a6f3'
 OR j.sha IS DISTINCT FROM '018615557e88f67a26ee97136376bfdde215fe2cd2ca6e274c6d48825c116658' OR j.bytes IS DISTINCT FROM 4023955
 OR j.slot->>'periodCapCents' IS DISTINCT FROM '40'
 OR (SELECT count(*) FROM character_production.jobs WHERE provider='heygen' AND period='2026-11')<>1 THEN RAISE EXCEPTION 'Original job differs; reconcile'; END IF;
 UPDATE character_production.budgets SET cap_cents=2000 WHERE provider='heygen' AND period='2026-11';
 -- Original35 remains reserved. Original slot/job/auth expiry and all history are unchanged.
END $$;
ROLLBACK; -- Replace only through separately reviewed exact application transaction.
