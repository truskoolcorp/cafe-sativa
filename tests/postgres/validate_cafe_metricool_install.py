#!/usr/bin/env python3
"""Disposable PG17 production-like owner/RLS installation, no live apply."""
import os, pathlib, subprocess, json
import validate_cafe_metricool as m
ROOT=pathlib.Path(__file__).resolve().parents[2]
def snap():
 return m.run("SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY rolname) FROM pg_roles r WHERE rolname='cafe_metricool_owner'),'members',(SELECT jsonb_agg(to_jsonb(r) ORDER BY roleid,member,grantor) FROM pg_auth_members r),'classes',(SELECT jsonb_agg(jsonb_build_array(oid,relowner,relacl::text,relrowsecurity,relforcerowsecurity) ORDER BY oid) FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'auth'::regnamespace)),'columns',(SELECT jsonb_agg(jsonb_build_array(attrelid,attnum,attacl::text) ORDER BY attrelid,attnum) FROM pg_attribute WHERE attrelid IN (SELECT oid FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'auth'::regnamespace))),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_policy p),'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY oid) FROM pg_trigger t),'schemas',(SELECT jsonb_agg(jsonb_build_array(oid,nspacl::text) ORDER BY oid) FROM pg_namespace WHERE nspname IN ('public','auth')),'functions',(SELECT jsonb_agg(jsonb_build_array(oid,proacl::text,proowner,pg_get_functiondef(oid)) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f'))")
def fixture(name):
 original=m.owner;m.owner=m.run
 try:return m.fixture(name)
 finally:m.owner=original

