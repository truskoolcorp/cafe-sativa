-- OFFLINE REVIEW ONLY: no activation/enrollment. Four Café dispatch grants only. Authority writer remains owner-only.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Direct reviewed PG17 source owner required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cafe_metricool_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN RAISE EXCEPTION 'Restricted owner required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN RAISE EXCEPTION 'Existing service role required'; END IF;
 IF pg_has_role(current_user,'cafe_metricool_owner','SET') OR has_schema_privilege('cafe_metricool_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected temporary authority'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='cafe_metricool_owner'::regrole AND member=current_user::regrole AND grantor<>current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option)<>1 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='cafe_metricool_owner'::regrole AND member=current_user::regrole AND grantor=current_user::regrole) THEN RAISE EXCEPTION 'Bootstrap membership mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member='cafe_metricool_owner'::regrole OR (roleid='cafe_metricool_owner'::regrole AND member<>current_user::regrole)) THEN RAISE EXCEPTION 'Unsafe ledger owner memberships'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role' AND NOT rolcanlogin AND NOT rolsuper AND rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolbypassrls) OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator' AND rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN RAISE EXCEPTION 'Service proxy role baseline mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member='service_role'::regrole) OR (SELECT count(*) FROM pg_auth_members WHERE roleid='service_role'::regrole)<>2 OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid='service_role'::regrole AND NOT (m.grantor=(SELECT grantor FROM pg_auth_members WHERE roleid='cafe_metricool_owner'::regrole AND member=current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option) AND ((m.member='authenticator'::regrole AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option) OR (m.member=current_user::regrole AND m.admin_option AND m.inherit_option AND m.set_option)))) THEN RAISE EXCEPTION 'Service role membership baseline mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_storage_admin' AND rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND rolconfig=ARRAY['search_path=storage','log_statement=none']::text[]) THEN RAISE EXCEPTION 'Managed Storage role baseline mismatch'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE member='supabase_storage_admin'::regrole OR roleid='supabase_storage_admin'::regrole)<>1 OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member='supabase_storage_admin'::regrole AND roleid='authenticator'::regrole AND grantor=(SELECT oid FROM pg_roles WHERE rolname='supabase_admin') AND NOT admin_option AND NOT inherit_option AND set_option) THEN RAISE EXCEPTION 'Managed Storage membership baseline mismatch'; END IF;
 IF NOT pg_has_role('supabase_storage_admin','service_role','SET') OR pg_has_role('supabase_storage_admin','service_role','USAGE') THEN RAISE EXCEPTION 'Managed Storage effective path mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND r.oid NOT IN (current_user::regrole,'service_role'::regrole,'authenticator'::regrole,'supabase_storage_admin'::regrole) AND (pg_has_role(r.oid,'service_role','USAGE') OR pg_has_role(r.oid,'service_role','SET'))) THEN RAISE EXCEPTION 'Unexpected effective service principal'; END IF;
