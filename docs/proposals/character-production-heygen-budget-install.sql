-- OFFLINE REVIEW ONLY. No budget ceiling change, evidence rows or activation.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Expected direct PG17 installer'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='character_production_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='character_production_owner'::regrole OR (roleid='character_production_owner'::regrole AND member<>current_user::regrole)) THEN RAISE EXCEPTION 'Unsafe owner baseline'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected temporary authority'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor<>current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option)<>1 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor=current_user::regrole) THEN RAISE EXCEPTION 'Missing exact bootstrap membership'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname IN ('heygen_wallet_policy','heygen_wallet_evidence','heygen_slot_evidence')) THEN RAISE EXCEPTION 'Existing budget guard requires reconciliation'; END IF;
END $$;
CREATE TEMP TABLE bi_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE bi_ns ON COMMIT DROP AS SELECT oid,nspacl,nspowner FROM pg_namespace WHERE nspname IN ('public','character_production');
CREATE TEMP TABLE bi_objects ON COMMIT DROP AS SELECT oid,relacl,relowner,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'character_production'::regnamespace);
CREATE TEMP TABLE bi_cols ON COMMIT DROP AS SELECT attrelid,attnum,attacl FROM pg_attribute WHERE attrelid IN (SELECT oid FROM bi_objects);
CREATE TEMP TABLE bi_functions ON COMMIT DROP AS SELECT oid,proowner,proacl,prosecdef,proconfig,pg_get_functiondef(oid) def,(oid IN ('public.character_production_claim(jsonb,text)'::regprocedure,'public.character_production_due(text,text,integer)'::regprocedure,'public.character_production_observe_receipt(text,text,text,text)'::regprocedure)) replace_body FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'character_production'::regnamespace) AND prokind='f';
CREATE TEMP TABLE bi_policies ON COMMIT DROP AS SELECT oid,to_jsonb(p) data FROM pg_policy p;
CREATE TEMP TABLE bi_triggers ON COMMIT DROP AS SELECT oid,to_jsonb(t) data FROM pg_trigger t;
GRANT character_production_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO character_production_owner;
SET LOCAL ROLE character_production_owner;
-- Existing ledger snapshots are read and compared under their unchanged owner.
CREATE TEMP TABLE bi_rows(name text,row jsonb) ON COMMIT DROP;
DO $$ DECLARE existing_table record; BEGIN
 FOR existing_table IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relkind='r' LOOP
 EXECUTE format('LOCK TABLE character_production.%I IN SHARE MODE',existing_table.relname);
 EXECUTE format('INSERT INTO bi_rows SELECT %L,to_jsonb(x) FROM character_production.%I x',existing_table.relname,existing_table.relname);
 END LOOP;
END $$;

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

