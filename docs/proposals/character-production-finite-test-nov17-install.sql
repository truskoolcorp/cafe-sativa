-- OFFLINE generic finite-test capability installation ONLY: no budget or authority.
-- Three service-role EXECUTE grants require separate action-time approval.
-- No generation or enrollment; exact Nov17 configuration is a separate transaction.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>session_user OR current_user<>'postgres' OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'Direct PG17 postgres required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='character_production_owner' AND NOT(rolcanlogin OR rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'Inert owner required'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole OR member='character_production_owner'::regrole)<>1 OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member='postgres'::regrole AND grantor='supabase_admin'::regrole AND admin_option AND NOT inherit_option AND NOT set_option) THEN RAISE EXCEPTION 'Existing membership changed'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected installer permission'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role' AND NOT rolcanlogin AND NOT rolsuper AND rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolbypassrls) OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator' AND rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN RAISE EXCEPTION 'Service proxy role baseline mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member='service_role'::regrole) OR (SELECT count(*) FROM pg_auth_members WHERE roleid='service_role'::regrole)<>2 OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid='service_role'::regrole AND NOT (m.grantor=(SELECT grantor FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option) AND ((m.member='authenticator'::regrole AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option) OR (m.member=current_user::regrole AND m.admin_option AND m.inherit_option AND m.set_option)))) THEN RAISE EXCEPTION 'Service role membership baseline mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_storage_admin' AND rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND rolconfig=ARRAY['search_path=storage','log_statement=none']::text[]) THEN RAISE EXCEPTION 'Managed Storage role baseline mismatch'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE member='supabase_storage_admin'::regrole OR roleid='supabase_storage_admin'::regrole)<>1 OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member='supabase_storage_admin'::regrole AND roleid='authenticator'::regrole AND grantor=(SELECT oid FROM pg_roles WHERE rolname='supabase_admin') AND NOT admin_option AND NOT inherit_option AND set_option) THEN RAISE EXCEPTION 'Managed Storage membership baseline mismatch'; END IF;
 IF NOT pg_has_role('supabase_storage_admin','service_role','SET') OR pg_has_role('supabase_storage_admin','service_role','USAGE') THEN RAISE EXCEPTION 'Managed Storage effective path mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND r.oid NOT IN (current_user::regrole,'service_role'::regrole,'authenticator'::regrole,'supabase_storage_admin'::regrole) AND (pg_has_role(r.oid,'service_role','USAGE') OR pg_has_role(r.oid,'service_role','SET'))) THEN RAISE EXCEPTION 'Unexpected effective service principal'; END IF;
 IF NOT has_schema_privilege('postgres','public','CREATE WITH GRANT OPTION') THEN RAISE EXCEPTION 'Installer cannot grant temporary schema CREATE'; END IF;
END $$;
CREATE TEMP TABLE private_test_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE private_test_acl ON COMMIT DROP AS
 SELECT 'schema' kind,oid::text identity,nspowner owner,nspacl::text acl FROM pg_namespace WHERE nspname IN('public','character_production')
 UNION ALL SELECT 'function',oid::text,proowner,proacl::text FROM pg_proc WHERE pronamespace IN('public'::regnamespace,'character_production'::regnamespace)
 UNION ALL SELECT 'relation',oid::text,relowner,relacl::text FROM pg_class WHERE relnamespace IN('public'::regnamespace,'character_production'::regnamespace);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname IN('finite_test_authority','finite_test_occurrence')) THEN RAISE EXCEPTION 'Finite capability already installed'; END IF;
 IF to_regprocedure('public.character_production_text_checkpoint_read(text,uuid,text)') IS NULL THEN RAISE EXCEPTION 'Reviewed checkpoint dependency required'; END IF;