END $$;
CREATE TEMP TABLE cg_expected(sig text PRIMARY KEY,body text) ON COMMIT DROP;CREATE TEMP TABLE cd_dependencies(nsp text,name text,definition text,owner_name text) ON COMMIT DROP;
INSERT INTO cd_dependencies VALUES ('cafe_metricool_private','authorized','CREATE OR REPLACE FUNCTION cafe_metricool_private.authorized(p uuid, p_digest text)
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
 AND NOT EXISTS(SELECT 1 FROM cafe_metricool_private.external_receipts e WHERE e.brand_id=s->>''brandId'' AND e.network=s->>''network'' AND e.account_id=s->>''accountId'' AND (e.evidence->>''promoId''=d.id::text OR e.video_sha256=s->>''videoSha256'' OR e.scheduled_at=(s->>''scheduledAt'')::timestamptz))
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
','cafe_metricool_owner'),('cafe_metricool_private','canonical_json','CREATE OR REPLACE FUNCTION cafe_metricool_private.canonical_json(v jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO ''pg_catalog''
AS $function$
DECLARE t text;
BEGIN
 CASE jsonb_typeof(v)
 WHEN ''object'' THEN SELECT ''{''||coalesce(string_agg(to_jsonb(key)::text||'':''||cafe_metricool_private.canonical_json(value),'','' ORDER BY key COLLATE "C"),'''')||''}'' INTO t FROM jsonb_each(v);
 WHEN ''array'' THEN SELECT ''[''||coalesce(string_agg(cafe_metricool_private.canonical_json(value),'','' ORDER BY n),'''')||'']'' INTO t FROM jsonb_array_elements(v) WITH ORDINALITY a(value,n);
 ELSE t:=v::text;
 END CASE;
 RETURN t;
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
','cafe_metricool_owner'),('public','cs_record_cafe_metricool_authority','CREATE OR REPLACE FUNCTION public.cs_record_cafe_metricool_authority(p_plan uuid, p_snapshot jsonb, p_digest text, p_destination text, p_media text, p_source jsonb, p_actor uuid, p_approved_at timestamp with time zone, p_expires_at timestamp with time zone, p_authority jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''pg_catalog''
AS $function$
DECLARE promo uuid; stamp timestamptz; expected_digest text; destination text; media text; auth_at timestamptz; auth_exp timestamptz; evidence text; parsed jsonb;
BEGIN
 IF current_setting(''transaction_isolation'')<>''read committed'' THEN RAISE EXCEPTION ''READ COMMITTED required''; END IF;
 -- This exact helper is supplied by the separate reviewed store installer.
 IF NOT coalesce(public.cs_cafe_metricool_is_admin(p_actor),false) THEN RAISE EXCEPTION ''Content admin required''; END IF;
 SELECT promo_id INTO promo FROM public.cs_character_promo_delivery_plans WHERE id=p_plan;
 IF promo IS NULL THEN RAISE EXCEPTION ''Unknown plan''; END IF;
 PERFORM 1 FROM public.cs_character_promo_drafts WHERE id=promo FOR UPDATE;
 PERFORM 1 FROM cafe_metricool_private.approvals WHERE plan_id=p_plan FOR UPDATE;
 stamp:=clock_timestamp();
 IF NOT coalesce(public.cs_cafe_metricool_is_admin(p_actor),false)
 OR EXISTS(SELECT 1 FROM cafe_metricool_private.approvals WHERE plan_id=p_plan)
 OR EXISTS(SELECT 1 FROM cafe_metricool_private.attempts a JOIN public.cs_character_promo_delivery_plans x ON x.id=a.plan_id WHERE x.promo_id=promo)
 OR p_source IS DISTINCT FROM cafe_metricool_private.source_state(p_plan) THEN RAISE EXCEPTION ''Changed or already recorded source''; END IF;
 IF jsonb_typeof(p_snapshot) IS DISTINCT FROM ''object'' OR octet_length(p_snapshot::text)>32768 OR jsonb_typeof(p_source) IS DISTINCT FROM ''object'' OR octet_length(p_source::text)>262144 OR jsonb_typeof(p_authority) IS DISTINCT FROM ''object'' OR octet_length(p_authority::text)>40000 THEN RAISE EXCEPTION ''Invalid bounded snapshot''; END IF;
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_snapshot) key) IS DISTINCT FROM
 (CASE WHEN p_snapshot->>''network''=''facebook'' THEN ARRAY[''accountId'',''brandId'',''caption'',''characterId'',''collaborators'',''contentApprovalDigest'',''facebookTitle'',''hashtags'',''network'',''planId'',''promoId'',''scheduledAt'',''timezone'',''userId'',''version'',''videoPath'',''videoSha256'']::text[]
 ELSE ARRAY[''accountId'',''brandId'',''caption'',''characterId'',''collaborators'',''contentApprovalDigest'',''hashtags'',''network'',''planId'',''promoId'',''scheduledAt'',''timezone'',''userId'',''version'',''videoPath'',''videoSha256'']::text[] END) THEN RAISE EXCEPTION ''Unexpected schedule fields''; END IF;
 IF p_snapshot->''version'' IS DISTINCT FROM ''1''::jsonb OR p_snapshot->>''planId'' IS DISTINCT FROM p_plan::text OR p_snapshot->>''promoId'' IS DISTINCT FROM promo::text THEN RAISE EXCEPTION ''Wrong schedule identity''; END IF;
 expected_digest:=encode(sha256(convert_to(cafe_metricool_private.canonical_json(p_snapshot),''UTF8'')),''hex'');
 destination:=encode(sha256(convert_to(cafe_metricool_private.canonical_json(jsonb_build_array(p_snapshot->>''brandId'',p_snapshot->>''network'',p_snapshot->>''accountId'',p_snapshot->>''scheduledAt'')),''UTF8'')),''hex'');
 media:=encode(sha256(convert_to(cafe_metricool_private.canonical_json(jsonb_build_array(p_snapshot->>''brandId'',p_snapshot->>''network'',p_snapshot->>''accountId'',p_snapshot->>''videoSha256'')),''UTF8'')),''hex'');
 IF p_digest IS DISTINCT FROM expected_digest OR p_destination IS DISTINCT FROM destination OR p_media IS DISTINCT FROM media THEN RAISE EXCEPTION ''Digest or reservation mismatch''; END IF;
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_authority) key) IS DISTINCT FROM (CASE WHEN p_authority ? ''evidenceRecord'' THEN ARRAY[''authorizedAt'',''evidenceRecord'',''expiresAt'',''reference'',''revoked'',''scheduleDigest'']::text[] ELSE ARRAY[''authorizedAt'',''expiresAt'',''reference'',''revoked'',''scheduleDigest'']::text[] END)
 OR p_authority->''revoked'' IS DISTINCT FROM ''false''::jsonb OR p_authority->>''scheduleDigest'' IS DISTINCT FROM p_digest OR NOT coalesce(p_authority->>''reference'' ~ ''^[A-Za-z0-9_.:-]{1,200}$'',false) THEN RAISE EXCEPTION ''Separate owner authority required''; END IF;
 evidence:=p_authority->>''evidenceRecord'';
 IF p_authority->>''reference'' LIKE ''cafe-policy:%'' THEN
  IF evidence IS NULL OR octet_length(evidence) NOT BETWEEN 2 AND 32768 THEN RAISE EXCEPTION ''Recoverable policy evidence required''; END IF;
  parsed:=evidence::jsonb;
  IF cafe_metricool_private.canonical_json(parsed) IS DISTINCT FROM evidence
   OR p_authority->>''reference'' IS DISTINCT FROM ''cafe-policy:''||encode(sha256(convert_to(evidence,''UTF8'')),''hex'')
   OR parsed->''assessment''->>''scheduleDigest'' IS DISTINCT FROM p_digest
   OR parsed->''assessment''->>''classification'' IS DISTINCT FROM ''routine-cafe-persona-brand-promotion''
   OR parsed->''assessment''->''highImpact'' IS DISTINCT FROM ''false''::jsonb
   OR parsed->''assessment''->''paidPromotion'' IS DISTINCT FROM ''false''::jsonb
   OR parsed->''assessment''->''containsSensitivePersonalData'' IS DISTINCT FROM ''false''::jsonb
   OR parsed->''policy''->''revoked'' IS DISTINCT FROM ''false''::jsonb
   OR parsed->''policy''->>''scope'' IS DISTINCT FROM ''routine-cafe-persona-brand-promotions''
   OR parsed->''policy''->''version'' IS DISTINCT FROM ''1''::jsonb
   OR parsed->''policy''->''paidPromotion'' IS DISTINCT FROM ''false''::jsonb
   OR parsed->''policy''->>''brandId'' IS DISTINCT FROM p_snapshot->>''brandId''
   OR parsed->''policy''->>''userId'' IS DISTINCT FROM p_snapshot->>''userId''
   OR parsed->''policy''->''accounts'' IS DISTINCT FROM ''[{"network":"facebook","accountId":"105363501666032"},{"network":"instagram","accountId":"cafesativainc"}]''::jsonb
   OR NOT coalesce((parsed->''policy''->''characterIds'') ? (p_snapshot->>''characterId''),false)
   OR NOT coalesce((parsed->''policy''->>''authorizedAt'')::timestamptz=(p_authority->>''authorizedAt'')::timestamptz AND (parsed->''policy''->>''validUntil'')::timestamptz>stamp AND (p_authority->>''expiresAt'')::timestamptz<=(parsed->''policy''->>''validUntil'')::timestamptz,false)
   OR NOT coalesce((parsed->''assessment''->>''assessedAt'')::timestamptz<=stamp AND (parsed->''assessment''->>''assessedAt'')::timestamptz>=stamp-interval ''60 seconds'' AND parsed->''assessment''->>''evidenceRef'' ~ ''^[A-Za-z0-9_.:-]{1,200}$'',false)
   OR NOT coalesce(parsed->''policy''->>''reference'' ~ ''^[A-Za-z0-9_.:-]{1,200}$'',false)
   OR jsonb_typeof(parsed->''policy''->''ownerMessageIds'') IS DISTINCT FROM ''array''
   OR jsonb_array_length(parsed->''policy''->''ownerMessageIds'') NOT BETWEEN 1 AND 20
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(parsed->''policy''->''ownerMessageIds'') m WHERE m !~ ''^Sentinel_[a-f0-9]{32}$'')
   THEN RAISE EXCEPTION ''Policy evidence mismatch''; END IF;
 ELSE
  IF evidence IS NOT NULL THEN RAISE EXCEPTION ''Unbound evidence record''; END IF;
 END IF;
 auth_at:=(p_authority->>''authorizedAt'')::timestamptz;auth_exp:=(p_authority->>''expiresAt'')::timestamptz;
 IF NOT coalesce(p_approved_at<=stamp AND p_approved_at>=stamp-interval ''60 seconds'' AND p_expires_at>stamp AND p_expires_at<=p_approved_at+interval ''24 hours'' AND p_expires_at<=auth_exp AND p_expires_at<=(p_snapshot->>''scheduledAt'')::timestamptz-interval ''60 seconds'' AND auth_at<=p_approved_at AND auth_exp>stamp,false) THEN RAISE EXCEPTION ''Authority interval invalid''; END IF;
 INSERT INTO cafe_metricool_private.approvals VALUES(p_plan,p_snapshot,p_digest,p_destination,p_media,p_source,p_actor,p_approved_at,p_expires_at,false);
 IF NOT cafe_metricool_private.authorized(p_plan,p_digest) THEN RAISE EXCEPTION ''Current final QA rejected''; END IF;
 INSERT INTO cafe_metricool_private.owner_authority_provenance VALUES(p_plan,p_authority->>''reference'',p_digest,auth_at,auth_exp,p_actor,stamp,evidence);
 RETURN jsonb_build_object(''digest'',p_digest,''expiresAt'',to_char(p_expires_at AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"''));
END $function$
','cafe_metricool_owner');
DO $$ DECLARE e record; f record; own oid:='cafe_metricool_owner'::regrole; BEGIN
 FOR e IN SELECT * FROM cd_dependencies LOOP
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=e.nsp AND p.proname=e.name)<>1 THEN RAISE EXCEPTION 'Dependency missing/overloaded %',e.name; END IF;
 SELECT p.* INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=e.nsp AND p.proname=e.name;
 IF pg_get_functiondef(f.oid) IS DISTINCT FROM e.definition OR f.proowner<>e.owner_name::regrole THEN RAISE EXCEPTION 'Dependency definition mismatch %',e.name; END IF;
 IF e.name='cs_cafe_metricool_is_admin' THEN
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner)))), b AS (SELECT current_user::regrole::oid grantor,x::regrole::oid grantee,'EXECUTE'::text privilege_type,false is_grantable FROM unnest(ARRAY[current_user::text,'character_production_owner','cafe_metricool_owner']) x) (SELECT * FROM a EXCEPT SELECT * FROM b) UNION ALL (SELECT * FROM b EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Bridge ACL mismatch'; END IF;
 ELSIF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), b AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM a EXCEPT SELECT * FROM b) UNION ALL (SELECT * FROM b EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Dependency baseline ACL mismatch %',e.name; END IF;
 END LOOP;
END $$;
INSERT INTO cg_expected VALUES('public.cs_preflight_cafe_metricool(uuid,text)','unused; exact full dependency pinned above');
INSERT INTO cg_expected VALUES('public.cs_claim_cafe_metricool(uuid,text,text,text)','unused; exact full dependency pinned above');
INSERT INTO cg_expected VALUES('public.cs_identity_cafe_metricool(uuid,uuid,text,text)','unused; exact full dependency pinned above');
INSERT INTO cg_expected VALUES('public.cs_finish_cafe_metricool(uuid,uuid,text,jsonb)','unused; exact full dependency pinned above');
LOCK TABLE public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks IN SHARE MODE;
CREATE TEMP TABLE cd_source ON COMMIT DROP AS SELECT 'drafts' name,to_jsonb(x) data FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x;
CREATE TEMP TABLE cd_triggers ON COMMIT DROP AS SELECT oid,to_jsonb(t) data FROM pg_trigger t;
CREATE TEMP TABLE cg_role_attributes ON COMMIT DROP AS SELECT * FROM pg_roles;
CREATE TEMP TABLE cg_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE cg_defaults ON COMMIT DROP AS SELECT * FROM pg_default_acl;
CREATE TEMP TABLE cg_namespaces ON COMMIT DROP AS SELECT oid,nspowner,nspacl FROM pg_namespace;
CREATE TEMP TABLE cg_tables ON COMMIT DROP AS SELECT oid,relowner,relacl,relrowsecurity,relforcerowsecurity FROM pg_class;
CREATE TEMP TABLE cg_columns ON COMMIT DROP AS SELECT attrelid,attnum,attacl FROM pg_attribute;
CREATE TEMP TABLE cg_policies ON COMMIT DROP AS SELECT oid,to_jsonb(p) data FROM pg_policy p;
CREATE TEMP TABLE cg_functions ON COMMIT DROP AS SELECT oid,proowner,proacl,pg_get_functiondef(oid) def FROM pg_proc WHERE prokind='f';
GRANT cafe_metricool_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
SET LOCAL ROLE cafe_metricool_owner;
CREATE TEMP TABLE cg_rows(name text,data jsonb) ON COMMIT DROP;
DO $$ DECLARE obj record; BEGIN
 FOR obj IN SELECT relname FROM pg_class WHERE relnamespace='cafe_metricool_private'::regnamespace AND relkind='r' LOOP
 EXECUTE format('LOCK TABLE cafe_metricool_private.%I IN SHARE MODE',obj.relname);
 EXECUTE format('INSERT INTO cg_rows SELECT %L,to_jsonb(r) FROM cafe_metricool_private.%I r',obj.relname,obj.relname);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.cs_preflight_cafe_metricool(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cs_claim_cafe_metricool(uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cs_identity_cafe_metricool(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cs_finish_cafe_metricool(uuid,uuid,text,jsonb) TO service_role;

CREATE TEMP TABLE cg_after(name text,data jsonb) ON COMMIT DROP;
DO $$ DECLARE obj record; BEGIN
 FOR obj IN SELECT relname FROM pg_class WHERE relnamespace='cafe_metricool_private'::regnamespace AND relkind='r' LOOP
 EXECUTE format('INSERT INTO cg_after SELECT %L,to_jsonb(r) FROM cafe_metricool_private.%I r',obj.relname,obj.relname);
 END LOOP;
 IF EXISTS((SELECT * FROM cg_rows EXCEPT ALL SELECT * FROM cg_after) UNION ALL (SELECT * FROM cg_after EXCEPT ALL SELECT * FROM cg_rows)) THEN RAISE EXCEPTION 'Ledger rows changed'; END IF;
END $$;
RESET ROLE;
REVOKE cafe_metricool_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE f record; own oid:='cafe_metricool_owner'::regrole; target oid:='service_role'::regrole; BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE prokind='f')<>(SELECT count(*) FROM cg_functions) OR (SELECT count(*) FROM cg_expected)<>4 THEN RAISE EXCEPTION 'Function set changed'; END IF;
 IF EXISTS(WITH actual AS (SELECT 'drafts' name,to_jsonb(x) data FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x) (SELECT * FROM actual EXCEPT ALL SELECT * FROM cd_source) UNION ALL (SELECT * FROM cd_source EXCEPT ALL SELECT * FROM actual)) THEN RAISE EXCEPTION 'Source data changed'; END IF;
 IF EXISTS(SELECT 1 FROM cd_triggers b LEFT JOIN pg_trigger t USING(oid) WHERE b.data IS DISTINCT FROM to_jsonb(t)) OR (SELECT count(*) FROM pg_trigger)<>(SELECT count(*) FROM cd_triggers) THEN RAISE EXCEPTION 'Triggers changed'; END IF;
 IF has_function_privilege('service_role','public.cs_record_cafe_metricool_authority(uuid,jsonb,text,text,text,jsonb,uuid,timestamptz,timestamptz,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Writer boundary crossed'; END IF;
 IF EXISTS((SELECT * FROM pg_roles EXCEPT SELECT * FROM cg_role_attributes) UNION ALL (SELECT * FROM cg_role_attributes EXCEPT SELECT * FROM pg_roles)) THEN RAISE EXCEPTION 'Role attributes changed'; END IF;
 IF EXISTS((SELECT * FROM pg_auth_members EXCEPT SELECT * FROM cg_members) UNION ALL (SELECT * FROM cg_members EXCEPT SELECT * FROM pg_auth_members)) OR EXISTS((SELECT * FROM pg_default_acl EXCEPT SELECT * FROM cg_defaults) UNION ALL (SELECT * FROM cg_defaults EXCEPT SELECT * FROM pg_default_acl)) THEN RAISE EXCEPTION 'Membership/default ACL changed'; END IF;
 IF EXISTS(SELECT 1 FROM cg_namespaces b LEFT JOIN pg_namespace n USING(oid) WHERE n.oid IS NULL OR n.nspowner IS DISTINCT FROM b.nspowner OR n.nspacl IS DISTINCT FROM b.nspacl) OR EXISTS(SELECT 1 FROM cg_tables b LEFT JOIN pg_class c USING(oid) WHERE c.oid IS NULL OR c.relowner IS DISTINCT FROM b.relowner OR c.relacl IS DISTINCT FROM b.relacl OR c.relrowsecurity IS DISTINCT FROM b.relrowsecurity OR c.relforcerowsecurity IS DISTINCT FROM b.relforcerowsecurity) OR EXISTS(SELECT 1 FROM cg_columns b LEFT JOIN pg_attribute a USING(attrelid,attnum) WHERE a.attrelid IS NULL OR a.attacl IS DISTINCT FROM b.attacl) THEN RAISE EXCEPTION 'Existing object authority changed'; END IF;
 IF EXISTS(SELECT 1 FROM cg_policies b LEFT JOIN pg_policy p USING(oid) WHERE p.oid IS NULL OR to_jsonb(p) IS DISTINCT FROM b.data) OR (SELECT count(*) FROM pg_policy)<>(SELECT count(*) FROM cg_policies) THEN RAISE EXCEPTION 'Policies changed'; END IF;
 IF EXISTS(SELECT 1 FROM cg_functions b LEFT JOIN pg_proc p USING(oid) WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM b.proowner OR pg_get_functiondef(p.oid) IS DISTINCT FROM b.def OR (NOT EXISTS(SELECT 1 FROM cg_expected e WHERE to_regprocedure(e.sig)=p.oid) AND p.proacl IS DISTINCT FROM b.proacl)) THEN RAISE EXCEPTION 'Unrelated function changed'; END IF;
 FOR f IN SELECT p.* FROM pg_proc p JOIN cg_expected e ON p.oid=to_regprocedure(e.sig) LOOP
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT own,target,'EXECUTE',false) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Scoped wrapper result ACL mismatch'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN cg_expected e WHERE NOT r.rolsuper AND r.oid NOT IN (current_user::regrole,'cafe_metricool_owner'::regrole,'service_role'::regrole,'authenticator'::regrole,'supabase_storage_admin'::regrole) AND has_function_privilege(r.oid,to_regprocedure(e.sig),'EXECUTE')) THEN RAISE EXCEPTION 'Unexpected effective wrapper grantee'; END IF;
 IF pg_has_role(current_user,'cafe_metricool_owner','SET') OR has_schema_privilege('cafe_metricool_owner','public','CREATE') THEN RAISE EXCEPTION 'Temporary authority remains'; END IF;
END $$;
COMMIT;
