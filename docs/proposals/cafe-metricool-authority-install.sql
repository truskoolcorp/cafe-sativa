-- REVIEW ONLY. No runtime grants, approvals or provider operations.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Exact direct PG17 installer required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cafe_metricool_owner' AND NOT (rolcanlogin OR rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'Expected inert store owner'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='cafe_metricool_owner'::regrole OR member='cafe_metricool_owner'::regrole)<>1 OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='cafe_metricool_owner'::regrole AND member=current_user::regrole AND grantor=to_regrole('supabase_admin') AND admin_option AND NOT inherit_option AND NOT set_option) THEN RAISE EXCEPTION 'Unexpected store owner membership'; END IF;
 IF EXISTS(SELECT 1 FROM pg_default_acl WHERE defaclrole='cafe_metricool_owner'::regrole) THEN RAISE EXCEPTION 'Unexpected owner defaults'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='cafe_metricool_private' AND nspowner='cafe_metricool_owner'::regrole) THEN RAISE EXCEPTION 'Expected installed store'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE proname IN ('canonical_json','cs_record_cafe_metricool_authority') AND pronamespace IN ('public'::regnamespace,'cafe_metricool_private'::regnamespace)) OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='cafe_metricool_private'::regnamespace AND relname='owner_authority_provenance') THEN RAISE EXCEPTION 'Writer already exists: reconcile'; END IF;
 IF pg_has_role(current_user,'cafe_metricool_owner','SET') OR has_schema_privilege('cafe_metricool_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected preexisting install authority'; END IF;
END $$;
CREATE TEMP TABLE cw_expected(nsp text,name text,definition text,owner_name text) ON COMMIT DROP;
INSERT INTO cw_expected VALUES ('cafe_metricool_private','authorized','CREATE OR REPLACE FUNCTION cafe_metricool_private.authorized(p uuid, p_digest text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''pg_catalog''
AS $function$
DECLARE a cafe_metricool_private.approvals; s jsonb; d public.cs_character_promo_drafts; x public.cs_character_promo_delivery_plans;
BEGIN
 SELECT * INTO a FROM cafe_metricool_private.approvals WHERE plan_id=p;
 SELECT * INTO x FROM public.cs_character_promo_delivery_plans WHERE id=p;
 SELECT * INTO d FROM public.cs_character_promo_drafts WHERE id=x.promo_id;
 s:=a.snapshot;
 IF NOT coalesce(NOT a.revoked AND a.digest=p_digest AND a.approved_at<=clock_timestamp() AND a.expires_at>clock_timestamp()
 AND public.cs_cafe_metricool_is_admin(a.approved_by)
 AND a.source_state=cafe_metricool_private.source_state(p)
 AND s->>''planId''=p::text AND s->>''promoId''=d.id::text AND s->>''characterId''=d.character_id AND x.character_id=d.character_id
 AND NOT EXISTS(SELECT 1 FROM cafe_metricool_private.external_receipts e WHERE e.brand_id=s->>''brandId'' AND e.network=s->>''network'' AND e.account_id=s->>''accountId'' AND (e.video_sha256=s->>''videoSha256'' OR e.scheduled_at=(s->>''scheduledAt'')::timestamptz))
 AND s->>''brandId''=''7605217'' AND s->>''userId''=''4174093'' AND s->>''timezone''=''America/Chicago''
 AND s->>''network''=x.network AND s->>''accountId''=x.account_id
 AND ((x.network=''facebook'' AND x.account_id=''105363501666032'') OR (x.network=''instagram'' AND x.account_id=''cafesativainc''))
 AND d.actual_social_account=''metricool-brand:7605217'' AND d.status=''script_approved'' AND x.status=''ready_for_delivery''
 AND s->>''videoPath''=d.video_asset_path AND s->>''videoSha256'' ~ ''^[a-f0-9]{64}$''
 AND d.video_asset_path=''character-promos/''||d.character_id||''/''||d.id::text||''/''||(s->>''videoSha256'')||''.mp4''
 AND s->>''videoSha256'' NOT IN (''a20bd6a7f813370991031840a105a6b3bbac66d28dddbe13dd6dedf920a4903d'',''ed8153e2ddd80b3099823eec24c22327cccad3eabdc4c0a039d4425b5f3a52e7'',''70f2ad3fe14420e472908850576b3240bbad2a3e6d121ae2f89a7da77148f4e0'')
 AND s->>''contentApprovalDigest'' ~ ''^[a-f0-9]{64}$'' AND s->>''caption''=x.caption
 AND (s->>''scheduledAt'')::timestamptz=x.scheduled_at AND x.scheduled_at>clock_timestamp()+interval ''60 seconds''
 AND d.voice_approved_at IS NOT NULL AND d.video_qa_approved_at IS NOT NULL AND d.publication_approved_at IS NOT NULL
 AND greatest(d.voice_approved_at,d.video_qa_approved_at,d.publication_approved_at)<=a.approved_at,false) THEN RETURN false; END IF;
 -- Exactly one passing, attributed evidence row for each current-video check.
 RETURN NOT EXISTS(SELECT 1 FROM unnest(ARRAY[''mp4_integrity'',''canonical_likeness'',''canonical_speech'',''lip_sync'',''visual_text'',''rights'',''duration'',''brand_safety'',''third_party_watermark'']) expected(name)
 WHERE (SELECT count(*) FROM public.cs_character_promo_qa_checks q WHERE q.promo_id=d.id AND q.video_sha256=s->>''videoSha256'' AND q.check_name=expected.name)<>1
 OR NOT EXISTS(SELECT 1 FROM public.cs_character_promo_qa_checks q WHERE q.promo_id=d.id AND q.video_sha256=s->>''videoSha256'' AND q.check_name=expected.name AND q.result=''pass'' AND q.reviewer_id IS NOT NULL AND length(btrim(q.evidence))>0 AND q.created_at<=a.approved_at));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
','cafe_metricool_owner'),('cafe_metricool_private','guard_source','CREATE OR REPLACE FUNCTION cafe_metricool_private.guard_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''pg_catalog''
AS $function$
DECLARE promo uuid;
BEGIN
 IF current_setting(''transaction_isolation'')<>''read committed'' THEN RAISE EXCEPTION ''READ COMMITTED required''; END IF;
 IF TG_TABLE_NAME=''cs_character_promo_drafts'' THEN promo:=OLD.id;
 ELSE
  IF TG_OP=''UPDATE'' AND NEW.promo_id IS DISTINCT FROM OLD.promo_id THEN RAISE EXCEPTION ''Promo ownership immutable''; END IF;
  IF TG_OP=''DELETE'' THEN promo:=OLD.promo_id; ELSE promo:=NEW.promo_id; END IF;
 END IF;
 PERFORM 1 FROM public.cs_character_promo_drafts WHERE id=promo FOR UPDATE;
 IF EXISTS(SELECT 1 FROM cafe_metricool_private.attempts a JOIN public.cs_character_promo_delivery_plans p ON p.id=a.plan_id WHERE p.promo_id=promo) THEN RAISE EXCEPTION ''Café claimed source frozen; reconcile manually''; END IF;
 IF TG_OP=''DELETE'' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $function$
','cafe_metricool_owner'),('cafe_metricool_private','source_state','CREATE OR REPLACE FUNCTION cafe_metricool_private.source_state(p uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''pg_catalog''
AS $function$
 SELECT jsonb_build_object(''draft'',to_jsonb(d),''plan'',to_jsonb(x),''qa'',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.cs_character_promo_qa_checks q WHERE q.promo_id=d.id),''[]''::jsonb))
 FROM public.cs_character_promo_delivery_plans x JOIN public.cs_character_promo_drafts d ON d.id=x.promo_id WHERE x.id=p
$function$
','cafe_metricool_owner'),('public','cs_cafe_metricool_is_admin','CREATE OR REPLACE FUNCTION public.cs_cafe_metricool_is_admin(p_actor uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''pg_catalog''
AS $function$
 SELECT EXISTS(SELECT 1 FROM auth.users u
 WHERE u.id=p_actor AND u.raw_app_meta_data->''cafe_sativa_admin''=''true''::jsonb)
$function$
','postgres'),('public','cs_claim_cafe_metricool','CREATE OR REPLACE FUNCTION public.cs_claim_cafe_metricool(p_plan uuid, p_digest text, p_destination text, p_media text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''pg_catalog''
AS $function$
DECLARE t uuid; promo uuid;
BEGIN
 IF current_setting(''transaction_isolation'')<>''read committed'' THEN RETURN NULL; END IF;
 SELECT promo_id INTO promo FROM public.cs_character_promo_delivery_plans WHERE id=p_plan;
 PERFORM 1 FROM public.cs_character_promo_drafts WHERE id=promo FOR UPDATE;
 PERFORM 1 FROM cafe_metricool_private.approvals WHERE plan_id=p_plan FOR UPDATE;
 IF NOT cafe_metricool_private.authorized(p_plan,p_digest) OR NOT EXISTS(SELECT 1 FROM cafe_metricool_private.approvals WHERE plan_id=p_plan AND destination_time_key=p_destination AND media_destination_key=p_media) THEN RETURN NULL; END IF;
 INSERT INTO cafe_metricool_private.attempts(plan_id,digest,destination_time_key,media_destination_key) VALUES(p_plan,p_digest,p_destination,p_media) ON CONFLICT DO NOTHING RETURNING token INTO t;
 RETURN t;
END $function$
','cafe_metricool_owner'),('public','cs_finish_cafe_metricool','CREATE OR REPLACE FUNCTION public.cs_finish_cafe_metricool(p_plan uuid, p_token uuid, p_state text, p_receipt jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''pg_catalog''
AS $function$
DECLARE a cafe_metricool_private.attempts; s jsonb; expected jsonb;
BEGIN
 SELECT * INTO a FROM cafe_metricool_private.attempts WHERE plan_id=p_plan AND token=p_token FOR UPDATE;
 IF a.plan_id IS NULL THEN RETURN false; END IF;
 IF p_state=''submission_unknown'' AND p_receipt IS NULL THEN
  IF a.state=''scheduled'' THEN RETURN false; END IF;
  UPDATE cafe_metricool_private.attempts SET state=''submission_unknown'' WHERE plan_id=p_plan; RETURN true;
 END IF;
 IF p_state IS DISTINCT FROM ''scheduled'' OR p_receipt IS NULL OR a.provider_id IS NULL THEN RETURN false; END IF;
 SELECT snapshot INTO s FROM cafe_metricool_private.approvals WHERE plan_id=p_plan;
 expected:=jsonb_build_object(''providerId'',a.provider_id,''providerUuid'',a.provider_uuid,''digest'',a.digest,''brandId'',s->>''brandId'',''network'',s->>''network'',''accountId'',s->>''accountId'',''scheduledAt'',s->>''scheduledAt'',''state'',''scheduled'',''publicationConfirmed'',false,''collaborators'',coalesce((SELECT jsonb_agg(jsonb_build_object(''handle'',c->>''handle'',''state'',''invitation_requested'',''acceptanceConfirmed'',false) ORDER BY n) FROM jsonb_array_elements(s->''collaborators'') WITH ORDINALITY z(c,n)),''[]''::jsonb));
 IF p_receipt IS DISTINCT FROM expected THEN RETURN false; END IF;
 IF a.state=''scheduled'' THEN RETURN a.receipt=p_receipt; END IF;
 -- Unknown outcomes are not automatically upgraded/retried; separate recovery review required.
 IF a.state<>''submitting'' THEN RETURN false; END IF;
 UPDATE cafe_metricool_private.attempts SET state=''scheduled'',receipt=p_receipt WHERE plan_id=p_plan; RETURN true;
END $function$
','cafe_metricool_owner'),('public','cs_identity_cafe_metricool','CREATE OR REPLACE FUNCTION public.cs_identity_cafe_metricool(p_plan uuid, p_token uuid, p_id text, p_uuid text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''pg_catalog''
AS $function$
BEGIN
 IF p_id IS NULL OR p_uuid IS NULL OR length(p_id) NOT BETWEEN 1 AND 256 OR length(p_uuid) NOT BETWEEN 1 AND 256 THEN RETURN false; END IF;
 UPDATE cafe_metricool_private.attempts SET provider_id=p_id,provider_uuid=p_uuid WHERE plan_id=p_plan AND token=p_token AND state IN(''submitting'',''submission_unknown'') AND (provider_id IS NULL OR (provider_id=p_id AND provider_uuid=p_uuid));
 RETURN FOUND;
END $function$
','cafe_metricool_owner'),('public','cs_preflight_cafe_metricool','CREATE OR REPLACE FUNCTION public.cs_preflight_cafe_metricool(p_plan uuid, p_digest text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''pg_catalog''
AS $function$
 SELECT cafe_metricool_private.authorized(p_plan,p_digest)
$function$
','cafe_metricool_owner');

DO $$ DECLARE e record; p record; BEGIN
 FOR e IN SELECT * FROM cw_expected LOOP
  IF (SELECT count(*) FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname=e.nsp AND f.proname=e.name)<>1 THEN RAISE EXCEPTION 'Missing/overloaded dependency %',e.name; END IF;
  SELECT f.* INTO p FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname=e.nsp AND f.proname=e.name;
  IF pg_get_functiondef(p.oid) IS DISTINCT FROM e.definition OR p.proowner<>e.owner_name::regrole THEN RAISE EXCEPTION 'Dependency definition/owner mismatch %',e.name; END IF;
  IF e.name='cs_cafe_metricool_is_admin' THEN
   IF EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))), expected AS (SELECT current_user::regrole::oid grantor,x::regrole::oid grantee,'EXECUTE'::text privilege_type,false is_grantable FROM unnest(ARRAY[current_user::text,'character_production_owner','cafe_metricool_owner']) x) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'Bridge ACL mismatch'; END IF;
  ELSIF EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))), expected AS (SELECT p.proowner grantor,p.proowner grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'Dependency ACL mismatch %',e.name; END IF;
 END LOOP;
END $$;
CREATE TEMP TABLE cw_functions ON COMMIT DROP AS SELECT oid,proowner,proacl,pg_get_functiondef(oid) definition FROM pg_proc WHERE prokind='f' AND pronamespace IN ('public'::regnamespace,'cafe_metricool_private'::regnamespace);
CREATE TEMP TABLE cw_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE cw_roles ON COMMIT DROP AS SELECT oid,to_jsonb(r) data FROM pg_roles r;
CREATE TEMP TABLE cw_defaults ON COMMIT DROP AS SELECT oid,to_jsonb(d) data FROM pg_default_acl d;
CREATE TEMP TABLE cw_classes ON COMMIT DROP AS SELECT oid,to_jsonb(c) data FROM pg_class c WHERE relnamespace IN ('public'::regnamespace,'cafe_metricool_private'::regnamespace);
CREATE TEMP TABLE cw_columns ON COMMIT DROP AS SELECT attrelid,attnum,to_jsonb(a) data FROM pg_attribute a WHERE attrelid IN (SELECT oid FROM cw_classes);
CREATE TEMP TABLE cw_policies ON COMMIT DROP AS SELECT oid,to_jsonb(p) data FROM pg_policy p;
CREATE TEMP TABLE cw_triggers ON COMMIT DROP AS SELECT oid,to_jsonb(t) data FROM pg_trigger t WHERE tgrelid IN (SELECT oid FROM cw_classes);
CREATE TEMP TABLE cw_namespaces ON COMMIT DROP AS SELECT oid,nspowner,nspacl FROM pg_namespace WHERE nspname IN ('public','cafe_metricool_private');
GRANT cafe_metricool_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO cafe_metricool_owner;
SET LOCAL ROLE cafe_metricool_owner;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM cafe_metricool_private.approvals) OR EXISTS(SELECT 1 FROM cafe_metricool_private.attempts) OR (SELECT count(*) FROM cafe_metricool_private.external_receipts)<>22 THEN RAISE EXCEPTION 'Expected unchanged empty authority store'; END IF;
END $$;
CREATE TEMP TABLE cw_receipts ON COMMIT DROP AS SELECT * FROM cafe_metricool_private.external_receipts;

