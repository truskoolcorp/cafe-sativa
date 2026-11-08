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
 retention_seconds bigint CHECK (retention_seconds >= 86400)
);
INSERT INTO concierge_private.policy(singleton) VALUES(true);
CREATE TABLE concierge_private.requests (
 requester text NOT NULL,
 request_id uuid NOT NULL,
 user_id uuid,
 session_id text,
 host text NOT NULL CHECK (host IN ('laviche','ginger','ahnika')),
 conversation_id uuid REFERENCES public.host_conversations(id) ON DELETE RESTRICT,
 payload jsonb,
 fingerprint bytea,
 redacted boolean NOT NULL DEFAULT false,
 state text NOT NULL CHECK (state IN ('reserved','dispatching','uncertain','completed','cancelled','failed')),
 charged boolean NOT NULL DEFAULT true,
 admitted_at timestamptz NOT NULL,
 lease_until timestamptz NOT NULL,
 dispatch_marked_at timestamptz,
 finished_at timestamptz,
 owner_token uuid NOT NULL DEFAULT gen_random_uuid(),
 user_message_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 assistant_message_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 tier text NOT NULL CHECK (tier IN ('anonymous','explorer','regular','vip')),
 policy_version text NOT NULL,
 remaining_at_admission integer NOT NULL CHECK (remaining_at_admission >= 0),
 reserved_cost_microusd bigint NOT NULL CHECK (reserved_cost_microusd > 0),
 max_reply_chars integer NOT NULL CHECK (max_reply_chars BETWEEN 1 AND 16384),
 response jsonb,
 PRIMARY KEY(requester,request_id),
 CHECK ((user_id IS NOT NULL AND session_id IS NULL AND requester='u:'||user_id::text)
   OR (user_id IS NULL AND session_id IS NOT NULL AND requester='s:'||session_id)),
 CHECK ((state='cancelled') = (NOT charged)),
 CHECK (redacted OR ((state='completed') = (response IS NOT NULL))),
 CHECK ((redacted AND payload IS NULL AND fingerprint IS NULL AND response IS NULL)
   OR (NOT redacted AND conversation_id IS NOT NULL AND jsonb_typeof(payload)='object' AND octet_length(fingerprint)=32)),
 CHECK (user_message_id<>assistant_message_id),
 CHECK (lease_until>admitted_at)
);
CREATE INDEX requests_usage ON concierge_private.requests(requester,admitted_at) WHERE charged;
CREATE INDEX requests_global_usage ON concierge_private.requests(admitted_at) WHERE charged;
CREATE INDEX requests_conversation ON concierge_private.requests(conversation_id);
CREATE INDEX requests_inflight ON concierge_private.requests(state) WHERE state IN ('reserved','dispatching','uncertain');
ALTER TABLE concierge_private.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE concierge_private.policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON concierge_private.requests, concierge_private.policy FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON concierge_private.requests TO service_role;
GRANT SELECT ON concierge_private.policy TO service_role;
-- No DELETE privilege, purge function, retention job, or automatic tombstone expiry.

CREATE FUNCTION concierge_private.lock_v1() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' AS $$
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'concierge requires read committed' USING ERRCODE='25000';
 END IF;
 PERFORM pg_advisory_xact_lock(1128351301,1);
END $$;

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
  AND (SELECT count(*)=6 FROM jsonb_object_keys(p))
  AND p->'version'='1'::jsonb
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
 t timestamptz; cid uuid; lim integer; win interval; used bigint; legacy bigint; active bigint; global_used bigint; cost numeric;
