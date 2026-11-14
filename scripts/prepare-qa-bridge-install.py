#!/usr/bin/env python3
"""Emit only: existing-owner QA bridge, disabled targets and no media writes."""
from pathlib import Path
import hashlib
R=Path(__file__).resolve().parents[1]
s=(R/'docs/proposals/character-production-qa-bridge.sql').read_text()
assert hashlib.sha256(s.encode()).hexdigest()=='babfdaa645e2dff272e9ee24c0d8735e2c0550de2a2ab13da810e2a2b6ce469f'
assert s.count('\nBEGIN;')==1 and s.count('\nCOMMIT;')==1
s=s.split('\nBEGIN;',1)[1].rsplit('\nCOMMIT;',1)[0]
pre=r'''-- OFFLINE REVIEW: no enrollment, copy, approval, schedule or publication.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Expected direct reviewed PG17 installer'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname IN ('qa_targets','qa_ingestion_receipts')) OR to_regprocedure('public.character_production_qa_prepare(text,text)') IS NOT NULL THEN RAISE EXCEPTION 'Existing QA bridge requires reconciliation'; END IF;
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
CREATE TEMP TABLE qi_acl ON COMMIT DROP AS SELECT 'table' kind,c.oid,0::smallint attnum,a.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.cs_character_promo_drafts'::regclass UNION ALL SELECT 'column',c.oid,x.attnum,a.* FROM pg_class c JOIN pg_attribute x ON x.attrelid=c.oid CROSS JOIN LATERAL aclexplode(CASE WHEN cardinality(x.attacl)>0 THEN x.attacl END) a WHERE c.oid='public.cs_character_promo_drafts'::regclass;
CREATE TEMP TABLE qi_schemas ON COMMIT DROP AS SELECT oid,nspacl FROM pg_namespace WHERE nspname IN ('public','character_production');
GRANT character_production_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO character_production_owner;
GRANT SELECT ON public.cs_character_promo_drafts TO character_production_owner;
GRANT UPDATE(video_asset_path,updated_at),REFERENCES(id) ON public.cs_character_promo_drafts TO character_production_owner;
SET LOCAL ROLE character_production_owner;
LOCK TABLE character_production.jobs,character_production.budgets,character_production.approved_slots,character_production.schedules IN SHARE MODE;
CREATE TEMP TABLE qi_rows ON COMMIT DROP AS SELECT 'jobs' name,to_jsonb(x) row FROM character_production.jobs x UNION ALL SELECT 'budgets',to_jsonb(x) FROM character_production.budgets x UNION ALL SELECT 'slots',to_jsonb(x) FROM character_production.approved_slots x UNION ALL SELECT 'schedules',to_jsonb(x) FROM character_production.schedules x;
'''
post=r'''
GRANT EXECUTE ON FUNCTION public.character_production_qa_prepare(text,text),public.character_production_qa_commit(text,text,text,bigint,uuid,timestamptz,text,text),public.character_production_qa_pending(integer) TO service_role;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM character_production.qa_targets) OR EXISTS(SELECT 1 FROM character_production.qa_ingestion_receipts) THEN RAISE EXCEPTION 'Bridge must install empty'; END IF;
 IF EXISTS(WITH actual AS (SELECT 'jobs' name,to_jsonb(x) row FROM character_production.jobs x UNION ALL SELECT 'budgets',to_jsonb(x) FROM character_production.budgets x UNION ALL SELECT 'slots',to_jsonb(x) FROM character_production.approved_slots x UNION ALL SELECT 'schedules',to_jsonb(x) FROM character_production.schedules x) (SELECT * FROM actual EXCEPT SELECT * FROM qi_rows) UNION ALL (SELECT * FROM qi_rows EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'Ledger data changed'; END IF;
END $$;
-- CREATE POLICY must resolve private relation names as the original table owner.
-- Give that bootstrap session schema-name resolution only, never table access.
CREATE TEMP TABLE qi_namespace_grant(granted boolean NOT NULL) ON COMMIT DROP;
INSERT INTO qi_namespace_grant VALUES(NOT has_schema_privilege(session_user,'character_production','USAGE'));
DO $$ BEGIN IF (SELECT granted FROM qi_namespace_grant) THEN GRANT USAGE ON SCHEMA character_production TO postgres; END IF; END $$;
RESET ROLE;
-- Target-scoped read and row lock; only exact rendered destination may be written.
CREATE POLICY character_production_qa_read ON public.cs_character_promo_drafts FOR SELECT TO character_production_owner USING(EXISTS(SELECT 1 FROM character_production.qa_targets t WHERE t.promo_id=id AND t.enabled));
CREATE POLICY character_production_qa_write ON public.cs_character_promo_drafts FOR UPDATE TO character_production_owner
 USING(EXISTS(SELECT 1 FROM character_production.qa_targets t WHERE t.promo_id=id AND t.enabled))
 WITH CHECK(status IN ('draft','revision_requested') AND audio_asset_path IS NULL AND voice_approved_at IS NULL AND video_qa_approved_at IS NULL AND publication_approved_at IS NULL AND EXISTS(SELECT 1 FROM character_production.qa_targets t JOIN character_production.jobs j ON j.key=t.job_key AND j.digest=t.digest WHERE t.promo_id=id AND t.enabled AND j.state='pending_qa' AND character_id=j.slot->>'characterId' AND spoken_script=j.slot->>'script' AND video_asset_path='character-promos/'||character_id||'/'||id::text||'/'||j.sha||'.mp4' AND updated_at>=t.expected_updated_at));
SET LOCAL ROLE character_production_owner;
DO $$ BEGIN IF (SELECT granted FROM qi_namespace_grant) THEN REVOKE USAGE ON SCHEMA character_production FROM postgres; END IF; END $$;
RESET ROLE;
REVOKE REFERENCES(id) ON public.cs_character_promo_drafts FROM character_production_owner;
REVOKE CREATE ON SCHEMA public FROM character_production_owner;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
CREATE TEMP TABLE qi_acl_after ON COMMIT DROP AS SELECT 'table' kind,c.oid,0::smallint attnum,a.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.cs_character_promo_drafts'::regclass UNION ALL SELECT 'column',c.oid,x.attnum,a.* FROM pg_class c JOIN pg_attribute x ON x.attrelid=c.oid CROSS JOIN LATERAL aclexplode(CASE WHEN cardinality(x.attacl)>0 THEN x.attacl END) a WHERE c.oid='public.cs_character_promo_drafts'::regclass;
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
 FOR f IN SELECT oid,pronamespace,proname FROM pg_proc WHERE oid IN ((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='character_production' AND p.proname='qa_manifest' AND oidvectortypes(p.proargtypes)='text, text'),'public.character_production_qa_prepare(text,text)'::regprocedure,'public.character_production_qa_commit(text,text,text,bigint,uuid,timestamptz,text,text)'::regprocedure,'public.character_production_qa_pending(integer)'::regprocedure) LOOP
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=f.oid AND (a.grantor<>'character_production_owner'::regrole OR a.is_grantable OR a.privilege_type<>'EXECUTE' OR a.grantee NOT IN ('character_production_owner'::regrole,CASE WHEN f.pronamespace='public'::regnamespace THEN 'service_role'::regrole ELSE 'character_production_owner'::regrole END))) THEN RAISE EXCEPTION 'Unexpected bridge ACL'; END IF;
 IF (SELECT proowner FROM pg_proc WHERE oid=f.oid)<>'character_production_owner'::regrole THEN RAISE EXCEPTION 'Wrong bridge function owner'; END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','character_production_generator','character_production_output_broker'] LOOP IF has_function_privilege(r,f.oid,'EXECUTE') THEN RAISE EXCEPTION 'Unexpected bridge execution'; END IF; END LOOP;
 IF has_function_privilege('service_role',f.oid,'EXECUTE') IS DISTINCT FROM (f.pronamespace='public'::regnamespace) THEN RAISE EXCEPTION 'Expected backend only three public bridge RPCs'; END IF;
 END LOOP;
END $$;
COMMIT;
'''
print(pre+s+post)
