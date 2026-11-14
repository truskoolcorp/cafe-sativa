-- DORMANT OWNER-CONTEXT PROPOSAL. No installer, grants, rows or activation.
-- Requires reviewed recurring QA + HeyGen Dallas budget foundation.
BEGIN;
CREATE TABLE character_production.planning_policies(
 id uuid PRIMARY KEY, revision bigint NOT NULL CHECK(revision>0),
 enabled boolean NOT NULL DEFAULT false, owner_evidence jsonb NOT NULL,
 period text NOT NULL CHECK(period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 expires_at timestamptz NOT NULL, characters text[] NOT NULL CHECK(cardinality(characters) BETWEEN 1 AND 20),
 themes text[] NOT NULL CHECK(cardinality(themes) BETWEEN 1 AND 20),
 max_slots integer NOT NULL CHECK(max_slots BETWEEN 1 AND 31),
 max_duration integer NOT NULL CHECK(max_duration BETWEEN 8 AND 45),
 cap_cents bigint NOT NULL CHECK(cap_cents BETWEEN 1 AND 2000),
 account_id text NOT NULL CHECK(account_id='d61468fdf18c4b478f27857337ddd1ea'),
 CHECK(jsonb_typeof(owner_evidence)='object' AND octet_length(owner_evidence::text)<=16384),
 CHECK(expires_at<=((period||'-01')::date+interval '1 month') AT TIME ZONE 'America/Chicago')
);
CREATE TABLE character_production.planning_records(
 slot_key text PRIMARY KEY REFERENCES character_production.approved_slots(key),
 policy_id uuid NOT NULL REFERENCES character_production.planning_policies(id),
 policy_revision bigint NOT NULL, digest text NOT NULL, slot jsonb NOT NULL,
 plan jsonb NOT NULL, promo_id uuid NOT NULL UNIQUE,
 scheduled_at timestamptz NOT NULL, dallas_day date NOT NULL,
 quote_cents bigint NOT NULL CHECK(quote_cents>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(dallas_day)
);
ALTER TABLE character_production.planning_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.planning_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.planning_policies,character_production.planning_records FROM PUBLIC;
-- Evidence/count history is never deleted or updated by the runtime.
CREATE FUNCTION character_production.planning_record_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Planning provenance immutable'; END $$;
CREATE TRIGGER planning_record_immutable BEFORE UPDATE OR DELETE ON character_production.planning_records FOR EACH ROW EXECUTE FUNCTION character_production.planning_record_immutable();
-- Policy changes cannot silently revive previously planned paid work. Any edit
-- revokes all earlier slots/schedules/QA bindings; new policy revision needs newkeys.
CREATE FUNCTION character_production.planning_policy_revoke() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain policy history; disable instead'; END IF;
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.revision<=OLD.revision THEN RAISE EXCEPTION 'New policy revision required'; END IF;
 UPDATE character_production.approved_slots a SET enabled=false WHERE a.key IN(SELECT slot_key FROM character_production.planning_records WHERE policy_id=OLD.id);
 UPDATE character_production.schedules s SET enabled=false WHERE s.key IN(SELECT slot_key FROM character_production.planning_records WHERE policy_id=OLD.id);
 UPDATE character_production.qa_slot_bindings b SET enabled=false WHERE b.slot_key IN(SELECT slot_key FROM character_production.planning_records WHERE policy_id=OLD.id);
 RETURN NEW;
END $$;
CREATE TRIGGER planning_policy_revoke BEFORE UPDATE OR DELETE ON character_production.planning_policies FOR EACH ROW EXECUTE FUNCTION character_production.planning_policy_revoke();
-- Only existing source owner gets EXECUTE on this exact boolean bridge.
CREATE FUNCTION public.character_production_planned_draft(p_id uuid,p_slot jsonb,p_digest text,p_theme text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM character_production.planning_records r
 JOIN character_production.planning_policies p ON p.id=r.policy_id AND p.revision=r.policy_revision AND p.enabled
 JOIN character_production.approved_slots a ON a.key=r.slot_key AND a.enabled AND a.slot=r.slot AND a.digest=r.digest
 WHERE r.promo_id=p_id AND r.slot=p_slot AND r.digest=p_digest AND r.plan->>'theme'=p_theme
 AND p.expires_at>clock_timestamp())
$$;
REVOKE ALL ON FUNCTION public.character_production_planned_draft(uuid,jsonb,text,text) FROM PUBLIC;
CREATE FUNCTION public.character_production_plan(p_slot jsonb,p_digest text,p_plan jsonb,p_policy_id uuid,p_policy_revision bigint,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pol character_production.planning_policies; prior character_production.planning_records;
 budget character_production.budgets; observed timestamptz; scheduled timestamptz; expiry timestamptz;
 draft uuid; stamp timestamptz; computed text; validation jsonb; n bigint; total numeric;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR p_slot IS NULL OR p_plan IS NULL
 OR jsonb_typeof(p_slot)<>'object' OR jsonb_typeof(p_plan)<>'object'
 OR octet_length(p_slot::text)>20000 OR octet_length(p_plan::text)>40000
 OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_slot) k) IS DISTINCT FROM ARRAY['authorizationExpiresAt','authorizationId','canonicalRevision','characterId','durationSeconds','key','model','period','periodCapCents','portraitSha256','provider','providerBindingRevision','quoteCents','script','voiceId']::text[]
 OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_plan) k) IS DISTINCT FROM ARRAY['draftId','scheduledAt','theme','validation','version']::text[]
 OR p_plan->>'version' IS DISTINCT FROM '1' THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_slot) e WHERE e.value='null'::jsonb)
 OR EXISTS(SELECT 1 FROM jsonb_each(p_plan) e WHERE e.value='null'::jsonb)
 OR p_slot->>'authorizationId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$'
 OR p_slot->>'provider' IS DISTINCT FROM 'heygen' OR p_slot->>'model' IS DISTINCT FROM 'avatar_iv'
 OR p_slot->>'key' !~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$'
 OR p_slot->>'characterId' !~ '^[a-z0-9][a-z0-9-]{0,99}$'
 OR p_slot->>'characterId' IN ('keith','keith-ingram')
 OR p_slot->>'voiceId' !~ '^[A-Za-z0-9_-]{1,100}$'
 OR length(btrim(p_slot->>'script')) NOT BETWEEN 1 AND 5000
 OR p_slot->>'script' ~* 'building[[:space:]]+caf[eé][[:space:]]+sativa'
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['canonicalRevision','portraitSha256','providerBindingRevision']) k WHERE p_slot->>k !~ '^[a-f0-9]{64}$')
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['durationSeconds','authorizationExpiresAt','quoteCents','periodCapCents']) k WHERE jsonb_typeof(p_slot->k)<>'number' OR p_slot->>k !~ '^[0-9]{1,16}$')
 THEN RETURN NULL; END IF;
 -- Match existing engine JSON.stringify(array) using compact scalar JSON, not
 -- spaced jsonb array output. No ad-hoc whitespace stripping inside strings.
 SELECT encode(sha256(convert_to('['||string_agg(v::text,',' ORDER BY ord)||']','UTF8')),'hex') INTO computed
 FROM jsonb_array_elements(jsonb_build_array(p_slot->'key',p_slot->'characterId',p_slot->'script',p_slot->'canonicalRevision',p_slot->'voiceId',p_slot->'portraitSha256',p_slot->'provider',p_slot->'model',p_slot->'durationSeconds',p_slot->'authorizationId',p_slot->'authorizationExpiresAt',p_slot->'period',p_slot->'quoteCents',p_slot->'periodCapCents',p_slot->'providerBindingRevision')) WITH ORDINALITY x(v,ord);
 IF computed IS DISTINCT FROM p_digest THEN RETURN NULL; END IF;
 SELECT * INTO pol FROM character_production.planning_policies WHERE id=p_policy_id FOR UPDATE;
 IF NOT FOUND OR NOT pol.enabled OR pol.expires_at<=clock_timestamp() OR pol.revision IS DISTINCT FROM p_policy_revision THEN RETURN NULL; END IF;
 -- Helper supplied by reviewed source-owner installer; boolean only, no auth data.
 IF public.cs_cafe_metricool_is_admin(p_actor) IS DISTINCT FROM true THEN RETURN NULL; END IF;
 SELECT * INTO prior FROM character_production.planning_records WHERE slot_key=p_slot->>'key';
 IF FOUND THEN
  IF prior.policy_id=p_policy_id AND prior.policy_revision=p_policy_revision AND prior.digest=p_digest AND prior.slot=p_slot AND prior.plan=p_plan
  AND EXISTS(SELECT 1 FROM character_production.approved_slots a WHERE a.key=prior.slot_key AND a.enabled AND a.slot=p_slot AND a.digest=p_digest)
  THEN RETURN jsonb_build_object('key',prior.slot_key,'digest',prior.digest,'draftId',prior.promo_id,'replayed',true); END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO budget FROM character_production.budgets WHERE provider='heygen' AND period=pol.period FOR UPDATE;
 observed:=clock_timestamp();
 IF NOT FOUND OR NOT budget.enabled OR budget.cap_cents<>pol.cap_cents OR pol.expires_at<=observed
 OR pol.period<>character_production.calendar_period('heygen',observed)
 OR p_slot->>'period' IS DISTINCT FROM pol.period OR (p_slot->>'periodCapCents')::bigint<>pol.cap_cents
 OR NOT(p_slot->>'characterId'=ANY(pol.characters)) OR NOT(p_plan->>'theme'=ANY(pol.themes))
 OR (p_slot->>'durationSeconds')::integer NOT BETWEEN 8 AND pol.max_duration
 OR (p_slot->>'quoteCents')::bigint NOT BETWEEN 1 AND pol.cap_cents THEN RETURN NULL; END IF;
 scheduled:=(p_plan->>'scheduledAt')::timestamptz; expiry:=to_timestamp((p_slot->>'authorizationExpiresAt')::numeric/1000);draft:=(p_plan->>'draftId')::uuid;
 IF scheduled IS NULL OR draft IS NULL OR scheduled<observed OR scheduled>=expiry OR expiry>pol.expires_at
 OR character_production.calendar_period('heygen',scheduled)<>pol.period THEN RETURN NULL; END IF;
 validation:=p_plan->'validation';
 IF validation IS NULL OR jsonb_typeof(validation)<>'object' OR validation->>'brand' IS DISTINCT FROM 'cafe-sativa'
 OR validation->>'accountId' IS DISTINCT FROM pol.account_id OR validation->>'slotDigest' IS DISTINCT FROM p_digest
 OR validation->>'canonicalRevision' IS DISTINCT FROM p_slot->>'canonicalRevision'
 OR validation->>'providerBindingRevision' IS DISTINCT FROM p_slot->>'providerBindingRevision'
 OR validation->>'theme' IS DISTINCT FROM p_plan->>'theme' OR validation->'rightsApproved' IS DISTINCT FROM 'true'::jsonb
 OR validation->'sourceBound' IS DISTINCT FROM 'true'::jsonb OR validation->>'evidenceRef' IS NULL
 OR length(validation->>'evidenceRef') NOT BETWEEN 1 AND 500
 OR (validation->>'observedAt')::timestamptz>observed OR (validation->>'observedAt')::timestamptz<observed-interval '60 seconds'
 OR validation->>'observedAt' IS NULL THEN RETURN NULL; END IF;
 SELECT count(*),coalesce(sum(quote_cents),0) INTO n,total FROM character_production.planning_records WHERE policy_id=pol.id;
 IF n>=pol.max_slots OR total+(p_slot->>'quoteCents')::bigint>pol.cap_cents
 OR EXISTS(SELECT 1 FROM character_production.planning_records WHERE dallas_day=(scheduled AT TIME ZONE 'America/Chicago')::date)
 OR EXISTS(SELECT 1 FROM character_production.approved_slots WHERE key=p_slot->>'key') THEN RETURN NULL; END IF;
 INSERT INTO character_production.approved_slots(key,slot,digest,enabled) VALUES(p_slot->>'key',p_slot,p_digest,true);
 INSERT INTO character_production.schedules(key,digest,scheduled_at,not_after,enabled) VALUES(p_slot->>'key',p_digest,scheduled,expiry,true);
 INSERT INTO character_production.planning_records(slot_key,policy_id,policy_revision,digest,slot,plan,promo_id,scheduled_at,dallas_day,quote_cents)
 VALUES(p_slot->>'key',pol.id,pol.revision,p_digest,p_slot,p_plan,draft,scheduled,(scheduled AT TIME ZONE 'America/Chicago')::date,(p_slot->>'quoteCents')::bigint);
 stamp:=public.character_production_new_blank_draft(draft,p_slot,p_digest,p_plan->>'theme');
 IF stamp IS NULL THEN RAISE EXCEPTION 'Blank draft unconfirmed'; END IF;
 INSERT INTO character_production.qa_slot_bindings(slot_key,digest,slot,promo_id,expected_updated_at,enabled) VALUES(p_slot->>'key',p_digest,p_slot,draft,stamp,true);
 RETURN jsonb_build_object('key',p_slot->>'key','digest',p_digest,'draftId',draft,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.character_production_plan(jsonb,text,jsonb,uuid,bigint,uuid),character_production.planning_record_immutable(),character_production.planning_policy_revoke() FROM PUBLIC;
COMMIT;
