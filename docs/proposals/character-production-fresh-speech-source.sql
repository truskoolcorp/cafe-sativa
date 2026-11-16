-- OFFLINE ONLY. No runtime grants, authority rows, provider call or activation.
BEGIN;
CREATE TABLE character_production.included_speech_scopes(
 id uuid PRIMARY KEY,actor_id uuid NOT NULL,reference text NOT NULL CHECK(reference~'^[A-Za-z0-9_.:-]{1,200}$'),
 owner_message_ids text[] NOT NULL CHECK(cardinality(owner_message_ids) BETWEEN 1 AND 20),
 authorized_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 CHECK(expires_at>authorized_at AND expires_at<=authorized_at+interval '31 days')
);
CREATE TABLE character_production.included_speech_binding(
 name text PRIMARY KEY CHECK(name='zaria-gallery-fresh-speech'),
 scope_id uuid NOT NULL REFERENCES character_production.included_speech_scopes(id),enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE character_production.included_speech_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.included_speech_binding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.included_speech_scopes,character_production.included_speech_binding FROM PUBLIC;
CREATE FUNCTION character_production.included_speech_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.enabled AND NOT NEW.enabled AND to_jsonb(OLD)-'enabled'=to_jsonb(NEW)-'enabled' THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Speech scope immutable: revoke or enroll successor';
END $$;
CREATE TRIGGER included_speech_scope_immutable BEFORE UPDATE OR DELETE ON character_production.included_speech_scopes FOR EACH ROW EXECUTE FUNCTION character_production.included_speech_immutable();
CREATE FUNCTION character_production.included_speech_binding_revoke() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 UPDATE character_production.included_speech_scopes SET enabled=false WHERE id=OLD.scope_id AND enabled;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER included_speech_binding_revoke BEFORE UPDATE OR DELETE ON character_production.included_speech_binding FOR EACH ROW EXECUTE FUNCTION character_production.included_speech_binding_revoke();
REVOKE ALL ON FUNCTION character_production.included_speech_immutable(),character_production.included_speech_binding_revoke() FROM PUBLIC;
CREATE FUNCTION public.character_production_fresh_speech_source(p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b character_production.included_speech_binding;s character_production.included_speech_scopes;a character_production.text_replenishment_attempts;stamp timestamptz:=clock_timestamp();
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RETURN NULL; END IF;
 IF p_key IS DISTINCT FROM 'daily:'||to_char(stamp AT TIME ZONE 'America/Chicago','YYYY-MM-DD')||':zaria-solenne' THEN RETURN NULL; END IF;
 SELECT * INTO b FROM character_production.included_speech_binding WHERE name='zaria-gallery-fresh-speech' AND enabled FOR SHARE NOWAIT;
 SELECT * INTO s FROM character_production.included_speech_scopes WHERE id=b.scope_id AND enabled FOR SHARE NOWAIT;
 IF s.id IS NULL OR s.authorized_at>stamp OR s.expires_at<=stamp OR public.cs_cafe_metricool_is_admin(s.actor_id) IS DISTINCT FROM true OR EXISTS(SELECT 1 FROM unnest(s.owner_message_ids) m WHERE m IS NULL OR m!~'^Sentinel_[a-f0-9]{32}$') THEN RETURN NULL; END IF;
 SELECT * INTO a FROM character_production.text_replenishment_attempts WHERE key=p_key AND state='awaiting_audio_binding_and_qa';
 IF a.key IS NULL OR a.provider_id IS NULL OR a.output IS NULL OR a.source_snapshot->>'characterId' IS DISTINCT FROM 'zaria-solenne' OR a.source_snapshot->>'roomKey' IS DISTINCT FROM 'gallery' OR a.source_snapshot->>'voiceId' IS DISTINCT FROM '5zneNR4v1Uw5AjIZ9Un4' THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('scopeId',s.id,'attempt',jsonb_build_object('key',a.key,'token',a.token,'state',a.state,'source_digest',a.source_digest,'source_snapshot',a.source_snapshot,'output',a.output,'provider_id',a.provider_id,'input_tokens',a.input_tokens,'output_tokens',a.output_tokens),
 'authority',jsonb_build_object('reference',s.reference,'scope','zaria-gallery-organic-fresh-speech','authorizedAt',floor(extract(epoch FROM s.authorized_at)*1000)::bigint,'expiresAt',floor(extract(epoch FROM s.expires_at)*1000)::bigint,'revoked',false));
END $$;
REVOKE ALL ON FUNCTION public.character_production_fresh_speech_source(text) FROM PUBLIC;
DO $$ DECLARE r record;own oid:='character_production_owner'::regrole; BEGIN
 IF current_user<>'character_production_owner' THEN RAISE EXCEPTION 'Restricted owner required'; END IF;
 FOR r IN SELECT relowner owner,relacl acl FROM pg_class WHERE oid IN('character_production.included_speech_scopes'::regclass,'character_production.included_speech_binding'::regclass)
 UNION ALL SELECT proowner,proacl FROM pg_proc WHERE oid IN('character_production.included_speech_immutable()'::regprocedure,'character_production.included_speech_binding_revoke()'::regprocedure,'public.character_production_fresh_speech_source(text)'::regprocedure)
 LOOP IF r.owner<>own OR EXISTS(SELECT 1 FROM aclexplode(r.acl) WHERE grantee<>own) THEN RAISE EXCEPTION 'Owner-only source required'; END IF; END LOOP;
END $$;
ROLLBACK;
