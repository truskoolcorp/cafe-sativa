-- OFFLINE ONLY. One original occurrence; no successor, grant, activation or spend.
BEGIN;
CREATE TABLE character_production.preparation_lanes(
 id uuid PRIMARY KEY, actor_id uuid NOT NULL, reference text NOT NULL,
 owner_message_ids text[] NOT NULL, source_scope jsonb NOT NULL,
 budget_id uuid NOT NULL REFERENCES character_production.text_replenishment_budgets(id),
 authorized_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 CHECK(reference~'^[A-Za-z0-9_.:-]{1,200}$'),
 CHECK(cardinality(owner_message_ids) BETWEEN 1 AND 20),
 CHECK(expires_at>authorized_at AND expires_at<=authorized_at+interval '31 days'),
 CHECK(jsonb_typeof(source_scope)='object' AND octet_length(source_scope::text)<=8192 AND source_scope->>'characterId' IS NOT DISTINCT FROM 'zaria-solenne' AND source_scope->>'roomKey' IS NOT DISTINCT FROM 'gallery')
);
CREATE TABLE character_production.preparation_binding(name text PRIMARY KEY CHECK(name='zaria-gallery-preparation'),lane_id uuid NOT NULL REFERENCES character_production.preparation_lanes(id));
CREATE TABLE character_production.preparation_occurrences(
 lane_id uuid PRIMARY KEY REFERENCES character_production.preparation_lanes(id),
 id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), text_key text NOT NULL UNIQUE,
 text_started boolean NOT NULL DEFAULT false, speech_started boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(text_key~'^daily:[0-9]{4}-[0-9]{2}-[0-9]{2}:zaria-solenne$')
);
ALTER TABLE character_production.preparation_lanes ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.preparation_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.preparation_occurrences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.preparation_lanes,character_production.preparation_binding,character_production.preparation_occurrences FROM PUBLIC;
CREATE FUNCTION character_production.preparation_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_TABLE_NAME='preparation_lanes' AND TG_OP='UPDATE' THEN
  IF OLD.enabled AND NOT NEW.enabled AND to_jsonb(OLD)-'enabled'=to_jsonb(NEW)-'enabled' THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='preparation_occurrences' AND TG_OP='UPDATE' THEN
  IF to_jsonb(OLD)-'text_started'-'speech_started'=to_jsonb(NEW)-'text_started'-'speech_started' AND (NOT OLD.text_started OR NEW.text_started) AND (NOT OLD.speech_started OR NEW.speech_started) THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Original preparation context immutable; no reset or successor'; END $$;
CREATE TRIGGER preparation_lane_immutable BEFORE UPDATE OR DELETE ON character_production.preparation_lanes FOR EACH ROW EXECUTE FUNCTION character_production.preparation_immutable();
CREATE TRIGGER preparation_binding_immutable BEFORE UPDATE OR DELETE ON character_production.preparation_binding FOR EACH ROW EXECUTE FUNCTION character_production.preparation_immutable();
CREATE TRIGGER preparation_occurrence_immutable BEFORE UPDATE OR DELETE ON character_production.preparation_occurrences FOR EACH ROW EXECUTE FUNCTION character_production.preparation_immutable();
REVOKE ALL ON FUNCTION character_production.preparation_immutable() FROM PUBLIC;
CREATE FUNCTION public.character_production_preparation_context() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l character_production.preparation_lanes; o character_production.preparation_occurrences; a character_production.text_replenishment_attempts; b character_production.text_replenishment_budgets; active boolean; stamp timestamptz; identity jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN NULL; END IF;
 SELECT x.* INTO l FROM character_production.preparation_lanes x JOIN character_production.preparation_binding y ON y.lane_id=x.id WHERE y.name='zaria-gallery-preparation' FOR SHARE OF x NOWAIT;
 IF l.id IS NULL THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 active:=l.enabled AND l.authorized_at<=stamp AND l.expires_at>stamp AND public.cs_cafe_metricool_is_admin(l.actor_id) IS TRUE AND NOT EXISTS(SELECT 1 FROM unnest(l.owner_message_ids) m WHERE m IS NULL OR m!~'^Sentinel_[a-f0-9]{32}$');
 SELECT * INTO b FROM character_production.text_replenishment_budgets WHERE id=l.budget_id;
 SELECT * INTO o FROM character_production.preparation_occurrences WHERE lane_id=l.id;
 IF o.id IS NULL THEN
  IF active IS DISTINCT FROM true OR NOT b.enabled OR b.expires_at<=stamp OR b.period<>to_char(stamp AT TIME ZONE 'America/Chicago','YYYY-MM') THEN RETURN NULL; END IF;
  INSERT INTO character_production.preparation_occurrences(lane_id,text_key) VALUES(l.id,'daily:'||to_char(stamp AT TIME ZONE 'America/Chicago','YYYY-MM-DD')||':zaria-solenne') ON CONFLICT DO NOTHING;
  SELECT * INTO o FROM character_production.preparation_occurrences WHERE lane_id=l.id;
 END IF;
 -- A competing unique text_key may belong to another lane. Never adopt it.
 IF o.id IS NULL OR o.lane_id IS DISTINCT FROM l.id THEN RETURN NULL; END IF;
 SELECT * INTO a FROM character_production.text_replenishment_attempts WHERE key=o.text_key;
 IF a.key IS NOT NULL AND (a.budget_id<>l.budget_id OR a.source_snapshot->>'characterId' IS DISTINCT FROM 'zaria-solenne' OR a.source_snapshot->>'roomKey' IS DISTINCT FROM 'gallery') THEN RETURN NULL; END IF;
 IF o.text_started AND a.created_at>=o.created_at AND a.state='awaiting_audio_binding_and_qa' AND a.provider_id IS NOT NULL AND jsonb_typeof(a.output->'spokenScript')='string' THEN
  identity:=jsonb_build_object('textAttemptKey',a.key,'textAttemptToken',a.token,'textSourceDigest',a.source_digest,'scriptSha256',encode(sha256(convert_to(a.output->>'spokenScript','UTF8')),'hex'));
 END IF;
 RETURN jsonb_build_object('occurrenceId',o.id,'textKey',o.text_key,'textStarted',o.text_started,'speechStarted',o.speech_started,'textState',a.state,'identity',identity,'active',coalesce(active,false),'sourceScope',CASE WHEN active THEN l.source_scope END,'lease',CASE WHEN active THEN jsonb_build_object('id',b.id,'period',b.period,'model',b.model,'maxCostCents',b.max_cost_cents,'monthlyCapCents',b.cap_cents,'expiresAt',floor(extract(epoch FROM b.expires_at)*1000)::bigint,'rateEvidence',b.rate_evidence,'inputMicroUsdPerToken',b.input_micro_usd,'outputMicroUsdPerToken',b.output_micro_usd) END);
