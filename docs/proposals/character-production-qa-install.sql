-- OFFLINE REVIEW: no enrollment, copy, approval, schedule or publication.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Expected direct reviewed PG17 installer'; END IF;
 IF to_regclass('character_production.qa_targets') IS NOT NULL OR to_regclass('character_production.qa_ingestion_receipts') IS NOT NULL OR to_regprocedure('public.character_production_qa_prepare(text,text)') IS NOT NULL THEN RAISE EXCEPTION 'Existing QA bridge requires reconciliation'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected owner privilege baseline'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor<>current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option)<>1 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor=current_user::regrole) THEN RAISE EXCEPTION 'Missing original bootstrap owner context'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.cs_character_promo_drafts'::regclass AND relowner=current_user::regrole AND relrowsecurity AND NOT relforcerowsecurity) OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.cs_character_promo_drafts'::regclass) THEN RAISE EXCEPTION 'Expected source owner/RLS/zero-policy baseline'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='cafe-sativa-content' AND public=false AND file_size_limit=52428800 AND allowed_mime_types=ARRAY['video/mp4']) THEN RAISE EXCEPTION 'Expected unchanged private MP4 bucket'; END IF;
END $$;
LOCK TABLE public.cs_character_promo_drafts IN SHARE MODE;
CREATE TEMP TABLE qi_drafts ON COMMIT DROP AS SELECT to_jsonb(d) row FROM public.cs_character_promo_drafts d;
CREATE TEMP TABLE qi_bucket ON COMMIT DROP AS SELECT to_jsonb(b) row FROM storage.buckets b WHERE id='cafe-sativa-content';
CREATE TEMP TABLE qi_members ON COMMIT DROP AS SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members;
CREATE TEMP TABLE qi_functions ON COMMIT DROP AS SELECT oid,proowner,proacl,pg_get_functiondef(oid) definition FROM pg_proc WHERE (pronamespace='character_production'::regnamespace OR (pronamespace='public'::regnamespace AND proname LIKE 'character_production_%')) AND prokind='f';
CREATE TEMP TABLE qi_objects ON COMMIT DROP AS SELECT oid,relacl,relowner,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='character_production'::regnamespace OR oid='public.cs_character_promo_drafts'::regclass;
CREATE TEMP TABLE qi_triggers ON COMMIT DROP AS SELECT oid,to_jsonb(t) data FROM pg_trigger t WHERE tgrelid='public.cs_character_promo_drafts'::regclass;
CREATE TEMP TABLE qi_acl ON COMMIT DROP AS SELECT 'table' kind,c.oid,0::smallint attnum,a.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.cs_character_promo_drafts'::regclass UNION ALL SELECT 'column',c.oid,x.attnum,a.* FROM pg_class c JOIN pg_attribute x ON x.attrelid=c.oid CROSS JOIN LATERAL aclexplode(coalesce(x.attacl,'{}'::aclitem[])) a WHERE c.oid='public.cs_character_promo_drafts'::regclass;
CREATE TEMP TABLE qi_schemas ON COMMIT DROP AS SELECT oid,nspacl FROM pg_namespace WHERE nspname IN ('public','character_production');
GRANT character_production_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO character_production_owner;
GRANT SELECT ON public.cs_character_promo_drafts TO character_production_owner;
GRANT UPDATE(video_asset_path,updated_at),REFERENCES(id) ON public.cs_character_promo_drafts TO character_production_owner;
SET LOCAL ROLE character_production_owner;
LOCK TABLE character_production.jobs,character_production.budgets,character_production.approved_slots,character_production.schedules IN SHARE MODE;
CREATE TEMP TABLE qi_rows ON COMMIT DROP AS SELECT 'jobs' name,to_jsonb(x) row FROM character_production.jobs x UNION ALL SELECT 'budgets',to_jsonb(x) FROM character_production.budgets x UNION ALL SELECT 'slots',to_jsonb(x) FROM character_production.approved_slots x UNION ALL SELECT 'schedules',to_jsonb(x) FROM character_production.schedules x;

