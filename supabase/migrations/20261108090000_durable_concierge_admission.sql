-- LOCAL REVIEW CANDIDATE. Do not apply to a shared/production DB without review.
-- Additive objects, but triggers deliberately guard existing table writers.
BEGIN;
CREATE SCHEMA concierge_private;
REVOKE ALL ON SCHEMA concierge_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA concierge_private TO service_role;

CREATE TABLE concierge_private.policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 enabled boolean NOT NULL DEFAULT false,
 version text NOT NULL DEFAULT 'unconfigured-v1',
 global_inflight integer CHECK (global_inflight > 0),
 global_admissions integer CHECK (global_admissions > 0),
 global_window_seconds integer CHECK (global_window_seconds BETWEEN 1 AND 86400),
 global_budget_microusd bigint CHECK (global_budget_microusd > 0),
 max_request_cost_microusd bigint CHECK (max_request_cost_microusd > 0),
 max_prompt_bytes integer CHECK (max_prompt_bytes BETWEEN 1 AND 48000),
 max_input_messages integer CHECK (max_input_messages BETWEEN 1 AND 61),
 max_output_tokens integer CHECK (max_output_tokens BETWEEN 1 AND 512),
 max_reply_chars integer CHECK (max_reply_chars BETWEEN 1 AND 16384),
 lease_seconds integer CHECK (lease_seconds BETWEEN 1 AND 300),
 legacy_cutoff timestamptz,
 legacy_drained boolean NOT NULL DEFAULT false,
 charged_failures_approved boolean NOT NULL DEFAULT false,
 -- Explicit operator decisions, not approved product defaults. Technical max: 100 years.
 retention_seconds bigint CHECK (retention_seconds BETWEEN 86400 AND 3155760000),
 content_retention_seconds bigint CHECK (content_retention_seconds BETWEEN 1 AND 3155760000),
 replay_max_age_seconds bigint CHECK (replay_max_age_seconds BETWEEN 1 AND 3155760000),
 max_future_skew_seconds integer CHECK (max_future_skew_seconds BETWEEN 0 AND 300)
);
INSERT INTO concierge_private.policy(singleton) VALUES(true);
-- This global rejection floor contains no user content and must never be reset.
-- It prevents policy enlargement from reviving a key after its tombstone is pruned.
CREATE TABLE concierge_private.lifecycle (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 reject_before_ms bigint NOT NULL DEFAULT 0 CHECK(reject_before_ms>=0),
 last_cleanup_at timestamptz
);
INSERT INTO concierge_private.lifecycle(singleton) VALUES(true);
CREATE TABLE concierge_private.requests (
 requester text NOT NULL,
 request_id uuid NOT NULL,
 user_id uuid,
 session_id text,
 host text CHECK (host IN ('laviche','ginger','ahnika')),
 conversation_id uuid REFERENCES public.host_conversations(id) ON DELETE RESTRICT,
 payload jsonb,
 fingerprint bytea,
 redacted boolean NOT NULL DEFAULT false,
 state text NOT NULL CHECK (state IN ('reserved','dispatching','uncertain','completed','cancelled','failed')),
 charged boolean NOT NULL DEFAULT true,
 admitted_at timestamptz NOT NULL,
 issued_at bigint CHECK(issued_at BETWEEN 0 AND 281474976710655),
 content_expires_at timestamptz,
 tombstone_retention_seconds bigint CHECK(tombstone_retention_seconds BETWEEN 86400 AND 3155760000),
 redacted_at timestamptz,
 quarantined_at timestamptz,
 provider_receipt jsonb,
 lease_until timestamptz NOT NULL,
 dispatch_marked_at timestamptz,
 finished_at timestamptz,
 owner_token uuid DEFAULT gen_random_uuid(),
 user_message_id uuid UNIQUE DEFAULT gen_random_uuid(),
 assistant_message_id uuid UNIQUE DEFAULT gen_random_uuid(),
 tier text CHECK (tier IN ('anonymous','explorer','regular','vip')),
 policy_version text,
 remaining_at_admission integer CHECK (remaining_at_admission >= 0),
 reserved_cost_microusd bigint NOT NULL CHECK (reserved_cost_microusd > 0),
 max_reply_chars integer CHECK (max_reply_chars BETWEEN 1 AND 16384),
 response jsonb,
 PRIMARY KEY(requester,request_id),
 CHECK ((redacted AND state IN ('completed','cancelled','failed') AND user_id IS NULL AND session_id IS NULL)
   OR (user_id IS NOT NULL AND session_id IS NULL AND requester='u:'||user_id::text)
   OR (user_id IS NULL AND session_id IS NOT NULL AND requester='s:'||session_id)),
 CHECK ((state='cancelled') = (NOT charged)),
 CHECK (redacted OR ((state='completed') = (response IS NOT NULL))),
 CHECK ((redacted AND payload IS NULL AND fingerprint IS NULL AND response IS NULL AND provider_receipt IS NULL)
   OR (NOT redacted AND conversation_id IS NOT NULL AND jsonb_typeof(payload)='object' AND octet_length(fingerprint)=32)),
 CHECK (redacted OR (host IS NOT NULL AND owner_token IS NOT NULL AND user_message_id IS NOT NULL
   AND assistant_message_id IS NOT NULL AND tier IS NOT NULL AND policy_version IS NOT NULL
   AND remaining_at_admission IS NOT NULL AND max_reply_chars IS NOT NULL)),
 CHECK (user_message_id<>assistant_message_id),
 CHECK (lease_until>admitted_at)
);
CREATE INDEX requests_usage ON concierge_private.requests(requester,admitted_at) WHERE charged;
CREATE INDEX requests_global_usage ON concierge_private.requests(admitted_at) WHERE charged;
CREATE INDEX requests_conversation ON concierge_private.requests(conversation_id);
CREATE INDEX requests_inflight ON concierge_private.requests(state) WHERE state IN ('reserved','dispatching','uncertain');
ALTER TABLE concierge_private.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE concierge_private.policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE concierge_private.lifecycle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON concierge_private.requests, concierge_private.policy, concierge_private.lifecycle FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON concierge_private.requests TO service_role;
GRANT SELECT ON concierge_private.policy, concierge_private.lifecycle TO service_role;
-- No service DELETE/TRUNCATE, policy/watermark writes, or automated cleanup job.

CREATE FUNCTION concierge_private.lock_v1() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' AS $$
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'concierge requires read committed' USING ERRCODE='25000';
 END IF;
 PERFORM pg_advisory_xact_lock(1128351301,1);
END $$;

-- Hosted Auth hard deletion must acquire the lock INSIDE its own transaction,
-- before the auth tuple and FK cascades. This trigger never reads private data,
-- changes Auth lifecycle/storage behavior, or needs auth-admin private privileges.
-- Keep routine signup, sign-in/refresh and Auth soft-delete UPDATEs outside it.
CREATE FUNCTION public.concierge_auth_statement_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' AS $$
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(1128351301,1);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.concierge_auth_statement_v1() FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
CREATE TRIGGER concierge_auth_delete_statement BEFORE DELETE ON auth.users
 FOR EACH STATEMENT EXECUTE FUNCTION public.concierge_auth_statement_v1();
