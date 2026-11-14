-- OFFLINE REVIEW ONLY. Prerequisites: reviewed recurring QA and HeyGen wallet
-- guard already installed. Empty planner, no runtime grants/rows/activation.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Expected direct reviewed PG17 installer'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='character_production_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='character_production_owner'::regrole OR (roleid='character_production_owner'::regrole AND member<>current_user::regrole)) THEN RAISE EXCEPTION 'Unsafe owner baseline'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected temporary authority'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor<>current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option)<>1 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor=current_user::regrole) THEN RAISE EXCEPTION 'Missing exact bootstrap membership'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.cs_character_promo_drafts'::regclass AND relowner=current_user::regrole AND relrowsecurity AND NOT relforcerowsecurity) THEN RAISE EXCEPTION 'Unexpected source owner/RLS'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname IN ('qa_slot_bindings','heygen_wallet_policy','heygen_wallet_evidence','heygen_slot_evidence') AND c.relkind='r' AND c.relowner='character_production_owner'::regrole AND c.relrowsecurity)<>4 OR to_regprocedure('public.character_production_qa_draft_unplanned(uuid)') IS NULL OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='character_production' AND p.proowner='character_production_owner'::regrole AND ((p.proname='calendar_period' AND p.proargtypes='25 1184'::oidvector) OR (p.proname='heygen_spend_allowed' AND p.proargtypes='3802 25 20 25'::oidvector)))<>2 THEN RAISE EXCEPTION 'Reviewed recurring QA and wallet guard prerequisites required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.cs_cafe_metricool_is_admin(uuid)') AND proowner=current_user::regrole AND prorettype='boolean'::regtype AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog']::text[]) OR NOT has_function_privilege('character_production_owner','public.cs_cafe_metricool_is_admin(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Reviewed source-owned boolean admin bridge required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relname IN ('planning_policies','planning_records')) OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'character_production'::regnamespace) AND proname IN ('character_production_plan','character_production_planned_draft','character_production_planning_policy','character_production_new_blank_draft','planning_record_immutable','planning_policy_revoke')) THEN RAISE EXCEPTION 'Planner already exists: reconcile'; END IF;
END $$;
LOCK TABLE public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks IN SHARE MODE;
CREATE TEMP TABLE pi_source ON COMMIT DROP AS SELECT 'drafts' name,to_jsonb(x) row FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x;
CREATE TEMP TABLE pi_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE pi_ns ON COMMIT DROP AS SELECT oid,nspacl,nspowner FROM pg_namespace WHERE nspname IN ('public','character_production');
CREATE TEMP TABLE pi_objects ON COMMIT DROP AS SELECT oid,relacl,relowner,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'character_production'::regnamespace);
CREATE TEMP TABLE pi_cols ON COMMIT DROP AS SELECT attrelid,attnum,attacl FROM pg_attribute WHERE attrelid IN (SELECT oid FROM pi_objects);
CREATE TEMP TABLE pi_functions ON COMMIT DROP AS SELECT oid,proowner,proacl,pg_get_functiondef(oid) def FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'character_production'::regnamespace) AND prokind='f';
CREATE TEMP TABLE pi_policies ON COMMIT DROP AS SELECT oid,to_jsonb(p) data FROM pg_policy p;
CREATE TEMP TABLE pi_triggers ON COMMIT DROP AS SELECT oid,to_jsonb(t) data FROM pg_trigger t;
GRANT character_production_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO character_production_owner;
SET LOCAL ROLE character_production_owner;
CREATE TEMP TABLE pi_rows(name text,row jsonb) ON COMMIT DROP;
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT relname FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relkind='r' LOOP
 EXECUTE format('LOCK TABLE character_production.%I IN SHARE MODE',t.relname);
 EXECUTE format('INSERT INTO pi_rows SELECT %L,to_jsonb(x) FROM character_production.%I x',t.relname,t.relname);
 END LOOP;