CREATE TABLE character_production.qa_targets (
 job_key text PRIMARY KEY REFERENCES character_production.jobs(key),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 promo_id uuid NOT NULL UNIQUE REFERENCES public.cs_character_promo_drafts(id),
 expected_updated_at timestamptz NOT NULL,
 enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE character_production.qa_ingestion_receipts (
 job_key text PRIMARY KEY REFERENCES character_production.qa_targets(job_key),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), promo_id uuid NOT NULL UNIQUE,
 expected_updated_at timestamptz NOT NULL, committed_updated_at timestamptz NOT NULL,
 sha text NOT NULL CHECK(sha ~ '^[a-f0-9]{64}$'), bytes bigint NOT NULL CHECK(bytes BETWEEN 16 AND 36700160),
 bucket text NOT NULL CHECK(bucket='cafe-sativa-content'), object_path text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE character_production.qa_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_production.qa_ingestion_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON character_production.qa_targets,character_production.qa_ingestion_receipts FROM PUBLIC;
-- Internal validator holds locks through the entire caller transaction. No
-- worker may enroll targets, modify receipts or invoke this helper directly.
CREATE FUNCTION character_production.qa_manifest(p_key text,p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a character_production.approved_slots; j character_production.jobs;
 t character_production.qa_targets; d public.cs_character_promo_drafts;
 r character_production.qa_ingestion_receipts; dest text; phase text;
BEGIN
 -- Refuse stale repeatable-read snapshots of policy/targets. External callers
 -- must use independent READ COMMITTED transactions, not retained snapshots.
 IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RETURN NULL; END IF;
 SELECT * INTO a FROM character_production.approved_slots WHERE key=p_key FOR UPDATE;
 IF NOT FOUND OR a.enabled IS DISTINCT FROM true OR a.digest IS DISTINCT FROM p_digest THEN RETURN NULL; END IF;
 SELECT * INTO j FROM character_production.jobs WHERE key=p_key FOR UPDATE;
 IF NOT FOUND OR j.digest IS DISTINCT FROM p_digest OR j.digest IS DISTINCT FROM a.digest
 OR a.slot IS DISTINCT FROM j.slot OR j.state IS DISTINCT FROM 'pending_qa'
 OR j.sha IS NULL OR j.sha !~ '^[a-f0-9]{64}$' OR j.bytes IS NULL OR j.bytes NOT BETWEEN 16 AND 36700160
 OR j.bucket IS DISTINCT FROM 'character-production-private'
 OR j.object_path IS DISTINCT FROM j.digest||'/'||j.sha||'.mp4' THEN RETURN NULL; END IF;
 SELECT * INTO t FROM character_production.qa_targets WHERE job_key=j.key FOR UPDATE;
 IF NOT FOUND OR t.enabled IS DISTINCT FROM true OR t.digest IS DISTINCT FROM j.digest THEN RETURN NULL; END IF;
 SELECT * INTO d FROM public.cs_character_promo_drafts WHERE id=t.promo_id FOR UPDATE;
 IF NOT FOUND OR d.character_id IS DISTINCT FROM j.slot->>'characterId' OR d.spoken_script IS DISTINCT FROM j.slot->>'script'
 OR j.slot->>'characterId' IS NULL OR j.slot->>'characterId' !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$'
 OR j.slot->>'script' IS NULL OR length(btrim(j.slot->>'script'))=0
 OR d.status IS NULL OR d.status NOT IN ('draft','revision_requested')
 OR d.audio_asset_path IS NOT NULL OR d.voice_approved_at IS NOT NULL OR d.video_qa_approved_at IS NOT NULL
 OR d.publication_approved_at IS NOT NULL THEN RETURN NULL; END IF;
 dest:='character-promos/'||d.character_id||'/'||d.id::text||'/'||j.sha||'.mp4';
 SELECT * INTO r FROM character_production.qa_ingestion_receipts WHERE job_key=j.key FOR UPDATE;
 IF FOUND THEN
  IF r.digest IS DISTINCT FROM j.digest OR r.promo_id IS DISTINCT FROM d.id
  OR r.expected_updated_at IS DISTINCT FROM t.expected_updated_at OR r.sha IS DISTINCT FROM j.sha
  OR r.bytes IS DISTINCT FROM j.bytes OR r.object_path IS DISTINCT FROM dest
  OR r.bucket IS DISTINCT FROM 'cafe-sativa-content' OR d.video_asset_path IS DISTINCT FROM dest
  OR d.updated_at IS DISTINCT FROM r.committed_updated_at THEN RETURN NULL; END IF;
  phase:='committed';
 ELSE
  IF d.updated_at IS DISTINCT FROM t.expected_updated_at OR d.video_asset_path IS NOT NULL THEN RETURN NULL; END IF;
  phase:='copy';
 END IF;
 RETURN jsonb_build_object('state',phase,'key',j.key,'digest',j.digest,'sha',j.sha,'bytes',j.bytes,
 'characterId',d.character_id,'promoId',d.id,'expectedUpdatedAt',t.expected_updated_at,
 'sourceBucket',j.bucket,'sourcePath',j.object_path,'destinationBucket','cafe-sativa-content','destinationPath',dest);
END $$;
CREATE FUNCTION public.character_production_qa_prepare(p_key text,p_digest text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT character_production.qa_manifest(p_key,p_digest)
$$;
CREATE FUNCTION public.character_production_qa_commit(p_key text,p_digest text,p_sha text,p_bytes bigint,
 p_promo_id uuid,p_expected_updated_at timestamptz,p_destination_bucket text,p_destination_path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m jsonb; stamp timestamptz;
BEGIN
 m:=character_production.qa_manifest(p_key,p_digest);
 -- Compare the exact prepared target, including PostgreSQL microsecond precision.
 -- These are equality guards, not authority to select or enroll another target.
 IF m IS NULL OR m->>'sha' IS DISTINCT FROM p_sha OR (m->>'bytes')::bigint IS DISTINCT FROM p_bytes
 OR (m->>'promoId')::uuid IS DISTINCT FROM p_promo_id
 OR (m->>'expectedUpdatedAt')::timestamptz IS DISTINCT FROM p_expected_updated_at
 OR m->>'destinationBucket' IS DISTINCT FROM p_destination_bucket
 OR m->>'destinationPath' IS DISTINCT FROM p_destination_path THEN RETURN false; END IF;
 IF m->>'state'='committed' THEN RETURN true; END IF;
 -- Only the audited private bridge may attest storage byte verification. SQL
 -- cannot inspect Storage bytes. No ordinary generation-worker EXECUTE access.
 UPDATE public.cs_character_promo_drafts SET video_asset_path=m->>'destinationPath',updated_at=clock_timestamp()
 WHERE id=(m->>'promoId')::uuid AND updated_at=(m->>'expectedUpdatedAt')::timestamptz
 AND video_asset_path IS NULL AND audio_asset_path IS NULL
 AND voice_approved_at IS NULL AND video_qa_approved_at IS NULL AND publication_approved_at IS NULL
 RETURNING updated_at INTO stamp;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO character_production.qa_ingestion_receipts(job_key,digest,promo_id,expected_updated_at,committed_updated_at,sha,bytes,bucket,object_path)
 VALUES(p_key,p_digest,(m->>'promoId')::uuid,(m->>'expectedUpdatedAt')::timestamptz,stamp,p_sha,p_bytes,'cafe-sativa-content',m->>'destinationPath');
 RETURN true;
END $$;
-- Read-only discovery never substitutes for locked prepare/commit validation.
CREATE FUNCTION public.character_production_qa_pending(p_limit integer)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(x.identity),'[]'::jsonb) FROM (
  SELECT jsonb_build_object('key',j.key,'digest',j.digest) AS identity
  FROM character_production.jobs j
  JOIN character_production.qa_targets t ON t.job_key=j.key AND t.digest=j.digest AND t.enabled=true
  JOIN character_production.approved_slots a ON a.key=j.key AND a.digest=j.digest AND a.slot=j.slot AND a.enabled=true
  WHERE j.state='pending_qa'
  AND NOT EXISTS(SELECT 1 FROM character_production.qa_ingestion_receipts r WHERE r.job_key=j.key)
  ORDER BY j.created_at,j.key LIMIT greatest(0,least(coalesce(p_limit,0),5))
 ) x
$$;
REVOKE ALL ON FUNCTION character_production.qa_manifest(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_qa_prepare(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_qa_commit(text,text,text,bigint,uuid,timestamptz,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.character_production_qa_pending(integer) FROM PUBLIC;
-- Remove common inherited default grants; grant nothing in this proposal.
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON character_production.qa_targets,character_production.qa_ingestion_receipts FROM %I',r);
   EXECUTE format('REVOKE ALL ON FUNCTION character_production.qa_manifest(text,text) FROM %I',r);
   EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_qa_prepare(text,text) FROM %I',r);
   EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_qa_commit(text,text,text,bigint,uuid,timestamptz,text,text) FROM %I',r);
   EXECUTE format('REVOKE ALL ON FUNCTION public.character_production_qa_pending(integer) FROM %I',r);
  END IF;
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.character_production_qa_prepare(text,text),public.character_production_qa_commit(text,text,text,bigint,uuid,timestamptz,text,text),public.character_production_qa_pending(integer) TO service_role;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM character_production.qa_targets) OR EXISTS(SELECT 1 FROM character_production.qa_ingestion_receipts) THEN RAISE EXCEPTION 'Bridge must install empty'; END IF;
 IF EXISTS(WITH actual AS (SELECT 'jobs' name,to_jsonb(x) row FROM character_production.jobs x UNION ALL SELECT 'budgets',to_jsonb(x) FROM character_production.budgets x UNION ALL SELECT 'slots',to_jsonb(x) FROM character_production.approved_slots x UNION ALL SELECT 'schedules',to_jsonb(x) FROM character_production.schedules x) (SELECT * FROM actual EXCEPT SELECT * FROM qi_rows) UNION ALL (SELECT * FROM qi_rows EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'Ledger data changed'; END IF;
END $$;
RESET ROLE;
-- Target-scoped read and row lock; only exact rendered destination may be written.
CREATE POLICY character_production_qa_read ON public.cs_character_promo_drafts FOR SELECT TO character_production_owner USING(EXISTS(SELECT 1 FROM character_production.qa_targets t WHERE t.promo_id=id AND t.enabled));
CREATE POLICY character_production_qa_write ON public.cs_character_promo_drafts FOR UPDATE TO character_production_owner
 USING(EXISTS(SELECT 1 FROM character_production.qa_targets t WHERE t.promo_id=id AND t.enabled))
 WITH CHECK(status IN ('draft','revision_requested') AND audio_asset_path IS NULL AND voice_approved_at IS NULL AND video_qa_approved_at IS NULL AND publication_approved_at IS NULL AND EXISTS(SELECT 1 FROM character_production.qa_targets t JOIN character_production.jobs j ON j.key=t.job_key AND j.digest=t.digest WHERE t.promo_id=id AND t.enabled AND j.state='pending_qa' AND character_id=j.slot->>'characterId' AND spoken_script=j.slot->>'script' AND video_asset_path='character-promos/'||character_id||'/'||id::text||'/'||j.sha||'.mp4' AND updated_at>=t.expected_updated_at));
REVOKE REFERENCES(id) ON public.cs_character_promo_drafts FROM character_production_owner;
REVOKE CREATE ON SCHEMA public FROM character_production_owner;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
CREATE TEMP TABLE qi_acl_after ON COMMIT DROP AS SELECT 'table' kind,c.oid,0::smallint attnum,a.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.cs_character_promo_drafts'::regclass UNION ALL SELECT 'column',c.oid,x.attnum,a.* FROM pg_class c JOIN pg_attribute x ON x.attrelid=c.oid CROSS JOIN LATERAL aclexplode(coalesce(x.attacl,'{}'::aclitem[])) a WHERE c.oid='public.cs_character_promo_drafts'::regclass;
DO $$ DECLARE r text; f record; BEGIN
 IF EXISTS((SELECT row FROM qi_drafts EXCEPT SELECT to_jsonb(d) FROM public.cs_character_promo_drafts d) UNION ALL (SELECT to_jsonb(d) FROM public.cs_character_promo_drafts d EXCEPT SELECT row FROM qi_drafts)) OR (SELECT row FROM qi_bucket) IS DISTINCT FROM (SELECT to_jsonb(b) FROM storage.buckets b WHERE id='cafe-sativa-content') THEN RAISE EXCEPTION 'Source draft or bucket changed'; END IF;
 IF EXISTS((SELECT * FROM qi_members EXCEPT SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members) UNION ALL (SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members EXCEPT SELECT * FROM qi_members)) THEN RAISE EXCEPTION 'Membership restoration mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM qi_objects b LEFT JOIN pg_class c USING(oid) WHERE c.oid IS NULL OR (b.relowner,b.relrowsecurity,b.relforcerowsecurity) IS DISTINCT FROM (c.relowner,c.relrowsecurity,c.relforcerowsecurity) OR (b.oid<>'public.cs_character_promo_drafts'::regclass AND b.relacl IS DISTINCT FROM c.relacl)) THEN RAISE EXCEPTION 'Prior private objects changed'; END IF;
 IF EXISTS(SELECT 1 FROM qi_functions b LEFT JOIN pg_proc p USING(oid) WHERE p.oid IS NULL OR (b.proowner,b.proacl,b.definition) IS DISTINCT FROM (p.proowner,p.proacl,pg_get_functiondef(p.oid))) THEN RAISE EXCEPTION 'Prior functions changed'; END IF;
 IF EXISTS(SELECT 1 FROM qi_triggers b LEFT JOIN pg_trigger t USING(oid) WHERE b.data IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Existing source guards changed'; END IF;
 IF EXISTS(SELECT 1 FROM qi_schemas b JOIN pg_namespace n USING(oid) WHERE b.nspacl IS DISTINCT FROM n.nspacl) THEN RAISE EXCEPTION 'Schema ACL restoration mismatch'; END IF;
 IF EXISTS((SELECT * FROM qi_acl EXCEPT SELECT * FROM qi_acl_after WHERE grantee<>'character_production_owner'::regrole) UNION ALL (SELECT * FROM qi_acl_after WHERE grantee<>'character_production_owner'::regrole EXCEPT SELECT * FROM qi_acl)) THEN RAISE EXCEPTION 'Original source privileges changed'; END IF;
 IF (SELECT count(*) FROM qi_acl_after WHERE grantee='character_production_owner'::regrole)<>3 OR EXISTS(SELECT 1 FROM qi_acl_after WHERE grantee='character_production_owner'::regrole AND NOT (grantor=current_user::regrole AND NOT is_grantable AND ((kind='table' AND privilege_type='SELECT') OR (kind='column' AND privilege_type='UPDATE' AND attnum IN (SELECT attnum FROM pg_attribute WHERE attrelid='public.cs_character_promo_drafts'::regclass AND attname IN ('video_asset_path','updated_at')))) )) THEN RAISE EXCEPTION 'Expected exact source read and two-column update rights'; END IF;
 IF (SELECT count(*) FROM pg_policy WHERE polrelid='public.cs_character_promo_drafts'::regclass)<>2 OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.cs_character_promo_drafts'::regclass AND NOT (polroles=ARRAY['character_production_owner'::regrole::oid] AND polpermissive AND ((polname='character_production_qa_read' AND polcmd='r') OR (polname='character_production_qa_write' AND polcmd='w')))) THEN RAISE EXCEPTION 'Unexpected source policies'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Temporary owner authority leaked'; END IF;
 FOR f IN SELECT oid,pronamespace,proname FROM pg_proc WHERE oid IN ('character_production.qa_manifest(text,text)'::regprocedure,'public.character_production_qa_prepare(text,text)'::regprocedure,'public.character_production_qa_commit(text,text,text,bigint,uuid,timestamptz,text,text)'::regprocedure,'public.character_production_qa_pending(integer)'::regprocedure) LOOP
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=f.oid AND (a.grantor<>'character_production_owner'::regrole OR a.is_grantable OR a.privilege_type<>'EXECUTE' OR a.grantee NOT IN ('character_production_owner'::regrole,CASE WHEN f.pronamespace='public'::regnamespace THEN 'service_role'::regrole ELSE 'character_production_owner'::regrole END))) THEN RAISE EXCEPTION 'Unexpected bridge ACL'; END IF;
 IF (SELECT proowner FROM pg_proc WHERE oid=f.oid)<>'character_production_owner'::regrole THEN RAISE EXCEPTION 'Wrong bridge function owner'; END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','character_production_generator','character_production_output_broker'] LOOP IF has_function_privilege(r,f.oid,'EXECUTE') THEN RAISE EXCEPTION 'Unexpected bridge execution'; END IF; END LOOP;
 IF has_function_privilege('service_role',f.oid,'EXECUTE') IS DISTINCT FROM (f.pronamespace='public'::regnamespace) THEN RAISE EXCEPTION 'Expected backend only three public bridge RPCs'; END IF;
 END LOOP;
END $$;
COMMIT;