CREATE OR REPLACE FUNCTION public.character_production_claim(p_slot jsonb,p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a character_production.approved_slots; b character_production.budgets;
 j character_production.jobs; cost bigint;
BEGIN
 IF p_slot IS NULL OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 SELECT * INTO a FROM character_production.approved_slots WHERE key=p_slot->>'key' FOR UPDATE;
 IF NOT FOUND OR a.enabled IS DISTINCT FROM true OR a.slot IS DISTINCT FROM p_slot OR a.digest IS DISTINCT FROM p_digest THEN RETURN NULL; END IF;
 IF a.slot->>'providerBindingRevision' IS NULL OR a.slot->>'providerBindingRevision' !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 SELECT * INTO b FROM character_production.budgets
 WHERE provider=a.slot->>'provider' AND period=a.slot->>'period' FOR UPDATE;
 IF NOT FOUND OR b.enabled IS DISTINCT FROM true OR b.cap_cents IS DISTINCT FROM (a.slot->>'periodCapCents')::bigint THEN RETURN NULL; END IF;
 -- Locks may wait across expiry/month rollover: check server time after both.
 IF a.slot->>'authorizationExpiresAt' IS NULL
 OR a.slot->>'authorizationExpiresAt' !~ '^[0-9]{1,16}$' THEN RETURN NULL; END IF;
 IF (a.slot->>'authorizationExpiresAt')::numeric <= extract(epoch FROM clock_timestamp())*1000
 OR a.slot->>'period' IS DISTINCT FROM character_production.calendar_period(b.provider,clock_timestamp()) THEN RETURN NULL; END IF;
 cost:=(a.slot->>'quoteCents')::bigint;
 IF cost IS NULL OR cost<=0 OR cost>b.cap_cents-b.reserved_cents THEN RETURN NULL; END IF;
 IF b.provider='heygen' AND (b.cap_cents>2000 OR NOT character_production.heygen_spend_allowed(a.slot,a.digest,cost,NULL)) THEN RETURN NULL; END IF;
 INSERT INTO character_production.jobs(key,digest,provider,model,period,cost,provider_binding_revision,slot)
 VALUES(a.key,a.digest,b.provider,a.slot->>'model',b.period,cost,a.slot->>'providerBindingRevision',a.slot)
 ON CONFLICT(key) DO NOTHING RETURNING * INTO j;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE character_production.budgets SET reserved_cents=reserved_cents+cost
 WHERE provider=b.provider AND period=b.period;
 RETURN jsonb_build_object('token',j.token,'digest',j.digest);
END $$;
CREATE OR REPLACE FUNCTION public.character_production_due(p_provider text,p_model text,p_limit integer)
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
  WHERE s.enabled AND a.enabled AND b.enabled AND (b.provider<>'heygen' OR b.cap_cents<=2000)
   AND a.slot->>'provider'=p_provider AND a.slot->>'model'=p_model
   AND a.slot->>'period'=character_production.calendar_period(p_provider,o.at)
   AND b.cap_cents=(a.slot->>'periodCapCents')::bigint
   AND s.scheduled_at<=o.at AND s.not_after>o.at
   AND s.not_after=to_timestamp((a.slot->>'authorizationExpiresAt')::numeric/1000)
   AND NOT EXISTS (SELECT 1 FROM character_production.jobs j WHERE j.key=a.key)
  ORDER BY s.scheduled_at,a.key LIMIT greatest(0,least(p_limit,25))
 ) SELECT jsonb_build_object('observedAt',floor(extract(epoch FROM o.at)*1000)::bigint,
  'rows',coalesce((SELECT jsonb_agg(d.row ORDER BY d.scheduled_at,d.key) FROM due d),'[]'::jsonb)) FROM observed o
$$;
CREATE OR REPLACE FUNCTION public.character_production_observe_receipt(p_key text,p_token text,p_digest text,p_task text)
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
   AND (j.provider<>'heygen' OR character_production.heygen_spend_allowed(j.slot,j.digest,j.cost,j.key))
   AND j.period=character_production.calendar_period(j.provider,clock_timestamp()),false);
 END IF;
 -- Evidence may arrive after authority expires: retain it, never promote or spend.
 IF p_task !~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$' THEN RETURN false; END IF;
 UPDATE character_production.jobs SET task=p_task
 WHERE key=p_key AND token=p_token AND digest=p_digest AND state IN ('submitting','unknown') AND (task IS NULL OR task=p_task);
 RETURN FOUND;