CREATE TRIGGER concierge_auth_identity_statement BEFORE UPDATE OF id ON auth.users
 FOR EACH STATEMENT EXECUTE FUNCTION public.concierge_auth_statement_v1();
-- Lounge soft deletion changes deleted_by to an auth FK after its row lock.
-- Serialize before that lock, including calls through the existing moderator RPC.
-- A lock-only INVOKER trigger does not require new client/private privileges.
CREATE TRIGGER concierge_lounge_update_statement BEFORE UPDATE ON public.lounge_messages
 FOR EACH STATEMENT EXECUTE FUNCTION public.concierge_auth_statement_v1();

-- These EXISTING service-only commerce RPCs lock shared dependent rows before
-- writing auth/profile FKs. Enter the same lock order before their first row lock.
-- Preserve signatures, bodies, owners, SECURITY DEFINER status and existing ACLs.
-- Reject missing/drifted source/security metadata instead of overwriting it.
-- This is a reviewed local candidate, NOT permission to change live functions.
DO $reviewed_writers$
DECLARE expected record; actual record;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.cs_record_gallery_payment(jsonb,uuid,uuid,integer)','6e645c410e554e71065ad72c5e522f97',ARRAY['search_path=public, pg_temp']::text[]),
  ('public.cs_record_ticket_payment(uuid,jsonb)','8a93216663ce84586ccc100544dfe6c4',ARRAY['search_path=pg_catalog, public']::text[]),
  ('public.cs_reserve_ticket(uuid,uuid)','21b88fa6e2545bcaa4c7cc785c1a34de',ARRAY['search_path=pg_catalog, public']::text[])) AS writers(signature,source_md5,settings)
 LOOP
  SELECT p.prosrc,p.prosecdef,p.proacl::text AS acl,p.proconfig,pg_catalog.pg_get_userbyid(p.proowner) AS owner,
    l.lanname INTO actual FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
   WHERE p.oid=pg_catalog.to_regprocedure(expected.signature);
  IF NOT FOUND OR pg_catalog.md5(actual.prosrc) IS DISTINCT FROM expected.source_md5
    OR actual.prosecdef IS DISTINCT FROM true OR actual.owner IS DISTINCT FROM 'postgres'
    OR actual.acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
    OR actual.proconfig IS DISTINCT FROM expected.settings OR actual.lanname IS DISTINCT FROM 'plpgsql'
  THEN RAISE EXCEPTION 'reviewed commerce writer missing or changed: %',expected.signature USING ERRCODE='55000';
  END IF;
 END LOOP;
END $reviewed_writers$;

