#!/usr/bin/env python3
"""Generate reviewed inert PG17 installer from exact dormant store source; no execution."""
from pathlib import Path
import hashlib
ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'docs/proposals/cafe-metricool-store.sql').read_text()
assert hashlib.sha256(source.encode()).hexdigest()=='ef1e8ad4aa55fb603a82e190d948ea6b41d59c57d473fbbe4e5bbe964618b454', 'Unreviewed base store source'
old="EXISTS(SELECT 1 FROM auth.users WHERE id=a.approved_by AND raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb)"
assert source.count(old)==1
source=source.replace(old,'public.cs_cafe_metricool_is_admin(a.approved_by)')
assert source.count('approved_by uuid NOT NULL REFERENCES auth.users(id),')==1
source=source.replace('approved_by uuid NOT NULL REFERENCES auth.users(id),','approved_by uuid NOT NULL, -- live fixed boolean check validates actor; no auth FK authority')
assert source.count('\nBEGIN;')==1 and source.count('\nCOMMIT;')==1
source=source.split('\nBEGIN;',1)[1].rsplit('\nCOMMIT;',1)[0]
pre=r'''-- REVIEW ONLY: no execution, runtime grants, approvals, jobs, or activation.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
DO $$ DECLARE t text; BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'PostgreSQL17 required'; END IF;
 IF current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Exact direct installer required'; END IF;
 IF to_regnamespace('cafe_metricool_private') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cafe_metricool_owner') THEN RAISE EXCEPTION 'Existing store requires reconciliation'; END IF;
 FOREACH t IN ARRAY ARRAY['public.cs_character_promo_drafts','public.cs_character_promo_delivery_plans','public.cs_character_promo_qa_checks'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass(t) AND relowner=current_user::regrole AND relrowsecurity) THEN RAISE EXCEPTION 'Expected installer-owned RLS source %',t; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.cs_character_promo_drafts'::regclass AND polpermissive AND polcmd IN ('w','*') AND 0::oid=ANY(polroles)) THEN RAISE EXCEPTION 'PUBLIC write policy defeats lock-only scope'; END IF;
 IF NOT has_column_privilege(current_user,'auth.users','id','SELECT') OR NOT has_column_privilege(current_user,'auth.users','raw_app_meta_data','SELECT') OR NOT has_schema_privilege(current_user,'auth','USAGE') THEN RAISE EXCEPTION 'Missing preexisting installer auth lookup/reference rights'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('cs_preflight_cafe_metricool','cs_claim_cafe_metricool','cs_identity_cafe_metricool','cs_finish_cafe_metricool')) THEN RAISE EXCEPTION 'Unexpected old RPC'; END IF;
END $$;
-- Existing production bridge is recognized only by its exact reviewed definition and ACL.
CREATE TEMP TABLE cm_helper ON COMMIT DROP AS SELECT oid,proowner,proacl,pg_get_functiondef(oid) definition FROM pg_proc WHERE oid=to_regprocedure('public.cs_cafe_metricool_is_admin(uuid)');
DO $bridge$ BEGIN
 IF EXISTS(SELECT 1 FROM cm_helper) THEN
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=(SELECT oid FROM cm_helper)
   AND p.proowner=current_user::regrole AND pg_get_functiondef(p.oid)=$definition$CREATE OR REPLACE FUNCTION public.cs_cafe_metricool_is_admin(p_actor uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT 1 FROM auth.users u
 WHERE u.id=p_actor AND u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb)
$function$
$definition$) THEN RAISE EXCEPTION 'Unknown existing admin bridge definition'; END IF;
  IF to_regrole('character_production_owner') IS NULL THEN RAISE EXCEPTION 'Missing bridge owner role'; END IF;
  IF EXISTS(WITH actual AS (SELECT a.* FROM cm_helper p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a), expected AS (SELECT current_user::regrole::oid grantor,current_user::regrole::oid grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT current_user::regrole::oid,'character_production_owner'::regrole::oid,'EXECUTE',false) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'Unknown existing admin bridge ACL'; END IF;
 END IF;
END $bridge$;
CREATE TEMP TABLE cm_members ON COMMIT DROP AS SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members;
CREATE TEMP TABLE cm_policies ON COMMIT DROP AS SELECT oid,to_jsonb(p) data FROM pg_policy p WHERE polrelid IN ('public.cs_character_promo_drafts'::regclass,'public.cs_character_promo_delivery_plans'::regclass,'public.cs_character_promo_qa_checks'::regclass);
CREATE TEMP TABLE cm_triggers ON COMMIT DROP AS SELECT oid,to_jsonb(t) data FROM pg_trigger t WHERE tgrelid IN ('public.cs_character_promo_drafts'::regclass,'public.cs_character_promo_delivery_plans'::regclass,'public.cs_character_promo_qa_checks'::regclass);
CREATE TEMP TABLE cm_tables ON COMMIT DROP AS SELECT oid,relowner,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('public.cs_character_promo_drafts'::regclass,'public.cs_character_promo_delivery_plans'::regclass,'public.cs_character_promo_qa_checks'::regclass,'auth.users'::regclass);
CREATE TEMP TABLE cm_acl ON COMMIT DROP AS
 SELECT 'table' kind,c.oid,0::smallint attnum,a.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid IN (SELECT oid FROM cm_tables)
 UNION ALL SELECT 'column',c.oid,x.attnum,a.* FROM pg_class c JOIN pg_attribute x ON x.attrelid=c.oid CROSS JOIN LATERAL aclexplode(CASE WHEN cardinality(x.attacl)>0 THEN x.attacl END) a WHERE c.oid IN (SELECT oid FROM cm_tables)
 UNION ALL SELECT 'schema',n.oid,0::smallint,a.* FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname IN ('public','auth')
 UNION ALL SELECT 'database',d.oid,0::smallint,a.* FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database();
CREATE TEMP TABLE cm_functions ON COMMIT DROP AS SELECT oid,proowner,proacl,pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f';
CREATE ROLE cafe_metricool_owner NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- PG17 creator bootstrap edge is preserved; self-issued temporary SET is removed.
CREATE TEMP TABLE cm_bootstrap ON COMMIT DROP AS SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members WHERE roleid='cafe_metricool_owner'::regrole;
DO $$ BEGIN
 IF (SELECT count(*) FROM cm_bootstrap)<>1 OR EXISTS(SELECT 1 FROM cm_bootstrap WHERE member<>current_user::regrole OR grantor=current_user::regrole OR NOT admin_option OR inherit_option OR set_option) THEN RAISE EXCEPTION 'Unexpected PG17 owner bootstrap'; END IF;
END $$;
GRANT cafe_metricool_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
-- Only the boolean helper can inspect private auth metadata; fixed UUID lookup.
DO $create_bridge$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM cm_helper) THEN
 EXECUTE $ddl$CREATE FUNCTION public.cs_cafe_metricool_is_admin(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb FROM auth.users WHERE id=p_user),false)
$$;
$ddl$;
 REVOKE ALL ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) FROM PUBLIC,anon,authenticated,service_role;
 END IF;
END $create_bridge$;
GRANT EXECUTE ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) TO cafe_metricool_owner;
GRANT USAGE,CREATE ON SCHEMA public TO cafe_metricool_owner;
DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO cafe_metricool_owner',current_database()); END $$;
GRANT SELECT ON public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks TO cafe_metricool_owner;
GRANT UPDATE(id) ON public.cs_character_promo_drafts TO cafe_metricool_owner;
GRANT REFERENCES(id) ON public.cs_character_promo_delivery_plans TO cafe_metricool_owner;
GRANT TRIGGER ON public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks TO cafe_metricool_owner;
CREATE POLICY cafe_metricool_owner_read ON public.cs_character_promo_drafts FOR SELECT TO cafe_metricool_owner USING(true);
CREATE POLICY cafe_metricool_owner_read ON public.cs_character_promo_delivery_plans FOR SELECT TO cafe_metricool_owner USING(true);
CREATE POLICY cafe_metricool_owner_read ON public.cs_character_promo_qa_checks FOR SELECT TO cafe_metricool_owner USING(true);
CREATE POLICY cafe_metricool_owner_lock ON public.cs_character_promo_drafts FOR UPDATE TO cafe_metricool_owner USING(true) WITH CHECK(false);
SET LOCAL ROLE cafe_metricool_owner;
'''
post=r'''
RESET ROLE;
REVOKE REFERENCES(id) ON public.cs_character_promo_delivery_plans FROM cafe_metricool_owner;
REVOKE TRIGGER ON public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks FROM cafe_metricool_owner;
REVOKE CREATE ON SCHEMA public FROM cafe_metricool_owner;
DO $$ BEGIN EXECUTE format('REVOKE CREATE ON DATABASE %I FROM cafe_metricool_owner',current_database()); END $$;
REVOKE cafe_metricool_owner FROM postgres GRANTED BY postgres;
CREATE TEMP TABLE cm_acl_after ON COMMIT DROP AS
 SELECT 'table' kind,c.oid,0::smallint attnum,a.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid IN (SELECT oid FROM cm_tables)
 UNION ALL SELECT 'column',c.oid,x.attnum,a.* FROM pg_class c JOIN pg_attribute x ON x.attrelid=c.oid CROSS JOIN LATERAL aclexplode(CASE WHEN cardinality(x.attacl)>0 THEN x.attacl END) a WHERE c.oid IN (SELECT oid FROM cm_tables)
 UNION ALL SELECT 'schema',n.oid,0::smallint,a.* FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname IN ('public','auth')
 UNION ALL SELECT 'database',d.oid,0::smallint,a.* FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database();
DO $$ DECLARE r text; new_object record; new_owner oid:='cafe_metricool_owner'::regrole; BEGIN
 IF EXISTS((SELECT * FROM cm_acl EXCEPT SELECT * FROM cm_acl_after WHERE grantee<>'cafe_metricool_owner'::regrole) UNION ALL (SELECT * FROM cm_acl_after WHERE grantee<>'cafe_metricool_owner'::regrole EXCEPT SELECT * FROM cm_acl)) THEN RAISE EXCEPTION 'Existing source/schema privileges changed'; END IF;
 IF EXISTS(SELECT 1 FROM cm_acl_after WHERE grantee='cafe_metricool_owner'::regrole AND NOT (grantor=CASE WHEN kind='schema' THEN (SELECT nspowner FROM pg_namespace WHERE pg_namespace.oid=cm_acl_after.oid) ELSE current_user::regrole END AND NOT is_grantable AND ((kind='table' AND privilege_type='SELECT' AND oid IN ('public.cs_character_promo_drafts'::regclass,'public.cs_character_promo_delivery_plans'::regclass,'public.cs_character_promo_qa_checks'::regclass)) OR (kind='column' AND privilege_type='UPDATE' AND oid='public.cs_character_promo_drafts'::regclass AND attnum=(SELECT attnum FROM pg_attribute WHERE attrelid='public.cs_character_promo_drafts'::regclass AND attname='id')) OR (kind='schema' AND oid='public'::regnamespace AND privilege_type='USAGE')))) THEN RAISE EXCEPTION 'Owner privilege exceeds exact read/lock scope'; END IF;
 IF (SELECT count(*) FROM cm_acl_after WHERE grantee='cafe_metricool_owner'::regrole)<>5 THEN RAISE EXCEPTION 'Missing exact owner source privileges'; END IF;
 IF EXISTS(SELECT 1 FROM cm_tables b JOIN pg_class c USING(oid) WHERE (b.relowner,b.relrowsecurity,b.relforcerowsecurity) IS DISTINCT FROM (c.relowner,c.relrowsecurity,c.relforcerowsecurity)) THEN RAISE EXCEPTION 'Source ownership/RLS changed'; END IF;
 IF EXISTS(SELECT 1 FROM cm_policies b LEFT JOIN pg_policy p USING(oid) WHERE b.data IS DISTINCT FROM to_jsonb(p)) OR EXISTS(SELECT 1 FROM cm_triggers b LEFT JOIN pg_trigger t USING(oid) WHERE b.data IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Existing guards/policies changed'; END IF;
 IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid IN (SELECT oid FROM cm_tables WHERE oid<>'auth.users'::regclass) AND NOT EXISTS(SELECT 1 FROM cm_policies b WHERE b.oid=p.oid))<>4 OR EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid IN (SELECT oid FROM cm_tables WHERE oid<>'auth.users'::regclass) AND NOT EXISTS(SELECT 1 FROM cm_policies b WHERE b.oid=p.oid) AND NOT (p.polroles=ARRAY['cafe_metricool_owner'::regrole::oid] AND p.polpermissive AND pg_get_expr(p.polqual,p.polrelid)='true' AND ((p.polname='cafe_metricool_owner_read' AND p.polcmd='r' AND p.polwithcheck IS NULL) OR (p.polname='cafe_metricool_owner_lock' AND p.polrelid='public.cs_character_promo_drafts'::regclass AND p.polcmd='w' AND pg_get_expr(p.polwithcheck,p.polrelid)='false')))) THEN RAISE EXCEPTION 'Unexpected added source policy'; END IF;
 IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid IN (SELECT oid FROM cm_tables WHERE oid<>'auth.users'::regclass) AND NOT t.tgisinternal AND NOT EXISTS(SELECT 1 FROM cm_triggers b WHERE b.oid=t.oid))<>3 OR EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid IN (SELECT oid FROM cm_tables WHERE oid<>'auth.users'::regclass) AND NOT t.tgisinternal AND NOT EXISTS(SELECT 1 FROM cm_triggers b WHERE b.oid=t.oid) AND NOT (t.tgname IN ('cafe_metricool_draft_guard','cafe_metricool_plan_guard','cafe_metricool_qa_guard') AND t.tgfoid=(SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='cafe_metricool_private' AND p.proname='guard_source' AND p.pronargs=0))) THEN RAISE EXCEPTION 'Unexpected added source trigger'; END IF;
 IF EXISTS(SELECT 1 FROM cm_functions b LEFT JOIN pg_proc p USING(oid) WHERE (b.proowner,b.definition) IS DISTINCT FROM (p.proowner,pg_get_functiondef(p.oid)) OR (b.oid NOT IN (SELECT oid FROM cm_helper) AND b.proacl IS DISTINCT FROM p.proacl)) THEN RAISE EXCEPTION 'Prior public functions changed'; END IF;
 IF EXISTS((SELECT * FROM cm_members UNION ALL SELECT * FROM cm_bootstrap EXCEPT SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members) UNION ALL (SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members EXCEPT (SELECT * FROM cm_members UNION ALL SELECT * FROM cm_bootstrap))) THEN RAISE EXCEPTION 'Membership restoration mismatch'; END IF;
 IF pg_has_role(current_user,'cafe_metricool_owner','SET') OR has_schema_privilege('cafe_metricool_owner','auth','USAGE') OR has_schema_privilege('cafe_metricool_owner','public','CREATE') OR has_database_privilege('cafe_metricool_owner',current_database(),'CREATE') OR has_table_privilege('cafe_metricool_owner','auth.users','SELECT') THEN RAISE EXCEPTION 'Temporary authority leaked'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.cs_cafe_metricool_is_admin(uuid)'::regprocedure AND proowner=current_user::regrole AND prosecdef AND prorettype='boolean'::regtype AND proconfig=ARRAY['search_path=pg_catalog']) OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.cs_cafe_metricool_is_admin(uuid)'::regprocedure AND (a.grantee NOT IN (current_user::regrole,'cafe_metricool_owner'::regrole) AND NOT (EXISTS(SELECT 1 FROM cm_helper) AND a.grantee=to_regrole('character_production_owner')) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN RAISE EXCEPTION 'Admin helper must expose only fixed boolean to exact owner'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE (pronamespace='cafe_metricool_private'::regnamespace OR (pronamespace='public'::regnamespace AND proname IN ('cs_preflight_cafe_metricool','cs_claim_cafe_metricool','cs_identity_cafe_metricool','cs_finish_cafe_metricool'))) AND proowner<>'cafe_metricool_owner'::regrole) THEN RAISE EXCEPTION 'Wrong store function owner'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='cafe_metricool_private' AND nspowner=new_owner) OR EXISTS(WITH actual AS (SELECT a.* FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='cafe_metricool_private'), expected AS (SELECT * FROM aclexplode(acldefault('n',new_owner))) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'New private schema ACL mismatch'; END IF;
 FOR new_object IN SELECT * FROM pg_class WHERE relnamespace='cafe_metricool_private'::regnamespace AND relkind='r' LOOP
 IF new_object.relowner<>new_owner OR new_object.relrowsecurity OR new_object.relforcerowsecurity OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=new_object.oid) OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=new_object.oid AND attacl IS NOT NULL) THEN RAISE EXCEPTION 'New private table owner/RLS mismatch'; END IF;
 IF EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(new_object.relacl,acldefault('r',new_owner)))), expected AS (SELECT * FROM aclexplode(acldefault('r',new_owner))) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'New private table ACL mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_class WHERE relnamespace='cafe_metricool_private'::regnamespace AND relkind='r')<>3 THEN RAISE EXCEPTION 'New private table count mismatch'; END IF;
 FOR new_object IN SELECT * FROM pg_proc WHERE pronamespace='cafe_metricool_private'::regnamespace OR (pronamespace='public'::regnamespace AND proname IN ('cs_preflight_cafe_metricool','cs_claim_cafe_metricool','cs_identity_cafe_metricool','cs_finish_cafe_metricool')) LOOP
 IF new_object.proowner<>new_owner OR EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(new_object.proacl,acldefault('f',new_owner)))), expected AS (SELECT new_owner grantor,new_owner grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'New private function ACL mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='cafe_metricool_private'::regnamespace OR (pronamespace='public'::regnamespace AND proname IN ('cs_preflight_cafe_metricool','cs_claim_cafe_metricool','cs_identity_cafe_metricool','cs_finish_cafe_metricool')))<>7 THEN RAISE EXCEPTION 'New private function count mismatch'; END IF;
 IF EXISTS(WITH actual AS (SELECT a.* FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.cs_cafe_metricool_is_admin(uuid)'::regprocedure), expected AS (SELECT current_user::regrole::oid grantor,current_user::regrole::oid grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT current_user::regrole::oid,new_owner,'EXECUTE',false UNION ALL SELECT current_user::regrole::oid,to_regrole('character_production_owner')::oid,'EXECUTE',false WHERE EXISTS(SELECT 1 FROM cm_helper)) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'New boolean helper ACL mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cafe_metricool_owner' AND (rolcanlogin OR rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'Owner must remain inert'; END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
 IF has_schema_privilege(r,'cafe_metricool_private','USAGE') OR EXISTS(SELECT 1 FROM pg_proc WHERE (pronamespace='cafe_metricool_private'::regnamespace OR (pronamespace='public'::regnamespace AND proname IN ('cs_cafe_metricool_is_admin','cs_preflight_cafe_metricool','cs_claim_cafe_metricool','cs_identity_cafe_metricool','cs_finish_cafe_metricool'))) AND has_function_privilege(r,oid,'EXECUTE')) THEN RAISE EXCEPTION 'Runtime role gained access'; END IF;
 END LOOP;
END $$;
-- Installer cannot SET owner after cleanup; inspect through original ownership only
-- using SECURITY DEFINER readback below is intentionally avoided. Counts asserted before cleanup.
COMMIT;
'''
# Add final private state assertions while still owner.
checks="""\nDO $$ BEGIN IF EXISTS(SELECT 1 FROM cafe_metricool_private.approvals) OR EXISTS(SELECT 1 FROM cafe_metricool_private.attempts) OR (SELECT count(*) FROM cafe_metricool_private.external_receipts)<>22 THEN RAISE EXCEPTION 'Expected inert store and 22 negative receipts'; END IF; END $$;\n"""
print(pre+source+checks+post)

