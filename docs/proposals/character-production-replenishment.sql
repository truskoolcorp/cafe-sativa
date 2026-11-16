-- OFFLINE SOURCE ONLY. No install, grants, activation or paid call. Reviewer
-- must provision explicit separate text budget/rate evidence; HeyGen budget is
-- not interchangeable. Ends ROLLBACK. No reset, release or reclaim operation.
BEGIN;
CREATE TABLE character_production.text_replenishment_budgets(
 id uuid PRIMARY KEY, period text NOT NULL CHECK(period~'^20[0-9]{2}-[0-9]{2}$'),
 model text NOT NULL CHECK(model='claude-haiku-4-5-20251001'),
 input_micro_usd integer NOT NULL CHECK(input_micro_usd>0), output_micro_usd integer NOT NULL CHECK(output_micro_usd>0),
 max_cost_cents integer NOT NULL CHECK(max_cost_cents>0), cap_cents integer NOT NULL CHECK(cap_cents>=max_cost_cents),
 reserved_cents integer NOT NULL DEFAULT 0 CHECK(reserved_cents>=0 AND reserved_cents<=cap_cents),
 rate_evidence text NOT NULL CHECK(length(rate_evidence) BETWEEN 1 AND 1000),
 expires_at timestamptz NOT NULL, enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE character_production.text_replenishment_attempts(
 key text PRIMARY KEY CHECK(key~'^[a-z0-9][a-z0-9:/_-]{0,159}$'), token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 budget_id uuid NOT NULL REFERENCES character_production.text_replenishment_budgets(id),
 source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='object' AND octet_length(source_snapshot::text)<=50000),
 source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'claimed' CHECK(state IN('claimed','awaiting_audio_binding_and_qa')),
 output jsonb, provider_id text, input_tokens integer, output_tokens integer,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX text_replenishment_unique_script ON character_production.text_replenishment_attempts(lower(trim(output->>'spokenScript'))) WHERE output IS NOT NULL;
ALTER TABLE character_production.text_replenishment_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.text_replenishment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.text_replenishment_budgets,character_production.text_replenishment_attempts FROM PUBLIC;
CREATE FUNCTION public.character_production_text_claim(p_key text,p_digest text,p_source jsonb,p_budget uuid,p_period text,p_quote integer,p_cap integer,p_rate text,p_expires bigint,p_input_rate integer,p_output_rate integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b character_production.text_replenishment_budgets; t uuid;
BEGIN
 SELECT * INTO b FROM character_production.text_replenishment_budgets WHERE id=p_budget FOR UPDATE;
 IF p_key IS DISTINCT FROM 'daily:'||to_char(clock_timestamp() AT TIME ZONE 'America/Chicago','YYYY-MM-DD')||':'||(p_source->>'characterId') THEN RETURN NULL; END IF;
 IF floor(extract(epoch FROM b.expires_at)*1000)::bigint IS DISTINCT FROM p_expires OR b.input_micro_usd IS DISTINCT FROM p_input_rate OR b.output_micro_usd IS DISTINCT FROM p_output_rate THEN RETURN NULL; END IF;
 IF b.id IS NULL OR NOT b.enabled OR b.expires_at<=clock_timestamp() OR b.period<>to_char(clock_timestamp() AT TIME ZONE 'America/Chicago','YYYY-MM') OR b.period IS DISTINCT FROM p_period OR b.max_cost_cents IS DISTINCT FROM p_quote OR b.cap_cents IS DISTINCT FROM p_cap OR b.rate_evidence IS DISTINCT FROM p_rate THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM character_production.text_replenishment_attempts WHERE key=p_key) OR b.reserved_cents+b.max_cost_cents>b.cap_cents THEN RETURN NULL; END IF;
 INSERT INTO character_production.text_replenishment_attempts(key,budget_id,source_digest,source_snapshot) VALUES(p_key,b.id,p_digest,p_source) ON CONFLICT(key) DO NOTHING RETURNING token INTO t;
 IF t IS NULL THEN RETURN NULL; END IF;
 UPDATE character_production.text_replenishment_budgets SET reserved_cents=reserved_cents+b.max_cost_cents WHERE id=b.id;
 RETURN t;
END $$;
CREATE FUNCTION public.character_production_text_authorized(p_key text,p_token uuid,p_digest text,p_budget uuid,p_expires bigint,p_input_rate integer,p_output_rate integer,p_quote integer,p_cap integer,p_rate text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM character_production.text_replenishment_attempts a JOIN character_production.text_replenishment_budgets b ON b.id=a.budget_id WHERE a.key=p_key AND a.token=p_token AND a.source_digest=p_digest AND a.state='claimed' AND a.key='daily:'||to_char(clock_timestamp() AT TIME ZONE 'America/Chicago','YYYY-MM-DD')||':'||(a.source_snapshot->>'characterId') AND b.id=p_budget AND b.enabled AND b.expires_at>clock_timestamp() AND b.period=to_char(clock_timestamp() AT TIME ZONE 'America/Chicago','YYYY-MM') AND floor(extract(epoch FROM b.expires_at)*1000)::bigint=p_expires AND b.input_micro_usd=p_input_rate AND b.output_micro_usd=p_output_rate AND b.max_cost_cents=p_quote AND b.cap_cents=p_cap AND b.rate_evidence=p_rate);
$$;
REVOKE ALL ON FUNCTION public.character_production_text_authorized(text,uuid,text,uuid,bigint,integer,integer,integer,integer,text) FROM PUBLIC;
CREATE FUNCTION public.character_production_text_save(p_key text,p_token uuid,p_digest text,p_output jsonb,p_provider text,p_input integer,p_output_tokens integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_provider IS NULL OR length(p_provider) NOT BETWEEN 1 AND 200 OR p_input IS NULL OR p_input<1 OR p_output_tokens IS NULL OR p_output_tokens NOT BETWEEN 1 AND 1024 OR jsonb_typeof(p_output) IS DISTINCT FROM 'object' OR octet_length(p_output::text)>20000 THEN RETURN false; END IF;
 UPDATE character_production.text_replenishment_attempts SET state='awaiting_audio_binding_and_qa',output=p_output,provider_id=p_provider,input_tokens=p_input,output_tokens=p_output_tokens WHERE key=p_key AND token=p_token AND source_digest=p_digest AND state='claimed';
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.character_production_text_claim(text,text,jsonb,uuid,text,integer,integer,text,bigint,integer,integer),public.character_production_text_save(text,uuid,text,jsonb,text,integer,integer) FROM PUBLIC;
-- Reject any existing default ACL that silently grants new capability. Owner
-- expected to be the reviewed restricted role, never install as postgres.
DO $$ DECLARE r record; own oid; BEGIN
 SELECT oid INTO own FROM pg_roles WHERE rolname=current_user;
 IF current_user<>'character_production_owner' THEN RAISE EXCEPTION 'Restricted owner required'; END IF;
 FOR r IN SELECT relowner owner,relacl acl FROM pg_class WHERE oid IN('character_production.text_replenishment_budgets'::regclass,'character_production.text_replenishment_attempts'::regclass)
 UNION ALL SELECT proowner,proacl FROM pg_proc WHERE oid IN('public.character_production_text_claim(text,text,jsonb,uuid,text,integer,integer,text,bigint,integer,integer)'::regprocedure,'public.character_production_text_save(text,uuid,text,jsonb,text,integer,integer)'::regprocedure,'public.character_production_text_authorized(text,uuid,text,uuid,bigint,integer,integer,integer,integer,text)'::regprocedure)
 LOOP IF r.owner<>own OR EXISTS(SELECT 1 FROM aclexplode(r.acl) WHERE grantee<>own) THEN RAISE EXCEPTION 'Owner-only source required'; END IF; END LOOP;
END $$;
ROLLBACK;