CREATE OR REPLACE FUNCTION public.cs_record_gallery_payment(receipt jsonb, product_uuid uuid, artist_uuid uuid, quantity integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 p public.products%rowtype; a public.artists%rowtype;
 existing_id uuid; new_id uuid;
 subtotal integer; unit_price integer; fee integer;
begin
 -- Global transaction lock before any existing row or FK lock.
 PERFORM concierge_private.lock_v1();
 if receipt->>'session_id' is null or receipt->>'payment_status' <> 'paid' or quantity is null or quantity < 1 or quantity > 10 then
  raise exception 'Invalid paid receipt';
 end if;
 select * into p from public.products where id=product_uuid for update;
 if not found or p.artist_id<>artist_uuid then raise exception 'Product or artist mismatch'; end if;
 select id into existing_id from public.orders where stripe_checkout_session_id=receipt->>'session_id';
 if existing_id is not null then return jsonb_build_object('id',existing_id,'created',false); end if;
 subtotal=(receipt->>'subtotal_cents')::integer;
 if subtotal is null or subtotal<=0 or subtotal%quantity<>0 or (receipt->>'total_cents')::integer<0 then raise exception 'Invalid checkout amounts'; end if;
 unit_price=subtotal/quantity;
 fee=(receipt->>'application_fee_cents')::integer;
 if fee is null or fee<0 or fee>subtotal then raise exception 'Invalid application fee'; end if;
 if p.stock_count is not null and p.stock_count<quantity then raise exception 'Paid order requires inventory reconciliation'; end if;
 if p.kind::text<>'physical' and nullif(p.digital_delivery_url,'') is null then raise exception 'Digital delivery asset unavailable'; end if;
 select * into a from public.artists where id=artist_uuid;
 insert into public.orders(user_id,buyer_email,stripe_checkout_session_id,stripe_payment_intent_id,
 subtotal_cents,shipping_cents,tax_cents,total_cents,currency,shipping_name,shipping_line1,shipping_line2,
 shipping_city,shipping_state,shipping_postal_code,shipping_country,fulfillment_state,paid_at)
 values((receipt->>'user_id')::uuid,coalesce(receipt->>'email',''),receipt->>'session_id',receipt->>'payment_intent_id',
 subtotal,coalesce((receipt->>'shipping_cents')::integer,0),coalesce((receipt->>'tax_cents')::integer,0),
 (receipt->>'total_cents')::integer,receipt->>'currency',receipt->>'shipping_name',receipt->>'shipping_line1',receipt->>'shipping_line2',
 receipt->>'shipping_city',receipt->>'shipping_state',receipt->>'shipping_postal_code',receipt->>'shipping_country',
 'pending',now()) returning id into new_id;
 insert into public.order_items(order_id,product_id,artist_id,title_snapshot,price_cents,quantity,line_total_cents,application_fee_cents,transfer_destination)
 values(new_id,p.id,a.id,coalesce(receipt->>'title',p.title),unit_price,quantity,subtotal,fee,a.stripe_account_id);
 if p.stock_count is not null then update public.products set stock_count=stock_count-quantity where id=p.id; end if;
 return jsonb_build_object('id',new_id,'created',true);
end $function$;

CREATE OR REPLACE FUNCTION public.cs_record_ticket_payment(reservation_uuid uuid, receipt jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare hold public.cs_ticket_reservations%rowtype; ev public.events%rowtype; ticket public.tickets%rowtype; used_count bigint; new_id uuid; reason text;
begin
 -- Global transaction lock before any existing row or FK lock.
 PERFORM concierge_private.lock_v1();
 -- Find event before acquiring locks in the same order as reservation.
 select * into hold from public.cs_ticket_reservations where id=reservation_uuid;
 if not found then raise exception 'Reservation missing'; end if;
 select * into ev from public.events where id=hold.event_id for update;
 select * into hold from public.cs_ticket_reservations where id=reservation_uuid for update;
 if coalesce(receipt->>'site','')<>'cafe-sativa' or coalesce(receipt->>'payment_status','')<>'paid' or coalesce(receipt->>'currency','')<>'usd' or coalesce(receipt->>'user_id','')<>hold.user_id::text or coalesce(receipt->>'event_id','')<>hold.event_id::text or coalesce((receipt->>'amount_cents')::integer,-1)<>hold.amount_cents or coalesce(receipt->>'session_id','')='' or coalesce(receipt->>'payment_intent_id','')='' then raise exception 'Receipt mismatch'; end if;
 if hold.stripe_session_id is not null and hold.stripe_session_id<>receipt->>'session_id' then raise exception 'Session mismatch'; end if;
 if hold.stripe_payment_intent_id is not null and hold.stripe_payment_intent_id<>receipt->>'payment_intent_id' then raise exception 'Payment mismatch'; end if;
 if hold.state<>'held' then return jsonb_build_object('created',false,'state',hold.state,'ticket_id',hold.ticket_id); end if;
 select * into ticket from public.tickets where event_id=hold.event_id and user_id=hold.user_id;
 select (select count(*) from public.tickets where event_id=hold.event_id and state::text in ('pending','valid','used'))+(select count(*) from public.cs_ticket_reservations where event_id=hold.event_id and id<>hold.id and state='held' and expires_at>now()) into used_count;
 if ticket.id is not null and ticket.state::text<>'refunded' then reason:='Existing ticket requires payment reconciliation';
 elsif ev.status::text not in ('scheduled','live') or ev.starts_at<=now() then reason:='Payment settled after ticket sales closed';
 elsif ev.capacity is not null and used_count>=ev.capacity then reason:='Expired reservation settled after capacity filled'; end if;
 if reason is not null then
  update public.cs_ticket_reservations set state='payment_attention',stripe_session_id=receipt->>'session_id',stripe_payment_intent_id=receipt->>'payment_intent_id',attention_reason=reason where id=hold.id;
  return jsonb_build_object('created',false,'state','payment_attention');
 end if;
 insert into public.tickets(event_id,user_id,source,state,stripe_payment_intent_id,amount_paid_cents) values(hold.event_id,hold.user_id,'purchased','valid',receipt->>'payment_intent_id',hold.amount_cents)
 on conflict(event_id,user_id) do update set source='purchased',state='valid',stripe_payment_intent_id=excluded.stripe_payment_intent_id,amount_paid_cents=excluded.amount_paid_cents,redeemed_at=null,redemption_code=encode(extensions.gen_random_bytes(6),'hex') where tickets.state::text='refunded' returning id into new_id;
 if new_id is null then raise exception 'Ticket changed during fulfillment'; end if;
 update public.cs_ticket_reservations set state='fulfilled',stripe_session_id=receipt->>'session_id',stripe_payment_intent_id=receipt->>'payment_intent_id',ticket_id=new_id where id=hold.id;
 return jsonb_build_object('created',true,'state','fulfilled','ticket_id',new_id);
end $function$;

CREATE OR REPLACE FUNCTION public.cs_reserve_ticket(event_uuid uuid, user_uuid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare ev public.events%rowtype; mem public.memberships%rowtype; old_ticket public.tickets%rowtype; hold public.cs_ticket_reservations%rowtype; included boolean; used_count bigint; granted_id uuid; source_value public.ticket_source;
begin
 -- Global transaction lock before any existing row or FK lock.
 PERFORM concierge_private.lock_v1();
 select * into ev from public.events where id=event_uuid for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if ev.status::text not in ('scheduled','live') or ev.starts_at<=now() then return jsonb_build_object('error','closed'); end if;
 select * into old_ticket from public.tickets where event_id=event_uuid and user_id=user_uuid;
 if found and old_ticket.state::text<>'refunded' then return jsonb_build_object('error','already_ticketed'); end if;
 select * into hold from public.cs_ticket_reservations where event_id=event_uuid and user_id=user_uuid and state='held' and expires_at>now() order by created_at desc limit 1;
 if found then return jsonb_build_object('granted',false,'reservation_id',hold.id,'amount_cents',hold.amount_cents,'session_id',hold.stripe_session_id,'checkout_expires_at',extract(epoch from hold.checkout_expires_at)::bigint,'title',ev.title,'slug',ev.slug); end if;
 select (select count(*) from public.tickets where event_id=event_uuid and state::text in ('pending','valid','used')) + (select count(*) from public.cs_ticket_reservations where event_id=event_uuid and state='held' and expires_at>now()) into used_count;
 if ev.capacity is not null and used_count>=ev.capacity then return jsonb_build_object('error','sold_out'); end if;
 select * into mem from public.memberships where user_id=user_uuid;
 included := (not found or (mem.status::text='active' and (mem.current_period_end is null or mem.current_period_end>now()))) and coalesce(mem.tier::text,'explorer')=any(ev.free_for_tiers::text[]);
 if ev.ticket_price_cents=0 or included then
  source_value := case when included then 'tier_included'::public.ticket_source else 'comp'::public.ticket_source end;
  insert into public.tickets(event_id,user_id,source,state,amount_paid_cents) values(event_uuid,user_uuid,source_value,'valid',0)
  on conflict(event_id,user_id) do update set source=excluded.source,state='valid',amount_paid_cents=0,stripe_payment_intent_id=null,redeemed_at=null,redemption_code=encode(extensions.gen_random_bytes(6),'hex') where tickets.state::text='refunded' returning id into granted_id;
  if granted_id is null then raise exception 'Ticket changed during grant'; end if;
  return jsonb_build_object('granted',true,'ticket_id',granted_id,'source',source_value);
 end if;
 if ev.ticket_price_cents<=0 then return jsonb_build_object('error','invalid_price'); end if;
 insert into public.cs_ticket_reservations(event_id,user_id,amount_cents) values(event_uuid,user_uuid,ev.ticket_price_cents) returning * into hold;
 return jsonb_build_object('granted',false,'reservation_id',hold.id,'amount_cents',hold.amount_cents,'session_id',null,'checkout_expires_at',extract(epoch from hold.checkout_expires_at)::bigint,'title',ev.title,'slug',ev.slug);
end $function$;


CREATE FUNCTION concierge_private.requester_v1(p_user_id uuid,p_session_id text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_user_id IS NOT NULL THEN RETURN 'u:'||p_user_id::text; END IF;
 IF p_session_id IS NULL OR length(p_session_id) NOT BETWEEN 1 AND 256
    OR p_session_id<>btrim(p_session_id) OR p_session_id ~ '[[:cntrl:]]' THEN RETURN NULL; END IF;
 RETURN 's:'||p_session_id;
END $$;
CREATE FUNCTION concierge_private.valid_payload_v1(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 RETURN coalesce(jsonb_typeof(p)='object'
  AND p ?& ARRAY['version','host','message','conversation_id','surface','room_id']
  AND ((p->'version'='1'::jsonb AND (SELECT count(*)=6 FROM jsonb_object_keys(p)))
    OR (p->'version'='2'::jsonb AND (SELECT count(*)=7 FROM jsonb_object_keys(p))
      AND p ? 'issued_at' AND jsonb_typeof(p->'issued_at')='number'
      AND p->>'issued_at' ~ '^[0-9]{1,15}$'
      AND (p->>'issued_at')::numeric BETWEEN 0 AND 281474976710655))
  AND jsonb_typeof(p->'host')='string' AND p->>'host' IN ('laviche','ginger','ahnika')
  AND jsonb_typeof(p->'message')='string' AND length(p->>'message') BETWEEN 1 AND 2000
  AND p->>'message'=btrim(p->>'message')
  AND jsonb_typeof(p->'surface')='string' AND p->>'surface' IN ('web-chat','mall-3d','email')
  AND (p->'conversation_id'='null'::jsonb OR (jsonb_typeof(p->'conversation_id')='string'
    AND p->>'conversation_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'))
  AND (p->'room_id'='null'::jsonb OR (jsonb_typeof(p->'room_id')='string'
    AND length(p->>'room_id') BETWEEN 1 AND 128 AND length(btrim(p->>'room_id'))>0 AND p->>'room_id' !~ '[[:cntrl:]]')),false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
-- UUIDv7 fixes issuance into the key itself: changing a body timestamp cannot
-- revive the same missing key. No client-provided wall clock is authoritative.
CREATE FUNCTION concierge_private.issued_at_v2(p_id uuid) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
 RETURN ('x'||left(replace(p_id::text,'-',''),12))::bit(48)::bigint;
END $$;
CREATE FUNCTION concierge_private.missing_error_v2(p_id uuid,p_payload jsonb,p concierge_private.policy,t timestamptz)
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE issued bigint; now_ms bigint; floor_ms bigint;
BEGIN
 IF p_payload->'version'<>'2'::jsonb THEN RETURN 'request_expired'; END IF;
 issued:=concierge_private.issued_at_v2(p_id);
 IF issued IS NULL OR issued IS DISTINCT FROM (p_payload->>'issued_at')::bigint THEN RETURN 'invalid_request'; END IF;
 IF p.replay_max_age_seconds IS NULL OR p.max_future_skew_seconds IS NULL THEN RETURN 'policy_unavailable'; END IF;
 now_ms:=floor(extract(epoch FROM t)*1000)::bigint;
 SELECT reject_before_ms INTO floor_ms FROM concierge_private.lifecycle WHERE singleton;
 IF floor_ms IS NULL THEN RETURN 'policy_unavailable'; END IF;
 -- Inclusive expiration boundary, shared by status, admission and cleanup.
 IF issued<=floor_ms OR issued<=now_ms-p.replay_max_age_seconds*1000 THEN RETURN 'request_expired'; END IF;
 IF issued>now_ms+p.max_future_skew_seconds*1000 THEN RETURN 'invalid_request'; END IF;
 RETURN NULL;
END $$;
-- Age alone is not irreversible: a future policy expansion or DB clock change
-- could admit that missing key. Only immutable v1 rejection or the committed
-- monotonic floor permits a client to clear its original pending turn safely.
CREATE FUNCTION concierge_private.expired_terminal_v2(p_id uuid,p_payload jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(p_payload->'version'='1'::jsonb
   OR concierge_private.issued_at_v2(p_id)<=(SELECT reject_before_ms FROM concierge_private.lifecycle WHERE singleton),false)
$$;
CREATE FUNCTION concierge_private.valid_receipt_v1(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p IS NULL THEN RETURN true; END IF;
 RETURN coalesce(jsonb_typeof(p)='object'
  AND p ?& ARRAY['request_id','message_id','input_tokens','output_tokens']
  AND (SELECT count(*)=4 FROM jsonb_object_keys(p))
  AND (p->'request_id'='null'::jsonb OR (jsonb_typeof(p->'request_id')='string' AND p->>'request_id' ~ '^[A-Za-z0-9_-]{1,128}$'))
  AND (p->'message_id'='null'::jsonb OR (jsonb_typeof(p->'message_id')='string' AND p->>'message_id' ~ '^[A-Za-z0-9_-]{1,128}$'))
  AND (p->'input_tokens'='null'::jsonb OR (jsonb_typeof(p->'input_tokens')='number' AND p->>'input_tokens' ~ '^[0-9]{1,10}$' AND (p->>'input_tokens')::numeric<=2147483647))
  AND (p->'output_tokens'='null'::jsonb OR (jsonb_typeof(p->'output_tokens')='number' AND p->>'output_tokens' ~ '^[0-9]{1,10}$' AND (p->>'output_tokens')::numeric<=2147483647)),false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION concierge_private.owned_v1(c public.host_conversations,r concierge_private.requests,allow_ended boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(c.id=r.conversation_id AND c.host_agent=r.host AND (allow_ended OR c.ended_at IS NULL)
  AND ((r.user_id IS NOT NULL AND c.user_id=r.user_id)
    OR (r.user_id IS NULL AND c.user_id IS NULL AND c.session_id=r.session_id)),false)
$$;
CREATE FUNCTION concierge_private.result_v1(r concierge_private.requests) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('state',r.state,'request_id',r.request_id,'conversation_id',r.conversation_id,
   'remaining',r.remaining_at_admission,'admitted',false)
   || CASE WHEN r.state='completed' THEN jsonb_build_object('response',r.response) ELSE '{}'::jsonb END
$$;

CREATE FUNCTION public.concierge_admit_v1(p_user_id uuid,p_session_id text,p_request_id uuid,p_payload jsonb,p_tier text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE k text; r concierge_private.requests; c public.host_conversations; p concierge_private.policy;
 t timestamptz; missing_error text; cid uuid; lim integer; win interval; used bigint; legacy bigint; active bigint; global_used bigint; cost numeric;
BEGIN
 k:=concierge_private.requester_v1(p_user_id,p_session_id);
 IF k IS NULL OR p_request_id IS NULL OR NOT concierge_private.valid_payload_v1(p_payload)
    OR p_tier IS NULL OR p_tier NOT IN ('anonymous','explorer','regular','vip')
    OR (p_user_id IS NULL AND p_tier<>'anonymous') THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
 PERFORM concierge_private.lock_v1();
 t:=clock_timestamp();
 SELECT * INTO r FROM concierge_private.requests WHERE requester=k AND request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF r.redacted OR r.content_expires_at<=t THEN RETURN jsonb_build_object('error','gone')
   || CASE WHEN r.state IN ('completed','cancelled','failed') THEN jsonb_build_object('terminal',true) ELSE '{}'::jsonb END; END IF;
  IF r.payload IS DISTINCT FROM p_payload THEN RETURN jsonb_build_object('error','conflict'); END IF;
  SELECT * INTO c FROM public.host_conversations WHERE id=r.conversation_id FOR UPDATE;
  IF NOT concierge_private.owned_v1(c,r,r.state='completed') THEN RETURN jsonb_build_object('error','forbidden'); END IF;
  IF r.state='reserved' AND r.lease_until<=t THEN
   UPDATE concierge_private.requests SET state='cancelled',charged=false,finished_at=t WHERE requester=k AND request_id=p_request_id RETURNING * INTO r;
  END IF;
  RETURN concierge_private.result_v1(r);
 END IF;
 -- Explicit ownership is checked before policy/quota errors. No writes on denial.
 cid:=(p_payload->>'conversation_id')::uuid;
 IF cid IS NOT NULL THEN
  SELECT * INTO c FROM public.host_conversations WHERE id=cid FOR UPDATE;
  IF c.id IS NULL OR c.host_agent IS DISTINCT FROM p_payload->>'host' OR c.ended_at IS NOT NULL
     OR NOT coalesce(CASE WHEN p_user_id IS NOT NULL THEN c.user_id=p_user_id ELSE c.user_id IS NULL AND c.session_id=p_session_id END,false)
  THEN RETURN jsonb_build_object('error','conversation_unavailable','admitted',false); END IF;
 END IF;
 SELECT * INTO p FROM concierge_private.policy WHERE singleton;
 IF NOT FOUND OR NOT p.enabled OR NOT p.legacy_drained OR NOT p.charged_failures_approved
   OR p.global_inflight IS NULL OR p.global_admissions IS NULL OR p.global_window_seconds IS NULL
   OR p.global_budget_microusd IS NULL OR p.max_request_cost_microusd IS NULL
   OR p.max_prompt_bytes IS NULL OR p.max_input_messages IS NULL OR p.max_output_tokens IS NULL
   OR p.max_reply_chars IS NULL OR p.lease_seconds IS NULL OR p.legacy_cutoff IS NULL OR p.legacy_cutoff>t
   OR p.retention_seconds IS NULL OR p.content_retention_seconds IS NULL
   OR p.replay_max_age_seconds IS NULL OR p.max_future_skew_seconds IS NULL THEN RETURN jsonb_build_object('error','policy_unavailable'); END IF;
 missing_error:=concierge_private.missing_error_v2(p_request_id,p_payload,p,t);
 IF missing_error IS NOT NULL THEN RETURN jsonb_build_object('error',missing_error)
   || CASE WHEN missing_error='request_expired' AND concierge_private.expired_terminal_v2(p_request_id,p_payload) THEN jsonb_build_object('terminal',true) ELSE '{}'::jsonb END; END IF;
 -- Only undispatched reservations may expire/refund. Dispatch uncertainty never expires.
 UPDATE concierge_private.requests SET state='cancelled',charged=false,finished_at=t WHERE state='reserved' AND lease_until<=t;
 lim:=CASE p_tier WHEN 'anonymous' THEN 10 WHEN 'explorer' THEN 50 WHEN 'regular' THEN 200 ELSE 1000 END;
 win:=CASE WHEN p_tier='anonymous' THEN interval '1 hour' ELSE interval '1 day' END;
 SELECT count(*) INTO used FROM concierge_private.requests WHERE requester=k AND charged AND admitted_at>=t-win;
 -- Before-cutoff legacy messages only. All legacy writers must be drained before enabling.
 SELECT count(*) INTO legacy FROM public.host_messages m JOIN public.host_conversations h ON h.id=m.conversation_id
 WHERE m.role='user' AND m.created_at>=t-win AND m.created_at<p.legacy_cutoff
   AND CASE WHEN p_user_id IS NOT NULL THEN h.user_id=p_user_id ELSE h.user_id IS NULL AND h.session_id=p_session_id END;
 used:=used+legacy;
 IF used>=lim THEN RETURN jsonb_build_object('error','quota_exceeded'); END IF;
 IF EXISTS(SELECT 1 FROM concierge_private.requests WHERE requester=k AND state IN ('reserved','dispatching','uncertain'))
 THEN RETURN jsonb_build_object('error','capacity_busy'); END IF;
 SELECT count(*) INTO active FROM concierge_private.requests WHERE state IN ('reserved','dispatching','uncertain');
 SELECT count(*),coalesce(sum(reserved_cost_microusd),0) INTO global_used,cost FROM concierge_private.requests
 WHERE charged AND admitted_at>=t-make_interval(secs=>p.global_window_seconds);
 IF active>=p.global_inflight OR global_used>=p.global_admissions OR cost+p.max_request_cost_microusd>p.global_budget_microusd
 THEN RETURN jsonb_build_object('error','capacity_busy'); END IF;
 IF cid IS NULL THEN
  SELECT * INTO c FROM public.host_conversations WHERE host_agent=p_payload->>'host' AND ended_at IS NULL
   AND started_at>=t-interval '4 hours'
   AND CASE WHEN p_user_id IS NOT NULL THEN user_id=p_user_id ELSE user_id IS NULL AND session_id=p_session_id END
   ORDER BY started_at DESC,id DESC LIMIT 1 FOR UPDATE;
  cid:=c.id;
 END IF;
 IF cid IS NULL THEN
  INSERT INTO public.host_conversations(user_id,session_id,host_agent,surface,room_id)
   VALUES(p_user_id,CASE WHEN p_user_id IS NULL THEN p_session_id ELSE NULL END,p_payload->>'host',p_payload->>'surface',p_payload->>'room_id') RETURNING id INTO cid;
 END IF;
 INSERT INTO concierge_private.requests(requester,request_id,user_id,session_id,host,conversation_id,payload,fingerprint,
   state,admitted_at,issued_at,content_expires_at,tombstone_retention_seconds,lease_until,tier,policy_version,remaining_at_admission,reserved_cost_microusd,max_reply_chars)
 VALUES(k,p_request_id,p_user_id,CASE WHEN p_user_id IS NULL THEN p_session_id ELSE NULL END,p_payload->>'host',cid,p_payload,
   pg_catalog.sha256(pg_catalog.convert_to(p_payload::text,'UTF8')),'reserved',t,(p_payload->>'issued_at')::bigint,
   t+make_interval(secs=>p.content_retention_seconds),p.retention_seconds,t+make_interval(secs=>p.lease_seconds),p_tier,p.version,
   lim-used-1,p.max_request_cost_microusd,p.max_reply_chars) RETURNING * INTO r;
 RETURN concierge_private.result_v1(r)||jsonb_build_object('admitted',true,'requester',k,'owner_token',r.owner_token,
  'policy',jsonb_build_object('version',p.version,'max_prompt_bytes',p.max_prompt_bytes,'max_input_messages',p.max_input_messages,
    'max_output_tokens',p.max_output_tokens,'max_reply_chars',p.max_reply_chars));
END $$;

CREATE FUNCTION public.concierge_dispatch_v1(p_requester text,p_request_id uuid,p_owner_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE r concierge_private.requests; c public.host_conversations; t timestamptz;
BEGIN
 PERFORM concierge_private.lock_v1();
 SELECT * INTO r FROM concierge_private.requests WHERE requester=p_requester AND request_id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','request_missing'); END IF;
 IF r.owner_token IS DISTINCT FROM p_owner_token THEN RETURN jsonb_build_object('error','invalid_token'); END IF;
 IF r.redacted OR r.content_expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('error','gone')
   || CASE WHEN r.state IN ('completed','cancelled','failed') THEN jsonb_build_object('terminal',true) ELSE '{}'::jsonb END; END IF;
 SELECT * INTO c FROM public.host_conversations WHERE id=r.conversation_id FOR UPDATE;
 IF NOT concierge_private.owned_v1(c,r,false) THEN RETURN jsonb_build_object('error','forbidden'); END IF;
 t:=clock_timestamp();
 IF r.state='reserved' AND r.lease_until<=t THEN
  UPDATE concierge_private.requests SET state='cancelled',charged=false,finished_at=t WHERE requester=p_requester AND request_id=p_request_id;
  RETURN jsonb_build_object('dispatch_granted',false,'state','cancelled');
 END IF;
 IF r.state<>'reserved' THEN RETURN jsonb_build_object('dispatch_granted',false,'state',r.state); END IF;
 UPDATE concierge_private.requests SET state='dispatching',dispatch_marked_at=t WHERE requester=p_requester AND request_id=p_request_id;
 RETURN jsonb_build_object('dispatch_granted',true,'state','dispatching');
END $$;

CREATE FUNCTION public.concierge_complete_v1(p_requester text,p_request_id uuid,p_owner_token uuid,p_user_text text,p_reply text,p_provider_terminal boolean,p_provider_receipt jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE r concierge_private.requests; c public.host_conversations; t timestamptz; mt timestamptz; reply jsonb;
BEGIN
 PERFORM concierge_private.lock_v1();
 SELECT * INTO r FROM concierge_private.requests WHERE requester=p_requester AND request_id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','request_missing'); END IF;
 IF r.owner_token IS DISTINCT FROM p_owner_token THEN RETURN jsonb_build_object('error','invalid_token'); END IF;
 IF r.redacted OR r.content_expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('error','gone')
   || CASE WHEN r.state IN ('completed','cancelled','failed') THEN jsonb_build_object('terminal',true) ELSE '{}'::jsonb END; END IF;
 SELECT * INTO c FROM public.host_conversations WHERE id=r.conversation_id FOR UPDATE;
 IF NOT concierge_private.owned_v1(c,r,r.state='completed') THEN RETURN jsonb_build_object('error','forbidden'); END IF;
 IF r.state='completed' THEN RETURN concierge_private.result_v1(r); END IF;
 IF NOT concierge_private.valid_receipt_v1(p_provider_receipt) THEN RETURN jsonb_build_object('error','invalid_receipt'); END IF;
 IF p_user_text IS DISTINCT FROM r.payload->>'message' OR p_reply IS NULL OR length(btrim(p_reply))=0 OR length(p_reply)>r.max_reply_chars
 THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
 t:=clock_timestamp();
 IF r.state='reserved' AND r.lease_until<=t THEN
  UPDATE concierge_private.requests SET state='cancelled',charged=false,finished_at=t WHERE requester=p_requester AND request_id=p_request_id;
  RETURN jsonb_build_object('error','expired','terminal',true);
 END IF;
 IF (r.state='reserved' AND p_provider_terminal IS DISTINCT FROM false)
   OR (r.state IN ('dispatching','uncertain') AND p_provider_terminal IS DISTINCT FROM true)
   OR r.state NOT IN ('reserved','dispatching','uncertain') THEN RETURN jsonb_build_object('error','invalid_state'); END IF;
 SELECT greatest(t,max(created_at)+interval '1 microsecond') INTO mt FROM public.host_messages WHERE conversation_id=r.conversation_id;
 INSERT INTO public.host_messages(id,conversation_id,role,content,created_at) VALUES
   (r.user_message_id,r.conversation_id,'user',p_user_text,mt),
   (r.assistant_message_id,r.conversation_id,'assistant',p_reply,mt+interval '1 microsecond');
 reply:=jsonb_build_object('message',p_reply,'conversation_id',r.conversation_id,'host',r.host,'remaining',r.remaining_at_admission,'memory_saved',true);
 UPDATE concierge_private.requests SET state='completed',response=reply,finished_at=t,provider_receipt=coalesce(p_provider_receipt,provider_receipt) WHERE requester=p_requester AND request_id=p_request_id RETURNING * INTO r;
 RETURN concierge_private.result_v1(r);
END $$;

CREATE FUNCTION public.concierge_finish_v1(p_requester text,p_request_id uuid,p_owner_token uuid,p_outcome text,p_provider_receipt jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE r concierge_private.requests; t timestamptz;
BEGIN
 PERFORM concierge_private.lock_v1();
 SELECT * INTO r FROM concierge_private.requests WHERE requester=p_requester AND request_id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','request_missing'); END IF;
 IF r.owner_token IS DISTINCT FROM p_owner_token THEN RETURN jsonb_build_object('error','invalid_token'); END IF;
 t:=clock_timestamp();
 -- A terminal-success commit racing a failed acknowledgment must win. Never
 -- downgrade COMPLETED or expose its content through this reconciliation path.
 IF r.state='completed' THEN RETURN jsonb_build_object('state',r.state,'request_id',r.request_id); END IF;
 IF NOT concierge_private.valid_receipt_v1(p_provider_receipt) THEN RETURN jsonb_build_object('error','invalid_receipt'); END IF;
 IF p_outcome='no_dispatch' AND r.state='reserved' THEN
  UPDATE concierge_private.requests SET state='cancelled',charged=false,finished_at=t WHERE requester=p_requester AND request_id=p_request_id RETURNING * INTO r;
 ELSIF p_outcome='provider_terminal_failure' AND r.state IN ('dispatching','uncertain') THEN
  UPDATE concierge_private.requests SET state='failed',finished_at=t,provider_receipt=CASE WHEN redacted OR content_expires_at<=t THEN NULL ELSE coalesce(p_provider_receipt,provider_receipt) END WHERE requester=p_requester AND request_id=p_request_id RETURNING * INTO r;
 ELSIF p_outcome='uncertain' AND r.state IN ('dispatching','uncertain') THEN
  UPDATE concierge_private.requests SET state='uncertain' WHERE requester=p_requester AND request_id=p_request_id RETURNING * INTO r;
 ELSE RETURN jsonb_build_object('error','invalid_state'); END IF;
 -- Do not expose content via finish, including after ownership change/deletion.
 RETURN jsonb_build_object('state',r.state,'request_id',r.request_id);
END $$;

CREATE FUNCTION public.concierge_status_v1(p_user_id uuid,p_session_id text,p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE k text; r concierge_private.requests; c public.host_conversations; p concierge_private.policy; missing_error text; t timestamptz;
BEGIN
 k:=concierge_private.requester_v1(p_user_id,p_session_id);
 IF k IS NULL OR p_request_id IS NULL OR NOT concierge_private.valid_payload_v1(p_payload) THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
 -- Read-only with respect to data; global lock prevents concurrent owner/deletion change.
 PERFORM concierge_private.lock_v1();
 SELECT * INTO r FROM concierge_private.requests WHERE requester=k AND request_id=p_request_id;
 SELECT * INTO c FROM public.host_conversations WHERE id=r.conversation_id;
 t:=clock_timestamp();
 IF r.request_id IS NULL THEN
  SELECT * INTO p FROM concierge_private.policy WHERE singleton;
  missing_error:=concierge_private.missing_error_v2(p_request_id,p_payload,p,t);
  IF missing_error IS NOT NULL THEN RETURN jsonb_build_object('error',missing_error)
   || CASE WHEN missing_error='request_expired' AND concierge_private.expired_terminal_v2(p_request_id,p_payload) THEN jsonb_build_object('terminal',true) ELSE '{}'::jsonb END; END IF;
  RETURN jsonb_build_object('error','request_missing','recovery_required',true);
 END IF;
 IF r.redacted OR r.content_expires_at<=t THEN RETURN jsonb_build_object('error','gone')
   || CASE WHEN r.state IN ('completed','cancelled','failed') THEN jsonb_build_object('terminal',true) ELSE '{}'::jsonb END; END IF;
 IF r.payload IS DISTINCT FROM p_payload THEN RETURN jsonb_build_object('error','conflict'); END IF;
 IF NOT concierge_private.owned_v1(c,r,r.state='completed') THEN RETURN jsonb_build_object('error','forbidden'); END IF;
 RETURN concierge_private.result_v1(r)||jsonb_build_object('recovery_required',r.state='reserved' AND r.lease_until<=clock_timestamp());
END $$;

-- Statement trigger takes the global lock BEFORE an UPDATE/DELETE obtains row locks.
-- Triggers are INVOKER: client roles lacking private-schema access fail closed.
CREATE FUNCTION concierge_private.guard_statement_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM concierge_private.lock_v1();
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'concierge tables cannot be truncated' USING ERRCODE='55000'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION concierge_private.guard_conversation_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  -- Keep charge, state, timestamps, identity and key. No replay and no dispatch refund.
  -- Detached tombstones have no message/payload/response/hash content.
  UPDATE concierge_private.requests SET redacted=true,redacted_at=coalesce(redacted_at,clock_timestamp()),payload=NULL,fingerprint=NULL,response=NULL,provider_receipt=NULL,conversation_id=NULL
   WHERE conversation_id=OLD.id;
  RETURN OLD;
 END IF;
 IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'conversation identity is immutable' USING ERRCODE='55000'; END IF;
 IF (NEW.user_id,NEW.session_id,NEW.host_agent,NEW.ended_at) IS DISTINCT FROM (OLD.user_id,OLD.session_id,OLD.host_agent,OLD.ended_at)
   AND EXISTS(SELECT 1 FROM concierge_private.requests WHERE conversation_id=OLD.id AND state IN ('reserved','dispatching','uncertain'))
 THEN RAISE EXCEPTION 'conversation has unresolved concierge work' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
-- Profile deletion cascades must acquire the same lock BEFORE profile tuple/FK locks.
CREATE TRIGGER concierge_profile_statement BEFORE DELETE OR TRUNCATE ON public.profiles
 FOR EACH STATEMENT EXECUTE FUNCTION concierge_private.guard_statement_v1();
CREATE TRIGGER concierge_profile_identity_statement BEFORE UPDATE OF id ON public.profiles
 FOR EACH STATEMENT EXECUTE FUNCTION concierge_private.guard_statement_v1();
CREATE TRIGGER concierge_conversation_statement BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.host_conversations
 FOR EACH STATEMENT EXECUTE FUNCTION concierge_private.guard_statement_v1();
CREATE TRIGGER concierge_conversation_row BEFORE UPDATE OR DELETE ON public.host_conversations
 FOR EACH ROW EXECUTE FUNCTION concierge_private.guard_conversation_v1();
-- Message mutations redact cached content too, so deletion cannot leave replayable copies.
CREATE FUNCTION concierge_private.guard_message_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE last_at timestamptz;
BEGIN
 IF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM concierge_private.requests WHERE conversation_id=NEW.conversation_id
    AND state IN ('reserved','dispatching','uncertain') AND NEW.id NOT IN (user_message_id,assistant_message_id))
  THEN RAISE EXCEPTION 'conversation has unresolved concierge work' USING ERRCODE='55000'; END IF;
  PERFORM 1 FROM public.host_conversations WHERE id=NEW.conversation_id FOR UPDATE;
  SELECT max(created_at) INTO last_at FROM public.host_messages WHERE conversation_id=NEW.conversation_id;
  NEW.created_at:=greatest(clock_timestamp(),NEW.created_at,last_at+interval '1 microsecond');
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.conversation_id,NEW.created_at,NEW.role) IS DISTINCT FROM (OLD.id,OLD.conversation_id,OLD.created_at,OLD.role)
 THEN RAISE EXCEPTION 'message identity, ordering and role are immutable' USING ERRCODE='55000'; END IF;
 UPDATE concierge_private.requests SET redacted=true,redacted_at=coalesce(redacted_at,clock_timestamp()),payload=NULL,fingerprint=NULL,response=NULL,provider_receipt=NULL
   WHERE conversation_id=OLD.conversation_id AND (user_message_id=OLD.id OR assistant_message_id=OLD.id);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER concierge_message_statement BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.host_messages
 FOR EACH STATEMENT EXECUTE FUNCTION concierge_private.guard_statement_v1();
CREATE TRIGGER concierge_message_row BEFORE INSERT OR UPDATE OR DELETE ON public.host_messages
 FOR EACH ROW EXECUTE FUNCTION concierge_private.guard_message_v1();

-- Key issuance and the rejection floor are immutable/monotonic even for direct
-- service-table writers. These guards do not authorize otherwise untrusted SQL.
CREATE FUNCTION concierge_private.guard_request_identity_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.requester,NEW.request_id,NEW.issued_at) IS DISTINCT FROM (OLD.requester,OLD.request_id,OLD.issued_at)
 THEN RAISE EXCEPTION 'request identity and issuance are immutable' USING ERRCODE='55000'; END IF;
 IF TG_OP='INSERT' AND NEW.payload->'version'='2'::jsonb
   AND (concierge_private.issued_at_v2(NEW.request_id) IS NULL
     OR NEW.issued_at IS DISTINCT FROM concierge_private.issued_at_v2(NEW.request_id)
     OR NEW.issued_at IS DISTINCT FROM (NEW.payload->>'issued_at')::bigint)
 THEN RAISE EXCEPTION 'request issuance must match its UUIDv7 key' USING ERRCODE='22023'; END IF;
 IF NOT concierge_private.valid_receipt_v1(NEW.provider_receipt)
 THEN RAISE EXCEPTION 'invalid provider receipt' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER concierge_request_statement BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON concierge_private.requests
 FOR EACH STATEMENT EXECUTE FUNCTION concierge_private.guard_statement_v1();
CREATE TRIGGER concierge_request_identity BEFORE INSERT OR UPDATE ON concierge_private.requests
 FOR EACH ROW EXECUTE FUNCTION concierge_private.guard_request_identity_v2();
CREATE FUNCTION concierge_private.guard_lifecycle_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'UPDATE' OR NEW.reject_before_ms<OLD.reject_before_ms OR NEW.singleton IS DISTINCT FROM OLD.singleton
 THEN RAISE EXCEPTION 'replay rejection floor cannot be removed or decreased' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER concierge_lifecycle_statement BEFORE UPDATE OR DELETE OR TRUNCATE ON concierge_private.lifecycle
 FOR EACH STATEMENT EXECUTE FUNCTION concierge_private.guard_statement_v1();
CREATE TRIGGER concierge_lifecycle_monotonic BEFORE UPDATE OR DELETE ON concierge_private.lifecycle
 FOR EACH ROW EXECUTE FUNCTION concierge_private.guard_lifecycle_v1();

-- OWNER-ONLY candidate. No service-role execute/delete grant, scheduler or cron.
-- A separately approved operator job must invoke bounded transactions and alert
-- on quarantined rows. Do not run against real data under test authorization.
CREATE FUNCTION concierge_private.maintain_v1(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE p concierge_private.policy; r concierge_private.requests; t timestamptz; floor_ms bigint;
 seen integer:=0; cancelled integer:=0; redacted_count integer:=0; quarantined integer:=0; compacted integer:=0; pruned integer:=0;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN RETURN jsonb_build_object('error','invalid_batch_limit'); END IF;
 PERFORM concierge_private.lock_v1();
 t:=clock_timestamp();
 SELECT * INTO p FROM concierge_private.policy WHERE singleton;
 IF NOT FOUND OR p.content_retention_seconds IS NULL OR p.retention_seconds IS NULL
   OR p.replay_max_age_seconds IS NULL OR p.max_future_skew_seconds IS NULL
 THEN RETURN jsonb_build_object('error','policy_unavailable'); END IF;
 -- Advance before pruning in the same transaction and lock as admission/status.
 -- Even a later wider replay policy cannot revive any old purged UUIDv7 key.
 UPDATE concierge_private.lifecycle
 SET reject_before_ms=greatest(reject_before_ms,greatest(0,floor(extract(epoch FROM t)*1000)::bigint-p.replay_max_age_seconds*1000)),last_cleanup_at=t
 WHERE singleton RETURNING reject_before_ms INTO floor_ms;
 IF floor_ms IS NULL THEN RAISE EXCEPTION 'replay rejection floor is missing' USING ERRCODE='55000'; END IF;
 FOR r IN SELECT * FROM concierge_private.requests q
 WHERE (q.state='reserved' AND q.lease_until<=t)
   OR (NOT q.redacted AND coalesce(q.content_expires_at,q.admitted_at+make_interval(secs=>p.content_retention_seconds))<=t)
   OR (q.redacted AND q.state IN ('reserved','dispatching','uncertain') AND q.quarantined_at IS NULL)
   OR (q.redacted AND q.state IN ('completed','cancelled','failed') AND q.owner_token IS NOT NULL)
   OR (q.redacted AND q.state IN ('completed','cancelled','failed') AND q.finished_at IS NOT NULL
       AND q.finished_at<t-make_interval(secs=>greatest(coalesce(q.tombstone_retention_seconds,p.retention_seconds),p.retention_seconds))
       AND q.admitted_at<t-interval '1 day'
       AND (concierge_private.issued_at_v2(q.request_id) IS NULL OR concierge_private.issued_at_v2(q.request_id)<=floor_ms))
 ORDER BY q.admitted_at,q.requester,q.request_id LIMIT p_limit FOR UPDATE SKIP LOCKED
 LOOP
  seen:=seen+1;
  -- No provider call can have happened before a RESERVED lease is cancelled.
  IF r.state='reserved' AND r.lease_until<=t THEN
   UPDATE concierge_private.requests SET state='cancelled',charged=false,finished_at=t
    WHERE requester=r.requester AND request_id=r.request_id RETURNING * INTO r;
   cancelled:=cancelled+1;
  END IF;
  IF NOT r.redacted AND coalesce(r.content_expires_at,r.admitted_at+make_interval(secs=>p.content_retention_seconds))<=t THEN
   UPDATE concierge_private.requests SET redacted=true,redacted_at=t,payload=NULL,fingerprint=NULL,response=NULL,provider_receipt=NULL
    WHERE requester=r.requester AND request_id=r.request_id RETURNING * INTO r;
   redacted_count:=redacted_count+1;
  END IF;
  IF r.redacted AND r.state IN ('reserved','dispatching','uncertain') AND r.quarantined_at IS NULL THEN
   UPDATE concierge_private.requests SET quarantined_at=t,state=CASE WHEN state='dispatching' THEN 'uncertain' ELSE state END
    WHERE requester=r.requester AND request_id=r.request_id RETURNING * INTO r;
   quarantined:=quarantined+1;
  END IF;
  IF r.redacted AND r.state IN ('completed','cancelled','failed') AND r.owner_token IS NOT NULL THEN
   -- Keep only key, lifecycle, accounting and retention/replay evidence. The
   -- requester namespace still identifies a person/session until final pruning.
   UPDATE concierge_private.requests SET user_id=NULL,session_id=NULL,host=NULL,conversation_id=NULL,
    owner_token=NULL,user_message_id=NULL,assistant_message_id=NULL,tier=NULL,policy_version=NULL,
    remaining_at_admission=NULL,max_reply_chars=NULL,provider_receipt=NULL
    WHERE requester=r.requester AND request_id=r.request_id RETURNING * INTO r;
   compacted:=compacted+1;
  END IF;
  IF r.redacted AND r.state IN ('completed','cancelled','failed') AND r.finished_at IS NOT NULL
    AND r.finished_at<t-make_interval(secs=>greatest(coalesce(r.tombstone_retention_seconds,p.retention_seconds),p.retention_seconds))
    AND r.admitted_at<t-interval '1 day'
    AND (concierge_private.issued_at_v2(r.request_id) IS NULL OR concierge_private.issued_at_v2(r.request_id)<=floor_ms)
  THEN
   DELETE FROM concierge_private.requests WHERE requester=r.requester AND request_id=r.request_id;
   pruned:=pruned+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('processed',seen,'cancelled',cancelled,'redacted',redacted_count,
  'quarantined',quarantined,'compacted',compacted,'pruned',pruned,'reject_before_ms',floor_ms);
END $$;

-- All new function default PUBLIC execute privileges revoked in this transaction.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA concierge_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA concierge_private TO service_role;
-- Explicitly remove broad inherited/default execute privileges from maintenance.
REVOKE ALL ON FUNCTION concierge_private.maintain_v1(integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.concierge_admit_v1(uuid,text,uuid,jsonb,text),
 public.concierge_dispatch_v1(text,uuid,uuid),public.concierge_complete_v1(text,uuid,uuid,text,text,boolean,jsonb),
 public.concierge_finish_v1(text,uuid,uuid,text,jsonb),public.concierge_status_v1(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.concierge_admit_v1(uuid,text,uuid,jsonb,text),
 public.concierge_dispatch_v1(text,uuid,uuid),public.concierge_complete_v1(text,uuid,uuid,text,text,boolean,jsonb),
 public.concierge_finish_v1(text,uuid,uuid,text,jsonb),public.concierge_status_v1(uuid,text,uuid,jsonb) TO service_role;
COMMIT;