BEGIN
 k:=concierge_private.requester_v1(p_user_id,p_session_id);
 IF k IS NULL OR p_request_id IS NULL OR NOT concierge_private.valid_payload_v1(p_payload)
    OR p_tier IS NULL OR p_tier NOT IN ('anonymous','explorer','regular','vip')
    OR (p_user_id IS NULL AND p_tier<>'anonymous') THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
 PERFORM concierge_private.lock_v1();
 t:=clock_timestamp();
 SELECT * INTO r FROM concierge_private.requests WHERE requester=k AND request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF r.redacted THEN RETURN jsonb_build_object('error','gone'); END IF;
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
   OR p.retention_seconds IS NULL THEN RETURN jsonb_build_object('error','policy_unavailable'); END IF;
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
   state,admitted_at,lease_until,tier,policy_version,remaining_at_admission,reserved_cost_microusd,max_reply_chars)
 VALUES(k,p_request_id,p_user_id,CASE WHEN p_user_id IS NULL THEN p_session_id ELSE NULL END,p_payload->>'host',cid,p_payload,
   pg_catalog.sha256(pg_catalog.convert_to(p_payload::text,'UTF8')),'reserved',t,t+make_interval(secs=>p.lease_seconds),p_tier,p.version,
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
 IF r.redacted THEN RETURN jsonb_build_object('error','gone'); END IF;
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

CREATE FUNCTION public.concierge_complete_v1(p_requester text,p_request_id uuid,p_owner_token uuid,p_user_text text,p_reply text,p_provider_terminal boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE r concierge_private.requests; c public.host_conversations; t timestamptz; mt timestamptz; reply jsonb;
BEGIN
 PERFORM concierge_private.lock_v1();
 SELECT * INTO r FROM concierge_private.requests WHERE requester=p_requester AND request_id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','request_missing'); END IF;
 IF r.owner_token IS DISTINCT FROM p_owner_token THEN RETURN jsonb_build_object('error','invalid_token'); END IF;
 IF r.redacted THEN RETURN jsonb_build_object('error','gone'); END IF;
 SELECT * INTO c FROM public.host_conversations WHERE id=r.conversation_id FOR UPDATE;
 IF NOT concierge_private.owned_v1(c,r,r.state='completed') THEN RETURN jsonb_build_object('error','forbidden'); END IF;
 IF r.state='completed' THEN RETURN concierge_private.result_v1(r); END IF;
 IF p_user_text IS DISTINCT FROM r.payload->>'message' OR p_reply IS NULL OR length(btrim(p_reply))=0 OR length(p_reply)>r.max_reply_chars
 THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
 t:=clock_timestamp();
 IF r.state='reserved' AND r.lease_until<=t THEN
  UPDATE concierge_private.requests SET state='cancelled',charged=false,finished_at=t WHERE requester=p_requester AND request_id=p_request_id;
  RETURN jsonb_build_object('error','expired');
 END IF;
 IF (r.state='reserved' AND p_provider_terminal IS DISTINCT FROM false)
   OR (r.state IN ('dispatching','uncertain') AND p_provider_terminal IS DISTINCT FROM true)
   OR r.state NOT IN ('reserved','dispatching','uncertain') THEN RETURN jsonb_build_object('error','invalid_state'); END IF;
 SELECT greatest(t,max(created_at)+interval '1 microsecond') INTO mt FROM public.host_messages WHERE conversation_id=r.conversation_id;
 INSERT INTO public.host_messages(id,conversation_id,role,content,created_at) VALUES
   (r.user_message_id,r.conversation_id,'user',p_user_text,mt),
   (r.assistant_message_id,r.conversation_id,'assistant',p_reply,mt+interval '1 microsecond');
 reply:=jsonb_build_object('message',p_reply,'conversation_id',r.conversation_id,'host',r.host,'remaining',r.remaining_at_admission,'memory_saved',true);
 UPDATE concierge_private.requests SET state='completed',response=reply,finished_at=t WHERE requester=p_requester AND request_id=p_request_id RETURNING * INTO r;
 RETURN concierge_private.result_v1(r);
END $$;

CREATE FUNCTION public.concierge_finish_v1(p_requester text,p_request_id uuid,p_owner_token uuid,p_outcome text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE r concierge_private.requests; t timestamptz;
BEGIN
 PERFORM concierge_private.lock_v1();
 SELECT * INTO r FROM concierge_private.requests WHERE requester=p_requester AND request_id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','request_missing'); END IF;
 IF r.owner_token IS DISTINCT FROM p_owner_token THEN RETURN jsonb_build_object('error','invalid_token'); END IF;
 t:=clock_timestamp();
 IF p_outcome='no_dispatch' AND r.state='reserved' THEN
  UPDATE concierge_private.requests SET state='cancelled',charged=false,finished_at=t WHERE requester=p_requester AND request_id=p_request_id RETURNING * INTO r;
 ELSIF p_outcome='provider_terminal_failure' AND r.state IN ('dispatching','uncertain') THEN
  UPDATE concierge_private.requests SET state='failed',finished_at=t WHERE requester=p_requester AND request_id=p_request_id RETURNING * INTO r;
 ELSIF p_outcome='uncertain' AND r.state IN ('dispatching','uncertain') THEN
  UPDATE concierge_private.requests SET state='uncertain' WHERE requester=p_requester AND request_id=p_request_id RETURNING * INTO r;
 ELSE RETURN jsonb_build_object('error','invalid_state'); END IF;
 -- Do not expose content via finish, including after ownership change/deletion.
 RETURN jsonb_build_object('state',r.state,'request_id',r.request_id);
END $$;

CREATE FUNCTION public.concierge_status_v1(p_user_id uuid,p_session_id text,p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE k text; r concierge_private.requests; c public.host_conversations;
BEGIN
 k:=concierge_private.requester_v1(p_user_id,p_session_id);
 IF k IS NULL OR p_request_id IS NULL OR NOT concierge_private.valid_payload_v1(p_payload) THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
 -- Read-only with respect to data; global lock prevents concurrent owner/deletion change.
 PERFORM concierge_private.lock_v1();
 SELECT * INTO r FROM concierge_private.requests WHERE requester=k AND request_id=p_request_id;
 SELECT * INTO c FROM public.host_conversations WHERE id=r.conversation_id;
 IF r.request_id IS NULL THEN RETURN jsonb_build_object('error','request_missing'); END IF;
 IF r.redacted THEN RETURN jsonb_build_object('error','gone'); END IF;
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
  UPDATE concierge_private.requests SET redacted=true,payload=NULL,fingerprint=NULL,response=NULL,conversation_id=NULL
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
 UPDATE concierge_private.requests SET redacted=true,payload=NULL,fingerprint=NULL,response=NULL
   WHERE conversation_id=OLD.conversation_id AND (user_message_id=OLD.id OR assistant_message_id=OLD.id);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER concierge_message_statement BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.host_messages
 FOR EACH STATEMENT EXECUTE FUNCTION concierge_private.guard_statement_v1();
CREATE TRIGGER concierge_message_row BEFORE INSERT OR UPDATE OR DELETE ON public.host_messages
 FOR EACH ROW EXECUTE FUNCTION concierge_private.guard_message_v1();

-- All new function default PUBLIC execute privileges revoked in this transaction.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA concierge_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA concierge_private TO service_role;
REVOKE ALL ON FUNCTION public.concierge_admit_v1(uuid,text,uuid,jsonb,text),
 public.concierge_dispatch_v1(text,uuid,uuid),public.concierge_complete_v1(text,uuid,uuid,text,text,boolean),
 public.concierge_finish_v1(text,uuid,uuid,text),public.concierge_status_v1(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.concierge_admit_v1(uuid,text,uuid,jsonb,text),
 public.concierge_dispatch_v1(text,uuid,uuid),public.concierge_complete_v1(text,uuid,uuid,text,text,boolean),
 public.concierge_finish_v1(text,uuid,uuid,text),public.concierge_status_v1(uuid,text,uuid,jsonb) TO service_role;
COMMIT;