def suite():
 assert os.environ.get('PG_DISPOSABLE_TEST_CONFIRM')=='yes' and os.environ.get('PGHOST') in ['127.0.0.1','localhost','::1'] and os.environ.get('PGDATABASE')=='character_ci_metricool'
 m.check("current_setting('server_version_num')::int BETWEEN 170000 AND 179999",'PG17')
 m.run('CREATE ROLE metricool_installer NOLOGIN NOSUPERUSER NOINHERIT CREATEROLE CREATEDB; CREATE DATABASE character_ci_metricool_install OWNER metricool_installer;')
 os.environ['PGDATABASE']='character_ci_metricool_install'
 prefix='SET SESSION AUTHORIZATION metricool_installer; '
 m.run(prefix+"CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb); CREATE TABLE public.cs_character_promo_drafts(id uuid PRIMARY KEY,character_id text,actual_social_account text,status text,video_asset_path text,voice_approved_at timestamptz,video_qa_approved_at timestamptz,publication_approved_at timestamptz); CREATE TABLE public.cs_character_promo_delivery_plans(id uuid PRIMARY KEY,promo_id uuid REFERENCES public.cs_character_promo_drafts,character_id text,network text,account_id text,status text,caption text,scheduled_at timestamptz); CREATE TABLE public.cs_character_promo_qa_checks(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,promo_id uuid,video_sha256 text,check_name text,result text,reviewer_id uuid,evidence text,created_at timestamptz);")
 m.run("CREATE ROLE metricool_auth_owner NOLOGIN NOSUPERUSER; ALTER SCHEMA auth OWNER TO metricool_auth_owner; ALTER TABLE auth.users OWNER TO metricool_auth_owner; ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA auth TO metricool_installer; GRANT SELECT(id,raw_app_meta_data) ON auth.users TO metricool_installer; CREATE POLICY fixture_installer_lookup ON auth.users FOR SELECT TO metricool_installer USING(true);")
 for t in ['cs_character_promo_drafts','cs_character_promo_delivery_plans','cs_character_promo_qa_checks']:
  m.run(prefix+f"ALTER TABLE public.{t} ENABLE ROW LEVEL SECURITY; CREATE POLICY existing_deny ON public.{t} FOR ALL TO authenticated USING(false) WITH CHECK(false);")
 m.run(prefix+"CREATE FUNCTION public.existing_legacy_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER existing_legacy_guard BEFORE UPDATE ON public.cs_character_promo_drafts FOR EACH ROW EXECUTE FUNCTION public.existing_legacy_guard();")
 source=(ROOT/'docs/proposals/cafe-metricool-install.sql').read_text()
 generated=subprocess.check_output(['python3','scripts/prepare-cafe-metricool-install.py'],cwd=ROOT,text=True)
 assert generated==source,'committed wrapper must equal exact generator'
 source=source.replace("'postgres'","'metricool_installer'").replace('TO postgres WITH','TO metricool_installer WITH').replace('BY postgres;','BY metricool_installer;').replace('FROM postgres GRANTED','FROM metricool_installer GRANTED')
 before=snap()
 m.run(prefix+source.replace('\nCOMMIT;','\nROLLBACK;'))
 assert snap()==before,'full rollback preserves role/ACL/policy/trigger/functions'
 broken=source.replace('\nCOMMIT;',"\nDO $$ BEGIN RAISE EXCEPTION 'injected install abort'; END $$; COMMIT;")
 p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=prefix+broken,text=True,capture_output=True,timeout=40)
 m.LOG.append(p.stdout+p.stderr);assert p.returncode and 'injected install abort' in p.stderr
 assert snap()==before,'injected abort restores exact source and privileges'
 # Unknown default ACL grantees and PUBLIC permissive write policies fail closed.
 m.run('CREATE ROLE metricool_unexpected NOLOGIN;')
 defaults=m.run("SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY oid),'[]'::jsonb) FROM pg_default_acl d")
 for altered in [
  source.replace('CREATE FUNCTION public.cs_cafe_metricool_is_admin', 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO metricool_unexpected; CREATE FUNCTION public.cs_cafe_metricool_is_admin'),
  source.replace('SET LOCAL ROLE cafe_metricool_owner;', 'SET LOCAL ROLE cafe_metricool_owner; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO metricool_unexpected;'),
  source.replace('CREATE SCHEMA cafe_metricool_private;', 'CREATE SCHEMA cafe_metricool_private; ALTER DEFAULT PRIVILEGES IN SCHEMA cafe_metricool_private GRANT SELECT ON TABLES TO metricool_unexpected;'),
 ]:
  p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=prefix+altered,text=True,capture_output=True,timeout=40)
  assert p.returncode and ('ACL mismatch' in p.stderr or 'Admin helper must expose' in p.stderr),p.stderr
  assert snap()==before,'unknown default grant rollback'
  assert m.run("SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY oid),'[]'::jsonb) FROM pg_default_acl d")==defaults
 p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=prefix+"BEGIN; CREATE POLICY unexpected_public_write ON public.cs_character_promo_drafts FOR UPDATE TO PUBLIC USING(true) WITH CHECK(true); "+source,text=True,capture_output=True,timeout=40)
 assert p.returncode and 'PUBLIC write policy' in p.stderr,p.stderr
 assert snap()==before,'PUBLIC policy rollback'
 # Original absent-helper path has passed rollback and all fail-closed controls above.
 # Install the exact existing production bridge (OID intentionally allocated by this DB).
 m.run("CREATE ROLE character_production_owner NOLOGIN NOSUPERUSER;")
 bridge="""CREATE FUNCTION public.cs_cafe_metricool_is_admin(p_actor uuid)
 RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $function$
 SELECT EXISTS(SELECT 1 FROM auth.users u
 WHERE u.id=p_actor AND u.raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb)
$function$;
 REVOKE ALL ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) TO character_production_owner;"""
 m.run(prefix+bridge)
 bridge_before=m.run("SELECT jsonb_build_array(oid,pg_get_functiondef(oid),proowner,provolatile,proisstrict,proconfig) FROM pg_proc WHERE oid='public.cs_cafe_metricool_is_admin(uuid)'::regprocedure")
 before=snap()
 m.run(prefix+source.replace('\nCOMMIT;','\nROLLBACK;'))
 assert snap()==before,'recognized bridge rollback preserves exact OID/body/ACL'
 for label,mutation in [
  ('body',"CREATE OR REPLACE FUNCTION public.cs_cafe_metricool_is_admin(p_actor uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT true $$;"),
  ('volatility','ALTER FUNCTION public.cs_cafe_metricool_is_admin(uuid) STABLE;'),
  ('security','ALTER FUNCTION public.cs_cafe_metricool_is_admin(uuid) SECURITY INVOKER;'),
  ('searchpath',"ALTER FUNCTION public.cs_cafe_metricool_is_admin(uuid) SET search_path=public;"),
  ('extra ACL','GRANT EXECUTE ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) TO service_role;'),
  ('lost old grant','REVOKE EXECUTE ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) FROM character_production_owner;'),
  ('grant option','GRANT EXECUTE ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) TO character_production_owner WITH GRANT OPTION;'),
 ]:
  p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=prefix+'BEGIN; '+mutation+source,text=True,capture_output=True,timeout=40)
  m.LOG.append(label+': '+p.stdout+p.stderr)
  assert p.returncode and 'Unknown existing admin bridge' in p.stderr,(label,p.stderr)
  assert snap()==before,label+' must rollback exactly'
 m.run(prefix+source)
 assert m.run("SELECT jsonb_build_array(oid,pg_get_functiondef(oid),proowner,provolatile,proisstrict,proconfig) FROM pg_proc WHERE oid='public.cs_cafe_metricool_is_admin(uuid)'::regprocedure")==bridge_before,'existing bridge identity/body/flags preserved'
 m.check("has_function_privilege('character_production_owner','public.cs_cafe_metricool_is_admin(uuid)','EXECUTE')",'existing production grant retained')
 m.check("NOT pg_has_role('metricool_installer','cafe_metricool_owner','SET')",'installer cannot retain SET')
 m.check("(SELECT count(*)=1 FROM pg_auth_members WHERE roleid='cafe_metricool_owner'::regrole AND member='metricool_installer'::regrole AND grantor='postgres'::regrole AND admin_option AND NOT set_option AND NOT inherit_option)",'only original PG17 admin-only bootstrap')
 m.check("NOT has_schema_privilege('cafe_metricool_owner','public','CREATE') AND NOT has_schema_privilege('cafe_metricool_owner','auth','USAGE') AND NOT has_table_privilege('cafe_metricool_owner','auth.users','SELECT')",'no create or raw auth access')
 # Actual auth-data denial under the inert owner, not just ACL metadata.
 p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input='SET ROLE cafe_metricool_owner; SELECT raw_app_meta_data FROM auth.users;',text=True,capture_output=True,timeout=30)
 assert p.returncode and 'permission denied' in p.stderr
 m.run(f"INSERT INTO auth.users VALUES({m.q(m.ADMIN)},'{{\"cafe_sativa_admin\":true}}');")
 m.owner=lambda sql:m.run('SET ROLE cafe_metricool_owner; '+sql)
 assert m.owner(f"SELECT public.cs_cafe_metricool_is_admin({m.q(m.ADMIN)});")=='t'
 assert m.owner("SELECT public.cs_cafe_metricool_is_admin(NULL);")=='f'
 m.check("(SELECT count(*)=0 FROM cafe_metricool_private.approvals) AND (SELECT count(*)=0 FROM cafe_metricool_private.attempts)",'installation inert')
 m.check("NOT has_column_privilege('metricool_installer','auth.users','id','REFERENCES WITH GRANT OPTION') AND NOT has_schema_privilege('metricool_installer','auth','USAGE WITH GRANT OPTION')",'production-like no grantable auth rights')
 from validate_cafe_authority_install import validate
 validate(prefix,snap)
 f=fixture('rls-owner')
 m.run('BEGIN; UPDATE cafe_metricool_private.approvals SET approved_by='+m.q(m.uid('absent-admin'))+' WHERE plan_id='+m.q(f[0])+"; DO $$ BEGIN IF public.cs_preflight_cafe_metricool("+m.q(f[0])+','+m.q(f[2])+") THEN RAISE EXCEPTION 'missing actor accepted'; END IF; END $$; ROLLBACK;")
 assert m.owner('SELECT public.cs_preflight_cafe_metricool('+m.q(f[0])+','+m.q(f[2])+');')=='t','owner can read final authority under RLS'
 assert m.owner('SELECT id FROM public.cs_character_promo_drafts WHERE id='+m.q(f[1])+' FOR UPDATE;')==f[1],'RLS must expose exact parent row to FOR UPDATE'
 for assignment in ['id=id',"id='11111111-1111-4111-8111-111111111111'", "status='forbidden'"]:
  p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input='SET ROLE cafe_metricool_owner; UPDATE public.cs_character_promo_drafts SET '+assignment+' WHERE id='+m.q(f[1])+';',text=True,capture_output=True,timeout=30)
  assert p.returncode and ('row-level security' in p.stderr or 'permission denied' in p.stderr),p.stdout+p.stderr
 m.check("(SELECT relowner='metricool_auth_owner'::regrole FROM pg_class WHERE oid='auth.users'::regclass)",'auth owner preserved')
 token=m.owner('SELECT '+m.call(f)+';');assert token,'SELECT FOR UPDATE must work with narrow RLS rights'
 m.check("has_column_privilege('cafe_metricool_owner','public.cs_character_promo_drafts','id','UPDATE') AND NOT has_column_privilege('cafe_metricool_owner','public.cs_character_promo_drafts','status','UPDATE')",'only id locking column')
 # Independent plans with a shared exact reservation key, actual distinct transactions.
 rows=[]
 for i in range(3):
  z=fixture('rls-lock-'+str(i));m.run("UPDATE cafe_metricool_private.approvals SET destination_time_key="+m.q(m.h('rls-shared'))+" WHERE plan_id="+m.q(z[0])+";");rows.append((*z[:4],m.h('rls-shared'),z[5]))
 m.concurrent_claims(rows)
 # A source UPDATE fires the new guard under owner RLS, preserving legacy guard.
 p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=prefix+f"UPDATE public.cs_character_promo_drafts SET status='bad' WHERE id={m.q(f[1])};",text=True,capture_output=True,timeout=30)
 assert p.returncode and 'claimed source frozen' in p.stderr,p.stdout+p.stderr
 for role in ['anon','authenticated','service_role']:
  m.check(f"NOT has_function_privilege({m.q(role)},'public.cs_cafe_metricool_is_admin(uuid)','EXECUTE') AND NOT has_function_privilege({m.q(role)},'public.cs_claim_cafe_metricool(uuid,text,text,text)','EXECUTE')",'no runtime role authority')
 m.LOG.append('PASS: inert Metricool non-superuser RLS installer, exact rollback and locks');print(m.LOG[-1])
if __name__=='__main__':
 try:suite()
 finally:(ROOT/'evidence').mkdir(exist_ok=True);(ROOT/'evidence/postgres-cafe-metricool-install-validation.log').write_text('\n'.join(m.LOG))

