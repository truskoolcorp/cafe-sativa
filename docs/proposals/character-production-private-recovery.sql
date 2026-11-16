-- OFFLINE ONLY. Additive one-use text recovery; no configuration, grants or spend.
-- Original occurrence and binding stay immutable. Installation requires separate
-- action-time approval. Default rollback. No caller-selected key or authority.
BEGIN;
CREATE TABLE character_production.private_text_recovery(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 occurrence_id uuid NOT NULL UNIQUE REFERENCES character_production.preparation_occurrences(id),
 budget_id uuid NOT NULL REFERENCES character_production.text_replenishment_budgets(id),
 owner_message_ids text[] NOT NULL CHECK(cardinality(owner_message_ids) BETWEEN 1 AND 20),
 authorized_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 enabled boolean NOT NULL DEFAULT false, claimed boolean NOT NULL DEFAULT false,
 claimed_at timestamptz,
 CHECK(occurrence_id='de8674ec-61d8-4a79-aca5-a258feb6950b'::uuid),
 CHECK(budget_id='2941c16d-1334-4725-959c-a61c51de2b71'::uuid),
 CHECK(expires_at='2026-11-17T06:00:00Z'::timestamptz AND authorized_at>='2026-11-16T18:47:44Z'::timestamptz AND authorized_at<expires_at),
 CHECK(claimed=(claimed_at IS NOT NULL))
);
ALTER TABLE character_production.private_text_recovery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.private_text_recovery FROM PUBLIC;
CREATE FUNCTION character_production.private_text_recovery_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
  IF to_jsonb(OLD)-'enabled'=to_jsonb(NEW)-'enabled' AND OLD.enabled AND NOT NEW.enabled THEN RETURN NEW; END IF;
  IF to_jsonb(OLD)-'claimed'-'claimed_at'=to_jsonb(NEW)-'claimed'-'claimed_at' AND NOT OLD.claimed AND NEW.claimed AND NEW.claimed_at IS NOT NULL THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Private recovery immutable; no reset or successor';
END $$;
CREATE TRIGGER private_text_recovery_immutable BEFORE UPDATE OR DELETE ON character_production.private_text_recovery FOR EACH ROW EXECUTE FUNCTION character_production.private_text_recovery_immutable();
REVOKE ALL ON FUNCTION character_production.private_text_recovery_immutable() FROM PUBLIC;
CREATE FUNCTION public.character_production_private_recovery_context() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r character_production.private_text_recovery; c jsonb; b character_production.text_replenishment_budgets; active boolean; stamp timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN NULL; END IF;
 SELECT * INTO r FROM character_production.private_text_recovery WHERE singleton;
 IF r.occurrence_id IS NULL THEN RETURN NULL; END IF;
 c:=public.character_production_preparation_context();
 IF c IS NULL OR c->>'occurrenceId' IS DISTINCT FROM r.occurrence_id::text OR c->>'textKey' IS DISTINCT FROM 'daily:2026-11-16:zaria-solenne' OR c->'textStarted' IS DISTINCT FROM 'true'::jsonb OR c->'speechStarted' IS DISTINCT FROM 'false'::jsonb THEN RETURN NULL; END IF;
 SELECT * INTO b FROM character_production.text_replenishment_budgets WHERE id=r.budget_id;
 IF b.id IS NULL OR c#>>'{lease,id}' IS DISTINCT FROM b.id::text THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 active:=r.enabled AND r.authorized_at<=stamp AND r.expires_at>stamp AND c->'active'='true'::jsonb
  AND b.enabled AND b.expires_at=r.expires_at AND b.cap_cents=10 AND b.max_cost_cents=10
  AND b.model='claude-haiku-4-5-20251001' AND b.input_micro_usd=1 AND b.output_micro_usd=5
  AND c->>'textKey'='daily:'||to_char(stamp AT TIME ZONE 'America/Chicago','YYYY-MM-DD')||':zaria-solenne'
  AND NOT EXISTS(SELECT 1 FROM unnest(r.owner_message_ids) m WHERE m IS NULL OR m!~'^Sentinel_[a-f0-9]{32}$');
 RETURN c||jsonb_build_object('active',coalesce(active,false),'textStarted',r.claimed);
END $$;
REVOKE ALL ON FUNCTION public.character_production_private_recovery_context() FROM PUBLIC;
CREATE FUNCTION public.character_production_private_recovery_claim(p_occurrence uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r character_production.private_text_recovery; c jsonb; b character_production.text_replenishment_budgets;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN false; END IF;
 SELECT * INTO r FROM character_production.private_text_recovery WHERE singleton;
 IF r.occurrence_id IS NULL OR r.occurrence_id IS DISTINCT FROM p_occurrence OR r.claimed THEN RETURN false; END IF;
 -- Same budget-row lock as text_claim serializes admission with every text
 -- provider claim. Its unique key and full-cap reservation prevent duplication.
 SELECT * INTO b FROM character_production.text_replenishment_budgets WHERE id=r.budget_id FOR UPDATE;
 PERFORM 1 FROM character_production.preparation_occurrences WHERE id=r.occurrence_id FOR UPDATE;
 SELECT * INTO r FROM character_production.private_text_recovery WHERE singleton FOR UPDATE;
 IF r.occurrence_id IS DISTINCT FROM p_occurrence OR r.claimed THEN RETURN false; END IF;
 c:=public.character_production_private_recovery_context();
 IF c IS NULL OR c->'active' IS DISTINCT FROM 'true'::jsonb OR c->'identity' IS DISTINCT FROM 'null'::jsonb OR c->>'textState' IS NOT NULL OR b.reserved_cents<>0
 OR EXISTS(SELECT 1 FROM character_production.text_replenishment_attempts WHERE budget_id=r.budget_id OR key=c->>'textKey') THEN RETURN false; END IF;
 UPDATE character_production.private_text_recovery SET claimed=true,claimed_at=clock_timestamp() WHERE singleton;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.character_production_private_recovery_claim(uuid) FROM PUBLIC;
DO $$ DECLARE r record; own oid:='character_production_owner'::regrole; BEGIN
 IF current_user<>'character_production_owner' THEN RAISE EXCEPTION 'Restricted owner required'; END IF;
 FOR r IN SELECT relowner owner,relacl acl FROM pg_class WHERE oid='character_production.private_text_recovery'::regclass
 UNION ALL SELECT proowner,proacl FROM pg_proc WHERE oid IN('character_production.private_text_recovery_immutable()'::regprocedure,'public.character_production_private_recovery_context()'::regprocedure,'public.character_production_private_recovery_claim(uuid)'::regprocedure)
 LOOP IF r.owner<>own OR EXISTS(SELECT 1 FROM aclexplode(r.acl) WHERE grantee<>own) THEN RAISE EXCEPTION 'Owner-only recovery required'; END IF; END LOOP;
END $$;
ROLLBACK;