CREATE TABLE cafe_metricool_private.owner_authority_provenance(
 plan_id uuid PRIMARY KEY REFERENCES cafe_metricool_private.approvals(plan_id),
 reference text NOT NULL CHECK(reference ~ '^[A-Za-z0-9_.:-]{1,200}$'),
 schedule_digest text NOT NULL CHECK(schedule_digest ~ '^[a-f0-9]{64}$'),
 authorized_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL, evidence_record text,
 CHECK(evidence_record IS NULL OR octet_length(evidence_record) BETWEEN 2 AND 32768),
 CHECK(authorized_at<=recorded_at AND expires_at>recorded_at)
);
REVOKE ALL ON TABLE cafe_metricool_private.owner_authority_provenance FROM PUBLIC,anon,authenticated,service_role;
-- Protocol schedules contain only objects/arrays/strings, boolean and integer1.
-- Sorted keys + compact representation match cafeScheduleDigest (no whitespace).
CREATE FUNCTION cafe_metricool_private.canonical_json(v jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE t text;
BEGIN
 CASE jsonb_typeof(v)
 WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||cafe_metricool_private.canonical_json(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO t FROM jsonb_each(v);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(cafe_metricool_private.canonical_json(value),',' ORDER BY n),'')||']' INTO t FROM jsonb_array_elements(v) WITH ORDINALITY a(value,n);
 ELSE t:=v::text;
 END CASE;
 RETURN t;
END $$;
CREATE FUNCTION public.cs_record_cafe_metricool_authority(
 p_plan uuid,p_snapshot jsonb,p_digest text,p_destination text,p_media text,
 p_source jsonb,p_actor uuid,p_approved_at timestamptz,p_expires_at timestamptz,p_authority jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE promo uuid; stamp timestamptz; expected_digest text; destination text; media text; auth_at timestamptz; auth_exp timestamptz; evidence text; parsed jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required'; END IF;
 -- This exact helper is supplied by the separate reviewed store installer.
 IF NOT coalesce(public.cs_cafe_metricool_is_admin(p_actor),false) THEN RAISE EXCEPTION 'Content admin required'; END IF;
 SELECT promo_id INTO promo FROM public.cs_character_promo_delivery_plans WHERE id=p_plan;
 IF promo IS NULL THEN RAISE EXCEPTION 'Unknown plan'; END IF;
 PERFORM 1 FROM public.cs_character_promo_drafts WHERE id=promo FOR UPDATE;
 PERFORM 1 FROM cafe_metricool_private.approvals WHERE plan_id=p_plan FOR UPDATE;
 stamp:=clock_timestamp();
 IF NOT coalesce(public.cs_cafe_metricool_is_admin(p_actor),false)
 OR EXISTS(SELECT 1 FROM cafe_metricool_private.approvals WHERE plan_id=p_plan)
 OR EXISTS(SELECT 1 FROM cafe_metricool_private.attempts a JOIN public.cs_character_promo_delivery_plans x ON x.id=a.plan_id WHERE x.promo_id=promo)
 OR p_source IS DISTINCT FROM cafe_metricool_private.source_state(p_plan) THEN RAISE EXCEPTION 'Changed or already recorded source'; END IF;
 IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR octet_length(p_snapshot::text)>32768 OR jsonb_typeof(p_source) IS DISTINCT FROM 'object' OR octet_length(p_source::text)>262144 OR jsonb_typeof(p_authority) IS DISTINCT FROM 'object' OR octet_length(p_authority::text)>40000 THEN RAISE EXCEPTION 'Invalid bounded snapshot'; END IF;
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_snapshot) key) IS DISTINCT FROM
 (CASE WHEN p_snapshot->>'network'='facebook' THEN ARRAY['accountId','brandId','caption','characterId','collaborators','contentApprovalDigest','facebookTitle','hashtags','network','planId','promoId','scheduledAt','timezone','userId','version','videoPath','videoSha256']::text[]
 ELSE ARRAY['accountId','brandId','caption','characterId','collaborators','contentApprovalDigest','hashtags','network','planId','promoId','scheduledAt','timezone','userId','version','videoPath','videoSha256']::text[] END) THEN RAISE EXCEPTION 'Unexpected schedule fields'; END IF;
 IF p_snapshot->'version' IS DISTINCT FROM '1'::jsonb OR p_snapshot->>'planId' IS DISTINCT FROM p_plan::text OR p_snapshot->>'promoId' IS DISTINCT FROM promo::text THEN RAISE EXCEPTION 'Wrong schedule identity'; END IF;
 expected_digest:=encode(sha256(convert_to(cafe_metricool_private.canonical_json(p_snapshot),'UTF8')),'hex');
 destination:=encode(sha256(convert_to(cafe_metricool_private.canonical_json(jsonb_build_array(p_snapshot->>'brandId',p_snapshot->>'network',p_snapshot->>'accountId',p_snapshot->>'scheduledAt')),'UTF8')),'hex');
 media:=encode(sha256(convert_to(cafe_metricool_private.canonical_json(jsonb_build_array(p_snapshot->>'brandId',p_snapshot->>'network',p_snapshot->>'accountId',p_snapshot->>'videoSha256')),'UTF8')),'hex');
 IF p_digest IS DISTINCT FROM expected_digest OR p_destination IS DISTINCT FROM destination OR p_media IS DISTINCT FROM media THEN RAISE EXCEPTION 'Digest or reservation mismatch'; END IF;
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_authority) key) IS DISTINCT FROM (CASE WHEN p_authority ? 'evidenceRecord' THEN ARRAY['authorizedAt','evidenceRecord','expiresAt','reference','revoked','scheduleDigest']::text[] ELSE ARRAY['authorizedAt','expiresAt','reference','revoked','scheduleDigest']::text[] END)
 OR p_authority->'revoked' IS DISTINCT FROM 'false'::jsonb OR p_authority->>'scheduleDigest' IS DISTINCT FROM p_digest OR NOT coalesce(p_authority->>'reference' ~ '^[A-Za-z0-9_.:-]{1,200}$',false) THEN RAISE EXCEPTION 'Separate owner authority required'; END IF;
 evidence:=p_authority->>'evidenceRecord';
 IF p_authority->>'reference' LIKE 'cafe-policy:%' THEN
  IF evidence IS NULL OR octet_length(evidence) NOT BETWEEN 2 AND 32768 THEN RAISE EXCEPTION 'Recoverable policy evidence required'; END IF;
  parsed:=evidence::jsonb;
  IF cafe_metricool_private.canonical_json(parsed) IS DISTINCT FROM evidence
   OR p_authority->>'reference' IS DISTINCT FROM 'cafe-policy:'||encode(sha256(convert_to(evidence,'UTF8')),'hex')
   OR parsed->'assessment'->>'scheduleDigest' IS DISTINCT FROM p_digest
   OR parsed->'assessment'->>'classification' IS DISTINCT FROM 'routine-cafe-persona-brand-promotion'
   OR parsed->'assessment'->'highImpact' IS DISTINCT FROM 'false'::jsonb
   OR parsed->'assessment'->'paidPromotion' IS DISTINCT FROM 'false'::jsonb
   OR parsed->'assessment'->'containsSensitivePersonalData' IS DISTINCT FROM 'false'::jsonb
   OR parsed->'policy'->'revoked' IS DISTINCT FROM 'false'::jsonb
   OR parsed->'policy'->>'scope' IS DISTINCT FROM 'routine-cafe-persona-brand-promotions'
   OR parsed->'policy'->'version' IS DISTINCT FROM '1'::jsonb
   OR parsed->'policy'->'paidPromotion' IS DISTINCT FROM 'false'::jsonb
   OR parsed->'policy'->>'brandId' IS DISTINCT FROM p_snapshot->>'brandId'
   OR parsed->'policy'->>'userId' IS DISTINCT FROM p_snapshot->>'userId'
   OR parsed->'policy'->'accounts' IS DISTINCT FROM '[{"network":"facebook","accountId":"105363501666032"},{"network":"instagram","accountId":"cafesativainc"}]'::jsonb
   OR NOT coalesce((parsed->'policy'->'characterIds') ? (p_snapshot->>'characterId'),false)
   OR NOT coalesce((parsed->'policy'->>'authorizedAt')::timestamptz=(p_authority->>'authorizedAt')::timestamptz AND (parsed->'policy'->>'validUntil')::timestamptz>stamp AND (p_authority->>'expiresAt')::timestamptz<=(parsed->'policy'->>'validUntil')::timestamptz,false)
   OR NOT coalesce((parsed->'assessment'->>'assessedAt')::timestamptz<=stamp AND (parsed->'assessment'->>'assessedAt')::timestamptz>=stamp-interval '60 seconds' AND parsed->'assessment'->>'evidenceRef' ~ '^[A-Za-z0-9_.:-]{1,200}$',false)
   OR NOT coalesce(parsed->'policy'->>'reference' ~ '^[A-Za-z0-9_.:-]{1,200}$',false)
   OR jsonb_typeof(parsed->'policy'->'ownerMessageIds') IS DISTINCT FROM 'array'
   OR jsonb_array_length(parsed->'policy'->'ownerMessageIds') NOT BETWEEN 1 AND 20
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(parsed->'policy'->'ownerMessageIds') m WHERE m !~ '^Sentinel_[a-f0-9]{32}$')
   THEN RAISE EXCEPTION 'Policy evidence mismatch'; END IF;
 ELSE
  IF evidence IS NOT NULL THEN RAISE EXCEPTION 'Unbound evidence record'; END IF;
 END IF;
 auth_at:=(p_authority->>'authorizedAt')::timestamptz;auth_exp:=(p_authority->>'expiresAt')::timestamptz;
 IF NOT coalesce(p_approved_at<=stamp AND p_approved_at>=stamp-interval '60 seconds' AND p_expires_at>stamp AND p_expires_at<=p_approved_at+interval '24 hours' AND p_expires_at<=auth_exp AND p_expires_at<=(p_snapshot->>'scheduledAt')::timestamptz-interval '60 seconds' AND auth_at<=p_approved_at AND auth_exp>stamp,false) THEN RAISE EXCEPTION 'Authority interval invalid'; END IF;
 INSERT INTO cafe_metricool_private.approvals VALUES(p_plan,p_snapshot,p_digest,p_destination,p_media,p_source,p_actor,p_approved_at,p_expires_at,false);
 IF NOT cafe_metricool_private.authorized(p_plan,p_digest) THEN RAISE EXCEPTION 'Current final QA rejected'; END IF;
 INSERT INTO cafe_metricool_private.owner_authority_provenance VALUES(p_plan,p_authority->>'reference',p_digest,auth_at,auth_exp,p_actor,stamp,evidence);
 RETURN jsonb_build_object('digest',p_digest,'expiresAt',to_char(p_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END $$;
REVOKE ALL ON FUNCTION cafe_metricool_private.canonical_json(jsonb),public.cs_record_cafe_metricool_authority(uuid,jsonb,text,text,text,jsonb,uuid,timestamptz,timestamptz,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE x record; own oid:='cafe_metricool_owner'::regrole; BEGIN
 IF EXISTS(SELECT 1 FROM cafe_metricool_private.owner_authority_provenance) OR EXISTS(SELECT 1 FROM cafe_metricool_private.approvals) OR EXISTS(SELECT 1 FROM cafe_metricool_private.attempts) OR EXISTS((SELECT * FROM cw_receipts EXCEPT SELECT * FROM cafe_metricool_private.external_receipts) UNION ALL (SELECT * FROM cafe_metricool_private.external_receipts EXCEPT SELECT * FROM cw_receipts)) THEN RAISE EXCEPTION 'Store data changed'; END IF;
 SELECT * INTO x FROM pg_class WHERE oid='cafe_metricool_private.owner_authority_provenance'::regclass;
 IF x.relowner<>own OR x.relrowsecurity OR x.relforcerowsecurity OR EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(x.relacl,acldefault('r',own)))), expected AS (SELECT * FROM aclexplode(acldefault('r',own))) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'New table ACL mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=x.oid AND attacl IS NOT NULL) OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=x.oid) THEN RAISE EXCEPTION 'Unexpected new table policy/column ACL'; END IF;
 FOR x IN SELECT * FROM pg_proc WHERE oid IN ('cafe_metricool_private.canonical_json(jsonb)'::regprocedure,'public.cs_record_cafe_metricool_authority(uuid,jsonb,text,text,text,jsonb,uuid,timestamptz,timestamptz,jsonb)'::regprocedure) LOOP
  IF x.proowner<>own OR EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(x.proacl,acldefault('f',own)))), expected AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'New function ACL mismatch'; END IF;
 END LOOP;
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM cafe_metricool_owner;
REVOKE cafe_metricool_owner FROM postgres GRANTED BY postgres;
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE prokind='f' AND pronamespace IN ('public'::regnamespace,'cafe_metricool_private'::regnamespace))<>(SELECT count(*)+2 FROM cw_functions) THEN RAISE EXCEPTION 'Unexpected added function'; END IF;
 IF EXISTS(SELECT 1 FROM cw_functions b LEFT JOIN pg_proc p USING(oid) WHERE (b.proowner,b.proacl,b.definition) IS DISTINCT FROM (p.proowner,p.proacl,pg_get_functiondef(p.oid))) THEN RAISE EXCEPTION 'Existing functions changed'; END IF;
 IF EXISTS((SELECT * FROM cw_members EXCEPT SELECT * FROM pg_auth_members) UNION ALL (SELECT * FROM pg_auth_members EXCEPT SELECT * FROM cw_members)) THEN RAISE EXCEPTION 'Membership restoration mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM cw_roles b LEFT JOIN pg_roles r USING(oid) WHERE b.data IS DISTINCT FROM to_jsonb(r)) OR (SELECT count(*) FROM cw_roles)<>(SELECT count(*) FROM pg_roles) THEN RAISE EXCEPTION 'Roles changed'; END IF;
 IF EXISTS(SELECT 1 FROM cw_defaults b LEFT JOIN pg_default_acl d USING(oid) WHERE b.data IS DISTINCT FROM to_jsonb(d)) OR (SELECT count(*) FROM cw_defaults)<>(SELECT count(*) FROM pg_default_acl) THEN RAISE EXCEPTION 'Defaults changed'; END IF;
 IF EXISTS(SELECT 1 FROM cw_classes b LEFT JOIN pg_class c USING(oid) WHERE b.data IS DISTINCT FROM to_jsonb(c)) OR EXISTS(SELECT 1 FROM cw_columns b LEFT JOIN pg_attribute a ON a.attrelid=b.attrelid AND a.attnum=b.attnum WHERE b.data IS DISTINCT FROM to_jsonb(a)) THEN RAISE EXCEPTION 'Existing table/schema privileges changed'; END IF;
 IF EXISTS(SELECT 1 FROM cw_policies b LEFT JOIN pg_policy p USING(oid) WHERE b.data IS DISTINCT FROM to_jsonb(p)) OR (SELECT count(*) FROM cw_policies)<>(SELECT count(*) FROM pg_policy) THEN RAISE EXCEPTION 'Policies changed'; END IF;
 IF EXISTS(SELECT 1 FROM cw_triggers b LEFT JOIN pg_trigger t USING(oid) WHERE b.data IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Existing triggers changed'; END IF;
 IF EXISTS(SELECT 1 FROM cw_namespaces b LEFT JOIN pg_namespace n USING(oid) WHERE (b.nspowner,b.nspacl) IS DISTINCT FROM (n.nspowner,n.nspacl)) THEN RAISE EXCEPTION 'Schema ACL restoration mismatch'; END IF;
 IF pg_has_role(current_user,'cafe_metricool_owner','SET') OR has_schema_privilege('cafe_metricool_owner','public','CREATE') THEN RAISE EXCEPTION 'Temporary privilege leaked'; END IF;
END $$;
COMMIT;

