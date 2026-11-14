-- DORMANT REVIEW PROPOSAL. Existing owner only. No grants, rows or activation.
-- Owner approval Sentinel_3acee78ce7e48191abcd48706735bd28: Café videos only,
-- $20 Dallas calendar month, original canary included, existing API wallet only.
BEGIN;
DO $$ DECLARE signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY['public.character_production_claim(jsonb,text)','public.character_production_due(text,text,integer)','public.character_production_observe_receipt(text,text,text,text)'] LOOP
 IF to_regprocedure(signature) IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(signature) AND proowner=current_user::regrole) THEN RAISE EXCEPTION 'Existing reviewed RPC owner required'; END IF; END LOOP;
END $$;
CREATE FUNCTION character_production.calendar_period(p_provider text,p_at timestamptz)
RETURNS text LANGUAGE sql STABLE STRICT SET search_path=pg_catalog AS $$
 SELECT to_char(p_at AT TIME ZONE CASE WHEN p_provider='heygen' THEN 'America/Chicago' ELSE 'UTC' END,'YYYY-MM')
$$;
CREATE TABLE character_production.heygen_wallet_policy (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 account_id text NOT NULL CHECK(account_id='d61468fdf18c4b478f27857337ddd1ea'),
 monthly_cap_cents bigint NOT NULL CHECK(monthly_cap_cents=2000),
 enabled boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL
);
CREATE TABLE character_production.heygen_wallet_evidence (
 id uuid PRIMARY KEY, account_id text NOT NULL CHECK(account_id='d61468fdf18c4b478f27857337ddd1ea'),
 currency text NOT NULL CHECK(currency='USD'), balance_kind text NOT NULL CHECK(balance_kind='api_wallet'),
 wallet_cents bigint NOT NULL CHECK(wallet_cents>=0), auto_topup boolean NOT NULL CHECK(auto_topup=false),
 existing_credit_only boolean NOT NULL CHECK(existing_credit_only=true),
 model text NOT NULL CHECK(model='avatar_iv'), media_class text NOT NULL CHECK(media_class='photo'),
 rate_captured_at timestamptz NOT NULL, rate_expires_at timestamptz NOT NULL,
 CHECK(rate_expires_at>rate_captured_at AND rate_expires_at<=rate_captured_at+interval '24 hours'),
 rate_cents_per_minute bigint NOT NULL CHECK(rate_cents_per_minute>0 AND rate_cents_per_minute<=100000),
 captured_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 evidence_sha text NOT NULL CHECK(evidence_sha ~ '^[a-f0-9]{64}$'),
 CHECK(expires_at>captured_at AND expires_at<=captured_at+interval '60 seconds')
);
CREATE TABLE character_production.heygen_slot_evidence (
 slot_key text PRIMARY KEY REFERENCES character_production.approved_slots(key),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 evidence_id uuid NOT NULL REFERENCES character_production.heygen_wallet_evidence(id),
 enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE character_production.heygen_wallet_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.heygen_wallet_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.heygen_slot_evidence ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION character_production.heygen_evidence_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Wallet evidence is immutable; insert fresh evidence'; END $$;
CREATE TRIGGER heygen_evidence_immutable BEFORE UPDATE OR DELETE ON character_production.heygen_wallet_evidence FOR EACH ROW EXECUTE FUNCTION character_production.heygen_evidence_immutable();
CREATE FUNCTION character_production.heygen_spend_allowed(p_slot jsonb,p_digest text,p_cost bigint,p_existing_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy character_production.heygen_wallet_policy; evidence character_production.heygen_wallet_evidence;
 binding character_production.heygen_slot_evidence; outstanding numeric; observed timestamptz; duration numeric; quote numeric;
BEGIN
 -- A singleton account lock serializes wallet reservations across month rollover.
 SELECT * INTO policy FROM character_production.heygen_wallet_policy WHERE id=true FOR UPDATE;
 IF NOT FOUND OR NOT policy.enabled OR policy.monthly_cap_cents<>2000 THEN RETURN false; END IF;
 SELECT * INTO binding FROM character_production.heygen_slot_evidence WHERE slot_key=p_slot->>'key' FOR UPDATE;
 IF NOT FOUND OR NOT binding.enabled OR binding.digest IS DISTINCT FROM p_digest THEN RETURN false; END IF;
 SELECT * INTO evidence FROM character_production.heygen_wallet_evidence WHERE id=binding.evidence_id;
 observed:=clock_timestamp();
 IF NOT FOUND OR policy.expires_at<=observed OR evidence.account_id IS DISTINCT FROM policy.account_id
 OR evidence.currency IS DISTINCT FROM 'USD' OR evidence.balance_kind IS DISTINCT FROM 'api_wallet'
 OR evidence.auto_topup IS DISTINCT FROM false OR evidence.existing_credit_only IS DISTINCT FROM true
 OR evidence.captured_at>observed OR evidence.expires_at<=observed OR evidence.captured_at<observed-interval '60 seconds'
 OR evidence.rate_captured_at>observed OR evidence.rate_expires_at<=observed OR evidence.rate_captured_at<observed-interval '24 hours'
 OR p_slot->>'authorizationExpiresAt' IS NULL OR p_slot->>'authorizationExpiresAt' !~ '^[0-9]{1,16}$'
 OR (p_slot->>'authorizationExpiresAt')::numeric<=extract(epoch FROM observed)*1000
 OR p_slot->>'provider' IS DISTINCT FROM 'heygen' OR p_slot->>'model' IS DISTINCT FROM evidence.model
 OR p_slot->>'period' IS DISTINCT FROM character_production.calendar_period('heygen',observed)
 OR p_slot->>'periodCapCents' IS DISTINCT FROM '2000'
 OR p_slot->>'durationSeconds' IS NULL OR p_slot->>'durationSeconds' !~ '^[0-9]{1,3}$'
 OR p_cost IS NULL OR p_cost<=0 OR p_cost>2000 THEN RETURN false; END IF;
 duration:=(p_slot->>'durationSeconds')::numeric;
 quote:=ceil(evidence.rate_cents_per_minute*duration/60);
 IF duration<1 OR duration>180 OR p_cost<quote OR (p_slot->>'quoteCents') IS DISTINCT FROM p_cost::text THEN RETURN false; END IF;
 -- Evidence-only receipt reconciliation never invokes this helper. A prewrite
 -- check excludes its own already reserved job, never another arbitrary key.
 IF p_existing_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM character_production.jobs j WHERE j.key=p_existing_key AND j.key=p_slot->>'key' AND j.slot=p_slot AND j.digest=p_digest AND j.cost=p_cost AND j.state='submitting' AND j.task IS NULL) THEN RETURN false; END IF;
 SELECT coalesce(sum(j.cost),0) INTO outstanding FROM character_production.jobs j
 WHERE j.provider='heygen' AND (p_existing_key IS NULL OR j.key<>p_existing_key)
;
 -- Conservatively retain EVERY reservation until separately verified debit
 -- reflection exists. Completion timestamps do not prove wallet settlement.
 RETURN p_cost<=evidence.wallet_cents-outstanding;
END $$;
REVOKE ALL ON character_production.heygen_wallet_policy,character_production.heygen_wallet_evidence,character_production.heygen_slot_evidence FROM PUBLIC;
REVOKE ALL ON FUNCTION character_production.calendar_period(text,timestamptz),character_production.heygen_spend_allowed(jsonb,text,bigint,text),character_production.heygen_evidence_immutable() FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','character_production_generator','character_production_output_broker'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON character_production.heygen_wallet_policy,character_production.heygen_wallet_evidence,character_production.heygen_slot_evidence FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION character_production.calendar_period(text,timestamptz),character_production.heygen_spend_allowed(jsonb,text,bigint,text),character_production.heygen_evidence_immutable() FROM %I',r);
 END IF; END LOOP;
END $$;
