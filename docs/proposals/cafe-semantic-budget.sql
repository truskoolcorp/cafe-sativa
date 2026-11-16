-- OFFLINE PROPOSAL, not an installer. Requires exact reviewed owner/catalog wrapper.
-- No budget row, runtime grants, provider execution or default allowance.
BEGIN;
SET LOCAL ROLE cafe_metricool_owner;
CREATE TABLE cafe_metricool_private.semantic_budgets(
 id uuid PRIMARY KEY,
 account_evidence text NOT NULL CHECK(length(account_evidence) BETWEEN 1 AND 200),
 token_ceiling_evidence text NOT NULL CHECK(length(token_ceiling_evidence) BETWEEN 1 AND 200),
 max_billable_input_tokens bigint NOT NULL CHECK(max_billable_input_tokens BETWEEN 1 AND 200000),
 rate_evidence text NOT NULL CHECK(length(rate_evidence) BETWEEN 1 AND 200),
 owner_authorization text NOT NULL CHECK(length(owner_authorization) BETWEEN 1 AND 200),
 model text NOT NULL CHECK(model='claude-haiku-4-5-20251001'),
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 cap_micro_usd bigint NOT NULL CHECK(cap_micro_usd>0),
 -- Conservative ceiling micro-USD PER TOKEN, from separately verified rate evidence.
 input_token_ceiling_micro_usd bigint NOT NULL CHECK(input_token_ceiling_micro_usd>0),
 output_token_ceiling_micro_usd bigint NOT NULL CHECK(output_token_ceiling_micro_usd>0),
 reserved_micro_usd bigint NOT NULL DEFAULT 0 CHECK(reserved_micro_usd>=0 AND reserved_micro_usd<=cap_micro_usd),
 revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE cafe_metricool_private.semantic_attempts(
 review_key text PRIMARY KEY CHECK(review_key ~ '^cafe-semantic-v1:[a-f0-9]{64}$'),
 budget_id uuid NOT NULL REFERENCES cafe_metricool_private.semantic_budgets(id),
 reserved_micro_usd bigint NOT NULL CHECK(reserved_micro_usd>0),
 input_tokens bigint NOT NULL CHECK(input_tokens BETWEEN 1 AND 200000),
 output_tokens integer NOT NULL CHECK(output_tokens=256),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 receipt jsonb,
 receipt_at timestamptz
);
ALTER TABLE cafe_metricool_private.semantic_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE cafe_metricool_private.semantic_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cafe_metricool_private.semantic_budgets,cafe_metricool_private.semantic_attempts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION cafe_metricool_private.reserve_semantic_attempt(p_budget uuid,p_key text,p_input_tokens bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,cafe_metricool_private AS $$
DECLARE b cafe_metricool_private.semantic_budgets; cost numeric; at timestamptz;
BEGIN
 IF p_key IS NULL OR p_key !~ '^cafe-semantic-v1:[a-f0-9]{64}$' OR p_input_tokens IS NULL OR p_input_tokens NOT BETWEEN 1 AND 200000 THEN RETURN false; END IF;
 SELECT * INTO b FROM cafe_metricool_private.semantic_budgets WHERE id=p_budget FOR UPDATE;
 at:=clock_timestamp(); -- Recheck after any row-lock wait, never the pre-lock timestamp.
 IF NOT FOUND OR b.revoked OR at<b.starts_at OR at>=b.ends_at OR p_input_tokens<>b.max_billable_input_tokens THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM cafe_metricool_private.semantic_attempts WHERE review_key=p_key) THEN RETURN false; END IF;
 cost:=p_input_tokens::numeric*b.input_token_ceiling_micro_usd+256::numeric*b.output_token_ceiling_micro_usd;
 IF cost>b.cap_micro_usd-b.reserved_micro_usd THEN RETURN false; END IF;
 INSERT INTO cafe_metricool_private.semantic_attempts(review_key,budget_id,reserved_micro_usd,input_tokens,output_tokens)
 VALUES(p_key,p_budget,cost::bigint,p_input_tokens,256) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE cafe_metricool_private.semantic_budgets SET reserved_micro_usd=reserved_micro_usd+cost::bigint WHERE id=b.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION cafe_metricool_private.reserve_semantic_attempt(uuid,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION cafe_metricool_private.finish_semantic_attempt(p_key text,p_receipt jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,cafe_metricool_private AS $$
DECLARE a cafe_metricool_private.semantic_attempts; b cafe_metricool_private.semantic_budgets;
BEGIN
 SELECT * INTO a FROM cafe_metricool_private.semantic_attempts WHERE review_key=p_key FOR UPDATE;
 IF NOT FOUND OR a.receipt IS NOT NULL THEN RETURN false; END IF;
 SELECT * INTO b FROM cafe_metricool_private.semantic_budgets WHERE id=a.budget_id;
 IF jsonb_typeof(p_receipt) IS DISTINCT FROM 'object' OR NOT p_receipt ?& ARRAY['key','requestId','model','inputTokens','outputTokens','resultSha256','classification']
 OR (SELECT count(*) FROM jsonb_object_keys(p_receipt))<>7
 OR p_receipt->>'key' IS DISTINCT FROM p_key OR p_receipt->>'model' IS DISTINCT FROM b.model
 OR coalesce(p_receipt->>'requestId','') !~ '^msg_[A-Za-z0-9_-]{1,180}$'
 OR coalesce(p_receipt->>'resultSha256','') !~ '^[a-f0-9]{64}$'
 OR coalesce(p_receipt->>'inputTokens','') !~ '^[0-9]{1,6}$'
 OR coalesce(p_receipt->>'outputTokens','') !~ '^[0-9]{1,3}$'
 OR (p_receipt->>'inputTokens')::bigint>a.input_tokens OR (p_receipt->>'outputTokens')::integer>a.output_tokens
 OR octet_length(p_receipt::text)>8192 THEN RETURN false; END IF;
 UPDATE cafe_metricool_private.semantic_attempts SET receipt=p_receipt,receipt_at=clock_timestamp() WHERE review_key=p_key;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION cafe_metricool_private.finish_semantic_attempt(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
-- Proposed transport wrappers remain owner-only. A later installer must prove
-- exact topology/ACLs and obtain scoped approval before any runtime EXECUTE grant.
CREATE FUNCTION public.cs_reserve_cafe_semantic_attempt(p_budget uuid,p_key text,p_input_tokens bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,cafe_metricool_private AS $$
 SELECT cafe_metricool_private.reserve_semantic_attempt(p_budget,p_key,p_input_tokens)
$$;
CREATE FUNCTION public.cs_finish_cafe_semantic_attempt(p_key text,p_receipt jsonb)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,cafe_metricool_private AS $$
 SELECT cafe_metricool_private.finish_semantic_attempt(p_key,p_receipt)
$$;
REVOKE ALL ON FUNCTION public.cs_reserve_cafe_semantic_attempt(uuid,text,bigint),public.cs_finish_cafe_semantic_attempt(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
-- Reservations are conservative spend upper bounds, NOT actual provider billing.
-- No refund/reset function: ambiguous provider results retain reservation and permanent key.
-- p_input_tokens requires real same-request provider token count or verified conservative
-- tokenizer bound; a caller's character count is NOT accepted as a token proof.
ROLLBACK;