END $$;

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
CREATE FUNCTION public.character_production_planning_policy(p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('observedAt',floor(extract(epoch FROM clock_timestamp())*1000)::bigint,
 'policy',jsonb_build_object('id',p.id,'revision',p.revision,'enabled',p.enabled,
 'expiresAt',floor(extract(epoch FROM p.expires_at)*1000)::bigint,
 'ownerEvidenceRef',p.owner_evidence->>'evidenceRef','characters',p.characters,
 'themes',p.themes,'capCents',p.cap_cents,'accountId',p.account_id))
 FROM character_production.planning_policies p
 WHERE p.id=p_id AND p.enabled AND p.expires_at>clock_timestamp()
 AND jsonb_typeof(p.owner_evidence->'evidenceRef')='string'
 AND length(btrim(p.owner_evidence->>'evidenceRef')) BETWEEN 1 AND 500
$$;
REVOKE ALL ON FUNCTION public.character_production_planning_policy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.character_production_planned_draft(uuid,jsonb,text,text) TO postgres;
RESET ROLE;

CREATE FUNCTION public.character_production_new_blank_draft(p_id uuid,p_slot jsonb,p_digest text,p_theme text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stamp timestamptz;
BEGIN
 IF p_id IS NULL OR p_slot IS NULL OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$'
 OR p_slot->>'characterId' IS NULL OR p_slot->>'script' IS NULL OR p_theme IS NULL
 OR length(btrim(p_slot->>'script')) NOT BETWEEN 1 AND 5000
 OR (p_slot->>'durationSeconds')::integer NOT BETWEEN 8 AND 45 THEN RETURN NULL; END IF;
 -- Fixed boolean bridge reads only exact planner intent, not arbitrary source
 -- records. Source owner receives no private schema/table rights.
 IF public.character_production_planned_draft(p_id,p_slot,p_digest,p_theme) IS DISTINCT FROM true THEN RETURN NULL; END IF;
 INSERT INTO public.cs_character_promo_drafts(id,character_id,promo_key,specialty,title,spoken_script,visual_brief,intended_channel,duration_seconds,status,evidence,linked_event_id,actual_social_account,audio_asset_path,video_asset_path,voice_approved_at,video_qa_approved_at,publication_approved_at)
 VALUES(p_id,p_slot->>'characterId','generated-qa-'||p_id::text,'Canonical Café host','Generated Café promotion: private QA candidate',p_slot->>'script','Exact canonical production binding '||(p_slot->>'providerBindingRevision')||'; no new scene or likeness inferred.','private_qa_only',(p_slot->>'durationSeconds')::integer,'draft',jsonb_build_object('source','trusted_recurring_production_planner','slotKey',p_slot->>'key','slotDigest',p_digest,'theme',p_theme,'publicationApproved',false),NULL,NULL,NULL,NULL,NULL,NULL,NULL)
 RETURNING updated_at INTO stamp;
 RETURN stamp;
END $$;
REVOKE ALL ON FUNCTION public.character_production_new_blank_draft(uuid,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.character_production_new_blank_draft(uuid,jsonb,text,text) TO character_production_owner;
SET LOCAL ROLE character_production_owner;
DO $$ DECLARE t record; BEGIN
 IF EXISTS(SELECT 1 FROM character_production.planning_policies) OR EXISTS(SELECT 1 FROM character_production.planning_records) THEN RAISE EXCEPTION 'Planner must install empty'; END IF;
 CREATE TEMP TABLE pi_rows_after(name text,row jsonb) ON COMMIT DROP;
 FOR t IN SELECT relname FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relkind='r' AND relname NOT IN ('planning_policies','planning_records') LOOP
 EXECUTE format('INSERT INTO pi_rows_after SELECT %L,to_jsonb(x) FROM character_production.%I x',t.relname,t.relname);
 END LOOP;
 IF EXISTS((SELECT * FROM pi_rows EXCEPT ALL SELECT * FROM pi_rows_after) UNION ALL (SELECT * FROM pi_rows_after EXCEPT ALL SELECT * FROM pi_rows)) THEN RAISE EXCEPTION 'Ledger data changed'; END IF;
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM character_production_owner;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE f record; t record; own oid:='character_production_owner'::regrole; expected_owner oid; extra oid; BEGIN
 IF EXISTS((SELECT * FROM pg_auth_members EXCEPT SELECT * FROM pi_members) UNION ALL (SELECT * FROM pi_members EXCEPT SELECT * FROM pg_auth_members)) THEN RAISE EXCEPTION 'Membership changed'; END IF;
 IF EXISTS(SELECT 1 FROM pi_ns b LEFT JOIN pg_namespace n USING(oid) WHERE n.oid IS NULL OR n.nspacl IS DISTINCT FROM b.nspacl OR n.nspowner IS DISTINCT FROM b.nspowner) THEN RAISE EXCEPTION 'Schema authority changed'; END IF;
 IF EXISTS(SELECT 1 FROM pi_objects b LEFT JOIN pg_class c USING(oid) WHERE c.oid IS NULL OR c.relowner IS DISTINCT FROM b.relowner OR c.relacl IS DISTINCT FROM b.relacl OR c.relrowsecurity IS DISTINCT FROM b.relrowsecurity OR c.relforcerowsecurity IS DISTINCT FROM b.relforcerowsecurity) OR EXISTS(SELECT 1 FROM pi_cols b LEFT JOIN pg_attribute a USING(attrelid,attnum) WHERE a.attrelid IS NULL OR a.attacl IS DISTINCT FROM b.attacl) THEN RAISE EXCEPTION 'Existing object authority changed'; END IF;
 IF EXISTS(SELECT 1 FROM pi_functions b LEFT JOIN pg_proc p USING(oid) WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM b.proowner OR p.proacl IS DISTINCT FROM b.proacl OR pg_get_functiondef(p.oid) IS DISTINCT FROM b.def) THEN RAISE EXCEPTION 'Existing function changed'; END IF;
 IF EXISTS(SELECT 1 FROM pi_policies b LEFT JOIN pg_policy p USING(oid) WHERE p.oid IS NULL OR to_jsonb(p) IS DISTINCT FROM b.data) OR (SELECT count(*) FROM pg_policy)<>(SELECT count(*) FROM pi_policies) THEN RAISE EXCEPTION 'Policies changed'; END IF;
 IF EXISTS(SELECT 1 FROM pi_triggers b LEFT JOIN pg_trigger t USING(oid) WHERE t.oid IS NULL OR to_jsonb(t) IS DISTINCT FROM b.data) THEN RAISE EXCEPTION 'Existing triggers changed'; END IF;
 IF EXISTS(WITH actual AS (SELECT 'drafts' name,to_jsonb(x) row FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x) (SELECT * FROM actual EXCEPT ALL SELECT * FROM pi_source) UNION ALL (SELECT * FROM pi_source EXCEPT ALL SELECT * FROM actual)) THEN RAISE EXCEPTION 'Source rows changed'; END IF;
 FOR t IN SELECT * FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relname IN ('planning_policies','planning_records') LOOP
 IF t.relkind<>'r' OR t.relowner<>own OR NOT t.relrowsecurity OR t.relforcerowsecurity OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=t.oid AND attacl IS NOT NULL) THEN RAISE EXCEPTION 'Planner table identity mismatch'; END IF;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(t.relacl,acldefault('r',own)))), e AS (SELECT * FROM aclexplode(acldefault('r',own))) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Planner table ACL mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relname IN ('planning_policies','planning_records') AND relkind='r')<>2 THEN RAISE EXCEPTION 'Missing planner tables'; END IF;
 FOR f IN SELECT p.* FROM pg_proc p WHERE NOT EXISTS(SELECT 1 FROM pi_functions b WHERE b.oid=p.oid) AND p.pronamespace IN ('public'::regnamespace,'character_production'::regnamespace) LOOP
 expected_owner:=CASE WHEN f.proname='character_production_new_blank_draft' THEN current_user::regrole::oid ELSE own END;
 extra:=CASE WHEN f.proname='character_production_new_blank_draft' THEN own WHEN f.proname='character_production_planned_draft' THEN current_user::regrole::oid ELSE NULL END;
 IF NOT (CASE f.proname
 WHEN 'planning_record_immutable' THEN f.pronamespace='character_production'::regnamespace AND f.proargtypes=''::oidvector AND f.prorettype='trigger'::regtype AND NOT f.prosecdef
 WHEN 'planning_policy_revoke' THEN f.pronamespace='character_production'::regnamespace AND f.proargtypes=''::oidvector AND f.prorettype='trigger'::regtype AND f.prosecdef
 WHEN 'character_production_planned_draft' THEN f.pronamespace='public'::regnamespace AND f.proargtypes='2950 3802 25 25'::oidvector AND f.prorettype='boolean'::regtype AND f.prosecdef
 WHEN 'character_production_new_blank_draft' THEN f.pronamespace='public'::regnamespace AND f.proargtypes='2950 3802 25 25'::oidvector AND f.prorettype='timestamptz'::regtype AND f.prosecdef
 WHEN 'character_production_plan' THEN f.pronamespace='public'::regnamespace AND f.proargtypes='3802 25 3802 2950 20 2950'::oidvector AND f.prorettype='jsonb'::regtype AND f.prosecdef
 WHEN 'character_production_planning_policy' THEN f.pronamespace='public'::regnamespace AND f.proargtypes='2950'::oidvector AND f.prorettype='jsonb'::regtype AND f.prosecdef
 ELSE false END) OR f.proowner<>expected_owner OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'Planner function identity mismatch'; END IF;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner)))), e AS (SELECT expected_owner grantor,expected_owner grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT expected_owner,extra,'EXECUTE',false WHERE extra IS NOT NULL) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Planner function ACL mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc p WHERE NOT EXISTS(SELECT 1 FROM pi_functions b WHERE b.oid=p.oid) AND p.pronamespace IN ('public'::regnamespace,'character_production'::regnamespace))<>6 THEN RAISE EXCEPTION 'Unexpected planner functions'; END IF;
 IF (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND NOT EXISTS(SELECT 1 FROM pi_triggers b WHERE b.oid=t.oid))<>2 THEN RAISE EXCEPTION 'Unexpected planner triggers'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc f ON f.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND NOT EXISTS(SELECT 1 FROM pi_triggers b WHERE b.oid=t.oid) AND (t.tgtype<>27 OR t.tgenabled<>'O' OR t.tgqual IS NOT NULL OR t.tgnargs<>0 OR f.proowner<>own OR NOT ((t.tgname='planning_record_immutable' AND f.proname='planning_record_immutable' AND c.relname='planning_records') OR (t.tgname='planning_policy_revoke' AND f.proname='planning_policy_revoke' AND c.relname='planning_policies'))))) THEN RAISE EXCEPTION 'Planner trigger mismatch'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Temporary authority remains'; END IF;
END $$;
COMMIT;