END $$;
REVOKE ALL ON FUNCTION public.character_production_preparation_context() FROM PUBLIC;
CREATE FUNCTION public.character_production_preparation_claim(p_occurrence uuid,p_phase text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb; speech jsonb; o character_production.preparation_occurrences;
BEGIN
 IF p_phase IS NULL OR p_phase NOT IN('text','speech') THEN RETURN false; END IF;
 c:=public.character_production_preparation_context();
 IF c IS NULL OR c->'active' IS DISTINCT FROM 'true'::jsonb OR c->>'occurrenceId' IS DISTINCT FROM p_occurrence::text OR c->>'textKey' IS DISTINCT FROM 'daily:'||to_char(clock_timestamp() AT TIME ZONE 'America/Chicago','YYYY-MM-DD')||':zaria-solenne' THEN RETURN false; END IF;
 SELECT * INTO o FROM character_production.preparation_occurrences WHERE id=p_occurrence FOR UPDATE;
 IF p_phase='text' THEN
  IF o.text_started OR c->>'textState' IS NOT NULL OR NOT EXISTS(SELECT 1 FROM character_production.preparation_lanes l JOIN character_production.text_replenishment_budgets b ON b.id=l.budget_id WHERE l.id=o.lane_id AND b.enabled AND b.expires_at>clock_timestamp() AND b.period=to_char(clock_timestamp() AT TIME ZONE 'America/Chicago','YYYY-MM')) THEN RETURN false; END IF;
  UPDATE character_production.preparation_occurrences SET text_started=true WHERE id=o.id;
 ELSE
  IF o.speech_started OR c->'identity' IS NULL OR c->'identity'='null'::jsonb THEN RETURN false; END IF;
  speech:=public.character_production_fresh_speech_source(o.text_key);
  IF speech IS NULL OR speech#>>'{attempt,token}' IS DISTINCT FROM c#>>'{identity,textAttemptToken}' OR speech#>>'{attempt,source_digest}' IS DISTINCT FROM c#>>'{identity,textSourceDigest}' THEN RETURN false; END IF;
  UPDATE character_production.preparation_occurrences SET speech_started=true WHERE id=o.id;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.character_production_preparation_claim(uuid,text) FROM PUBLIC;
DO $$ DECLARE r record; own oid:='character_production_owner'::regrole; BEGIN
 IF current_user<>'character_production_owner' THEN RAISE EXCEPTION 'Restricted owner required'; END IF;
 FOR r IN SELECT relowner owner,relacl acl FROM pg_class WHERE oid IN('character_production.preparation_lanes'::regclass,'character_production.preparation_binding'::regclass,'character_production.preparation_occurrences'::regclass)
 UNION ALL SELECT proowner,proacl FROM pg_proc WHERE oid IN('character_production.preparation_immutable()'::regprocedure,'public.character_production_preparation_context()'::regprocedure,'public.character_production_preparation_claim(uuid,text)'::regprocedure)
 LOOP IF r.owner<>own OR EXISTS(SELECT 1 FROM aclexplode(r.acl) WHERE grantee<>own) THEN RAISE EXCEPTION 'Owner-only preparation required'; END IF; END LOOP;
END $$;
ROLLBACK;