END $$;
GRANT character_production_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO character_production_owner;
SET LOCAL ROLE character_production_owner;
CREATE TABLE character_production.finite_test_authority(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 id uuid NOT NULL UNIQUE,actor_id uuid NOT NULL,
 reference text NOT NULL CHECK(reference='zaria-private-test-20261117'),
 owner_message_ids text[] NOT NULL CHECK(cardinality(owner_message_ids) BETWEEN 1 AND 20),
 source_scope jsonb NOT NULL,
 budget_id uuid NOT NULL UNIQUE REFERENCES character_production.text_replenishment_budgets(id),
 authorized_at timestamptz NOT NULL CHECK(authorized_at='2026-11-17T06:00:00Z'),
 expires_at timestamptz NOT NULL CHECK(expires_at='2026-11-18T06:00:00Z'),
 speech_max_chars integer NOT NULL DEFAULT 250 CHECK(speech_max_chars=250),
 included_credits_only boolean NOT NULL DEFAULT true CHECK(included_credits_only),
 enabled boolean NOT NULL DEFAULT false,
 CHECK(budget_id<>'2941c16d-1334-4725-959c-a61c51de2b71'::uuid),
 CHECK(source_scope='{"characterId":"zaria-solenne","roomKey":"gallery","assignmentRole":"primary_host","topic":"art-observation","venueAssetId":"b84f9f4e-af29-476e-b55b-38e146a847c7","venueSha256":"89c327c4a82c3249f8bd1937891cd9dae6a8a34be556fbdab605168e2b845a04","verifiedCollaborators":[]}'::jsonb)
);
CREATE TABLE character_production.finite_test_occurrence(
 authority_id uuid PRIMARY KEY REFERENCES character_production.finite_test_authority(id),
 id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 text_key text NOT NULL UNIQUE CHECK(text_key='daily:2026-11-17:zaria-solenne'),
 text_started boolean NOT NULL DEFAULT false,speech_started boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE character_production.finite_test_authority ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.finite_test_occurrence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.finite_test_authority,character_production.finite_test_occurrence FROM PUBLIC;
CREATE FUNCTION character_production.finite_test_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='finite_test_authority' THEN
   IF OLD.enabled AND NOT NEW.enabled AND to_jsonb(OLD)-'enabled'=to_jsonb(NEW)-'enabled' THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='finite_test_occurrence' THEN
  IF to_jsonb(OLD)-'text_started'-'speech_started'=to_jsonb(NEW)-'text_started'-'speech_started' AND (NOT OLD.text_started OR NEW.text_started) AND (NOT OLD.speech_started OR NEW.speech_started) THEN RETURN NEW; END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'Finite test immutable; no reset, successor or rebinding';
END $$;
CREATE TRIGGER finite_test_authority_immutable BEFORE UPDATE OR DELETE ON character_production.finite_test_authority FOR EACH ROW EXECUTE FUNCTION character_production.finite_test_immutable();
CREATE TRIGGER finite_test_occurrence_immutable BEFORE UPDATE OR DELETE ON character_production.finite_test_occurrence FOR EACH ROW EXECUTE FUNCTION character_production.finite_test_immutable();
CREATE TRIGGER finite_test_authority_no_truncate BEFORE TRUNCATE ON character_production.finite_test_authority FOR EACH STATEMENT EXECUTE FUNCTION character_production.finite_test_immutable();
CREATE TRIGGER finite_test_occurrence_no_truncate BEFORE TRUNCATE ON character_production.finite_test_occurrence FOR EACH STATEMENT EXECUTE FUNCTION character_production.finite_test_immutable();
REVOKE ALL ON FUNCTION character_production.finite_test_immutable() FROM PUBLIC;
CREATE FUNCTION character_production.finite_test_checkpoint_matches(p_key text,p_token uuid,p_digest text,p_output jsonb,p_provider text,p_input integer,p_output_tokens integer) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE content jsonb; editorial jsonb;
BEGIN
 SELECT c.content_json::jsonb INTO content FROM character_production.text_content_checkpoints c JOIN character_production.text_receipt_evidence r ON r.attempt_key=c.attempt_key AND r.attempt_token=c.attempt_token AND r.source_digest=c.source_digest AND r.response_sha256=c.response_sha256
 WHERE c.attempt_key=p_key AND c.attempt_token=p_token AND c.source_digest=p_digest AND c.parser_version='fresh-editorial-v1-zaria250' AND r.provider_id=p_provider AND r.input_tokens=p_input AND r.output_tokens=p_output_tokens AND r.model='claude-haiku-4-5-20251001' AND r.stop_reason='end_turn';
 IF content IS NULL OR jsonb_typeof(content)<>'array' OR jsonb_array_length(content)<>1 OR content->0->>'type' IS DISTINCT FROM 'text' OR jsonb_typeof(content->0->'text') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 editorial:=(content->0->>'text')::jsonb;
 RETURN jsonb_typeof(editorial)='object' AND editorial=p_output AND jsonb_typeof(editorial->'spokenScript')='string' AND char_length(editorial->>'spokenScript') BETWEEN 1 AND 250;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION character_production.finite_test_checkpoint_matches(text,uuid,text,jsonb,text,integer,integer) FROM PUBLIC;
CREATE FUNCTION public.character_production_finite_test_context() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l character_production.finite_test_authority;o character_production.finite_test_occurrence;a character_production.text_replenishment_attempts;b character_production.text_replenishment_budgets;stamp timestamptz;active boolean;identity jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN NULL; END IF;
 SELECT * INTO l FROM character_production.finite_test_authority WHERE singleton FOR SHARE NOWAIT;
 IF l.id IS NULL THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();SELECT * INTO b FROM character_production.text_replenishment_budgets WHERE id=l.budget_id;
 active:=l.enabled AND l.authorized_at<=stamp AND l.expires_at>stamp AND to_char(stamp AT TIME ZONE 'America/Chicago','YYYY-MM-DD')='2026-11-17'
 AND public.cs_cafe_metricool_is_admin(l.actor_id) IS TRUE AND NOT EXISTS(SELECT 1 FROM unnest(l.owner_message_ids) m WHERE m IS NULL OR m!~'^Sentinel_[a-f0-9]{32}$')
 AND b.enabled AND b.id=l.budget_id AND b.period='2026-11' AND b.expires_at=l.expires_at AND b.max_cost_cents=10 AND b.cap_cents=10 AND b.model='claude-haiku-4-5-20251001' AND b.input_micro_usd=1 AND b.output_micro_usd=5;
 SELECT * INTO o FROM character_production.finite_test_occurrence WHERE authority_id=l.id;
 IF o.id IS NULL THEN
  IF active IS DISTINCT FROM true OR b.reserved_cents<>0 OR EXISTS(SELECT 1 FROM character_production.text_replenishment_attempts WHERE key='daily:2026-11-17:zaria-solenne' OR budget_id=b.id) OR EXISTS(SELECT 1 FROM character_production.preparation_occurrences WHERE text_key='daily:2026-11-17:zaria-solenne') THEN RETURN NULL; END IF;
  INSERT INTO character_production.finite_test_occurrence(authority_id,text_key) VALUES(l.id,'daily:2026-11-17:zaria-solenne') ON CONFLICT DO NOTHING;
  SELECT * INTO o FROM character_production.finite_test_occurrence WHERE authority_id=l.id;
 END IF;
 IF o.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO a FROM character_production.text_replenishment_attempts WHERE key=o.text_key;
 IF a.key IS NOT NULL AND (a.budget_id IS DISTINCT FROM b.id OR a.created_at<o.created_at OR a.source_snapshot->>'characterId' IS DISTINCT FROM 'zaria-solenne' OR a.source_snapshot->>'roomKey' IS DISTINCT FROM 'gallery') THEN RETURN NULL; END IF;
 IF o.text_started AND a.state='awaiting_audio_binding_and_qa' AND a.provider_id IS NOT NULL AND jsonb_typeof(a.output->'spokenScript')='string' AND char_length(a.output->>'spokenScript') BETWEEN 1 AND l.speech_max_chars AND character_production.finite_test_checkpoint_matches(a.key,a.token,a.source_digest,a.output,a.provider_id,a.input_tokens,a.output_tokens) THEN
 identity:=jsonb_build_object('textAttemptKey',a.key,'textAttemptToken',a.token,'textSourceDigest',a.source_digest,'scriptSha256',encode(sha256(convert_to(a.output->>'spokenScript','UTF8')),'hex'));
 END IF;
 RETURN jsonb_build_object('occurrenceId',o.id,'textKey',o.text_key,'textStarted',o.text_started,'speechStarted',o.speech_started,'textState',a.state,'identity',identity,'active',coalesce(active,false),'sourceScope',CASE WHEN active THEN l.source_scope END,'lease',CASE WHEN active THEN jsonb_build_object('id',b.id,'period',b.period,'model',b.model,'maxCostCents',b.max_cost_cents,'monthlyCapCents',b.cap_cents,'expiresAt',floor(extract(epoch FROM b.expires_at)*1000)::bigint,'rateEvidence',b.rate_evidence,'inputMicroUsdPerToken',b.input_micro_usd,'outputMicroUsdPerToken',b.output_micro_usd) END);
END $$;
REVOKE ALL ON FUNCTION public.character_production_finite_test_context() FROM PUBLIC;
CREATE FUNCTION public.character_production_finite_test_speech_source(p_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l character_production.finite_test_authority;o character_production.finite_test_occurrence;a character_production.text_replenishment_attempts;stamp timestamptz:=clock_timestamp();
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR p_key IS DISTINCT FROM 'daily:2026-11-17:zaria-solenne' OR to_char(stamp AT TIME ZONE 'America/Chicago','YYYY-MM-DD')<>'2026-11-17' THEN RETURN NULL; END IF;
 SELECT * INTO l FROM character_production.finite_test_authority WHERE singleton FOR SHARE NOWAIT;
 IF l.id IS NULL OR NOT l.enabled OR l.authorized_at>stamp OR l.expires_at<=stamp OR public.cs_cafe_metricool_is_admin(l.actor_id) IS DISTINCT FROM true OR EXISTS(SELECT 1 FROM unnest(l.owner_message_ids) m WHERE m IS NULL OR m!~'^Sentinel_[a-f0-9]{32}$') THEN RETURN NULL; END IF;
 SELECT * INTO o FROM character_production.finite_test_occurrence WHERE authority_id=l.id;
 SELECT * INTO a FROM character_production.text_replenishment_attempts WHERE key=p_key;
 IF o.id IS NULL OR NOT o.text_started OR o.text_key IS DISTINCT FROM a.key OR a.key IS NULL OR a.budget_id IS DISTINCT FROM l.budget_id OR a.created_at<o.created_at OR a.state<>'awaiting_audio_binding_and_qa' OR a.provider_id IS NULL OR jsonb_typeof(a.output->'spokenScript') IS DISTINCT FROM 'string' OR char_length(a.output->>'spokenScript') NOT BETWEEN 1 AND l.speech_max_chars OR a.source_snapshot->>'characterId' IS DISTINCT FROM 'zaria-solenne' OR a.source_snapshot->>'roomKey' IS DISTINCT FROM 'gallery' OR a.source_snapshot->>'voiceId' IS DISTINCT FROM '5zneNR4v1Uw5AjIZ9Un4' OR NOT character_production.finite_test_checkpoint_matches(a.key,a.token,a.source_digest,a.output,a.provider_id,a.input_tokens,a.output_tokens) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('scopeId',l.id,'attempt',jsonb_build_object('key',a.key,'token',a.token,'state',a.state,'source_digest',a.source_digest,'source_snapshot',a.source_snapshot,'output',a.output,'provider_id',a.provider_id,'input_tokens',a.input_tokens,'output_tokens',a.output_tokens),'authority',jsonb_build_object('reference',l.reference,'scope','zaria-gallery-organic-fresh-speech','authorizedAt',floor(extract(epoch FROM l.authorized_at)*1000)::bigint,'expiresAt',floor(extract(epoch FROM l.expires_at)*1000)::bigint,'revoked',false));
END $$;
REVOKE ALL ON FUNCTION public.character_production_finite_test_speech_source(text) FROM PUBLIC;
CREATE FUNCTION public.character_production_finite_test_claim(p_occurrence uuid,p_phase text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb;o character_production.finite_test_occurrence;b character_production.text_replenishment_budgets;s jsonb;
BEGIN
 IF p_phase IS NULL OR p_phase NOT IN('text','speech') THEN RETURN false; END IF;
 c:=public.character_production_finite_test_context();
 IF c IS NULL OR c->'active' IS DISTINCT FROM 'true'::jsonb OR c->>'occurrenceId' IS DISTINCT FROM p_occurrence::text THEN RETURN false; END IF;
 SELECT * INTO b FROM character_production.text_replenishment_budgets WHERE id=(c#>>'{lease,id}')::uuid FOR UPDATE;
 SELECT * INTO o FROM character_production.finite_test_occurrence WHERE id=p_occurrence FOR UPDATE;
 -- Refresh under admission locks; no release/retry of a claimed phase.
 c:=public.character_production_finite_test_context();
 IF c IS NULL OR c->'active' IS DISTINCT FROM 'true'::jsonb OR c->>'occurrenceId' IS DISTINCT FROM p_occurrence::text THEN RETURN false; END IF;
 IF p_phase='text' THEN
 IF o.text_started OR c->>'textState' IS NOT NULL OR b.reserved_cents<>0 OR EXISTS(SELECT 1 FROM character_production.text_replenishment_attempts WHERE key=o.text_key OR budget_id=b.id) OR EXISTS(SELECT 1 FROM character_production.preparation_occurrences WHERE text_key=o.text_key) THEN RETURN false; END IF;
 UPDATE character_production.finite_test_occurrence SET text_started=true WHERE id=o.id;
 ELSE
 IF o.speech_started OR c->'identity' IS NULL OR c->'identity'='null'::jsonb THEN RETURN false; END IF;
 s:=public.character_production_finite_test_speech_source(o.text_key);
 IF s IS NULL OR s#>>'{attempt,token}' IS DISTINCT FROM c#>>'{identity,textAttemptToken}' OR s#>>'{attempt,source_digest}' IS DISTINCT FROM c#>>'{identity,textSourceDigest}' THEN RETURN false; END IF;
 UPDATE character_production.finite_test_occurrence SET speech_started=true WHERE id=o.id;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.character_production_finite_test_claim(uuid,text) FROM PUBLIC;
DO $$ DECLARE r record;own oid:='character_production_owner'::regrole;BEGIN
 IF current_user<>'character_production_owner' THEN RAISE EXCEPTION 'Restricted owner required'; END IF;
 FOR r IN SELECT relowner owner,relacl acl FROM pg_class WHERE oid IN('character_production.finite_test_authority'::regclass,'character_production.finite_test_occurrence'::regclass)
 UNION ALL SELECT proowner,proacl FROM pg_proc WHERE oid IN('character_production.finite_test_immutable()'::regprocedure,'character_production.finite_test_checkpoint_matches(text,uuid,text,jsonb,text,integer,integer)'::regprocedure,'public.character_production_finite_test_context()'::regprocedure,'public.character_production_finite_test_claim(uuid,text)'::regprocedure,'public.character_production_finite_test_speech_source(text)'::regprocedure)
 LOOP IF r.owner<>own OR EXISTS(SELECT 1 FROM aclexplode(r.acl) WHERE grantee<>own) THEN RAISE EXCEPTION 'Owner-only finite source required'; END IF; END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.character_production_finite_test_context(),public.character_production_finite_test_claim(uuid,text),public.character_production_finite_test_speech_source(text) TO service_role;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM character_production_owner;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE r text; obj record; BEGIN
 IF pg_has_role('postgres','character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Temporary privileges not removed'; END IF;
 IF EXISTS((SELECT * FROM pg_auth_members EXCEPT SELECT * FROM private_test_members) UNION ALL (SELECT * FROM private_test_members EXCEPT SELECT * FROM pg_auth_members)) THEN RAISE EXCEPTION 'Membership changed'; END IF;
 IF EXISTS(WITH current_acl AS (
 SELECT 'schema' kind,oid::text identity,nspowner owner,nspacl::text acl FROM pg_namespace WHERE nspname IN('public','character_production')
 UNION ALL SELECT 'function',oid::text,proowner,proacl::text FROM pg_proc WHERE pronamespace IN('public'::regnamespace,'character_production'::regnamespace)
 UNION ALL SELECT 'relation',oid::text,relowner,relacl::text FROM pg_class WHERE relnamespace IN('public'::regnamespace,'character_production'::regnamespace))
 SELECT 1 FROM private_test_acl old LEFT JOIN current_acl cur USING(kind,identity) WHERE cur.identity IS NULL OR old.owner IS DISTINCT FROM cur.owner OR old.acl IS DISTINCT FROM cur.acl) THEN RAISE EXCEPTION 'Existing object ACL/owner changed'; END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
 IF has_table_privilege(r,(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname='finite_test_authority'),'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Runtime table grant'; END IF;
 IF r<>'service_role' AND (has_function_privilege(r,'public.character_production_finite_test_context()','EXECUTE') OR has_function_privilege(r,'public.character_production_finite_test_claim(uuid,text)','EXECUTE') OR has_function_privilege(r,'public.character_production_finite_test_speech_source(text)','EXECUTE')) THEN RAISE EXCEPTION 'Public recovery RPC leak'; END IF;
 END LOOP;
 FOR obj IN SELECT oid,proowner,proacl FROM pg_proc WHERE oid IN('public.character_production_finite_test_context()'::regprocedure,'public.character_production_finite_test_claim(uuid,text)'::regprocedure,'public.character_production_finite_test_speech_source(text)'::regprocedure) LOOP
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND (has_function_privilege(r.oid,obj.oid,'EXECUTE') OR pg_has_role(r.oid,'service_role','SET') OR pg_has_role(r.oid,'character_production_owner','SET')) IS DISTINCT FROM (r.rolname IN('postgres','service_role','authenticator','supabase_storage_admin','character_production_owner'))) THEN RAISE EXCEPTION 'Unexpected effective receipt principal'; END IF;
 IF obj.proowner<>'character_production_owner'::regrole OR EXISTS(SELECT 1 FROM aclexplode(obj.proacl) WHERE grantee NOT IN('character_production_owner'::regrole,'service_role'::regrole) OR privilege_type<>'EXECUTE' OR is_grantable) OR NOT has_function_privilege('service_role',obj.oid,'EXECUTE') THEN RAISE EXCEPTION 'Exact non-grantable RPC capability required'; END IF;
 END LOOP;
END $$;
-- Only replace final ROLLBACK after independent review, exact rehearsal and
-- action-time approval covering temporary SET/CREATE plus three runtime grants.
ROLLBACK;