END $$;
DO $$ DECLARE existing_table record; BEGIN
 IF EXISTS(SELECT 1 FROM character_production.heygen_wallet_policy) OR EXISTS(SELECT 1 FROM character_production.heygen_wallet_evidence) OR EXISTS(SELECT 1 FROM character_production.heygen_slot_evidence) THEN RAISE EXCEPTION 'Budget guard must install empty'; END IF;
 CREATE TEMP TABLE bi_rows_after(name text,row jsonb) ON COMMIT DROP;
 FOR existing_table IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relkind='r' AND c.relname NOT IN ('heygen_wallet_policy','heygen_wallet_evidence','heygen_slot_evidence') LOOP
 EXECUTE format('INSERT INTO bi_rows_after SELECT %L,to_jsonb(x) FROM character_production.%I x',existing_table.relname,existing_table.relname);
 END LOOP;
 IF EXISTS((SELECT * FROM bi_rows EXCEPT ALL SELECT * FROM bi_rows_after) UNION ALL (SELECT * FROM bi_rows_after EXCEPT ALL SELECT * FROM bi_rows)) THEN RAISE EXCEPTION 'Ledger data changed'; END IF;
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM character_production_owner;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE new_object record; new_owner oid:='character_production_owner'::regrole; BEGIN
 IF EXISTS((SELECT * FROM pg_auth_members EXCEPT SELECT * FROM bi_members) UNION ALL (SELECT * FROM bi_members EXCEPT SELECT * FROM pg_auth_members)) THEN RAISE EXCEPTION 'Membership changed'; END IF;
 IF EXISTS(SELECT 1 FROM bi_ns b LEFT JOIN pg_namespace n USING(oid) WHERE n.oid IS NULL OR n.nspacl IS DISTINCT FROM b.nspacl OR n.nspowner IS DISTINCT FROM b.nspowner) THEN RAISE EXCEPTION 'Schema ACL changed'; END IF;
 IF EXISTS(SELECT 1 FROM bi_objects b LEFT JOIN pg_class c USING(oid) WHERE c.oid IS NULL OR c.relowner IS DISTINCT FROM b.relowner OR c.relacl IS DISTINCT FROM b.relacl OR c.relrowsecurity IS DISTINCT FROM b.relrowsecurity OR c.relforcerowsecurity IS DISTINCT FROM b.relforcerowsecurity) OR EXISTS(SELECT 1 FROM bi_cols b LEFT JOIN pg_attribute a USING(attrelid,attnum) WHERE a.attrelid IS NULL OR a.attacl IS DISTINCT FROM b.attacl) THEN RAISE EXCEPTION 'Existing object ACL changed'; END IF;
 IF EXISTS(SELECT 1 FROM bi_functions b LEFT JOIN pg_proc p USING(oid) WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM b.proowner OR p.proacl IS DISTINCT FROM b.proacl OR p.prosecdef IS DISTINCT FROM b.prosecdef OR p.proconfig IS DISTINCT FROM b.proconfig OR (NOT b.replace_body AND pg_get_functiondef(p.oid) IS DISTINCT FROM b.def)) THEN RAISE EXCEPTION 'Existing function authority changed'; END IF;
 IF EXISTS(SELECT 1 FROM bi_policies b LEFT JOIN pg_policy p USING(oid) WHERE p.oid IS NULL OR to_jsonb(p) IS DISTINCT FROM b.data) OR (SELECT count(*) FROM pg_policy)<>(SELECT count(*) FROM bi_policies) THEN RAISE EXCEPTION 'Policies changed'; END IF;
 IF EXISTS(SELECT 1 FROM bi_triggers b LEFT JOIN pg_trigger t USING(oid) WHERE t.oid IS NULL OR to_jsonb(t) IS DISTINCT FROM b.data) THEN RAISE EXCEPTION 'Existing trigger changed'; END IF;
 FOR new_object IN SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname IN ('heygen_wallet_policy','heygen_wallet_evidence','heygen_slot_evidence') LOOP
 IF new_object.relkind<>'r' OR new_object.relowner<>new_owner OR NOT new_object.relrowsecurity OR new_object.relforcerowsecurity OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=new_object.oid AND attacl IS NOT NULL) THEN RAISE EXCEPTION 'New budget table owner/RLS mismatch'; END IF;
 IF EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(new_object.relacl,acldefault('r',new_owner)))), expected AS (SELECT * FROM aclexplode(acldefault('r',new_owner))) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'New budget table ACL mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname IN ('heygen_wallet_policy','heygen_wallet_evidence','heygen_slot_evidence') AND c.relkind='r')<>3 THEN RAISE EXCEPTION 'Missing budget table'; END IF;
 FOR new_object IN SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='character_production' AND p.proname IN ('calendar_period','heygen_spend_allowed','heygen_evidence_immutable') LOOP
 IF new_object.proowner<>new_owner OR new_object.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'New budget function owner/config mismatch'; END IF;
 IF EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(new_object.proacl,acldefault('f',new_owner)))), expected AS (SELECT new_owner grantor,new_owner grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'New budget function ACL mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='character_production' AND p.proname IN ('calendar_period','heygen_spend_allowed','heygen_evidence_immutable'))<>3 THEN RAISE EXCEPTION 'Missing budget function'; END IF;
 IF (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND NOT EXISTS(SELECT 1 FROM bi_triggers b WHERE b.oid=t.oid))<>1 OR NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgname='heygen_evidence_immutable' AND t.tgtype=27 AND t.tgenabled='O' AND t.tgqual IS NULL AND t.tgnargs=0 AND n.nspname='character_production' AND c.relname='heygen_wallet_evidence' AND p.proname='heygen_evidence_immutable' AND p.proowner=new_owner) THEN RAISE EXCEPTION 'New evidence trigger mismatch'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Temporary authority remains'; END IF;
END $$;
COMMIT;

