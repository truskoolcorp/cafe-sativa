#!/usr/bin/env python3
"""Fresh disposable PG17, real metadata semantics with synthetic identities."""
import os,subprocess,json
os.environ['PG_TEST_SERVER']='1'
import validate_ledger as db
import validate_qa_install as helper

def snapshot():
 return db.run("SELECT jsonb_build_object('defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d),'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM auth.users u),'funcs',(SELECT jsonb_agg(jsonb_build_array(oid,proowner,proacl::text,pg_get_functiondef(oid)) ORDER BY oid) FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'auth'::regnamespace) AND prokind='f'),'acl',(SELECT jsonb_agg(jsonb_build_array(oid,relowner,relacl::text,relrowsecurity,relforcerowsecurity) ORDER BY oid) FROM pg_class WHERE relnamespace='auth'::regnamespace),'cols',(SELECT jsonb_agg(jsonb_build_array(attrelid,attnum,attacl::text) ORDER BY attrelid,attnum) FROM pg_attribute WHERE attrelid='auth.users'::regclass))")
def suite():
 db.command();db.check("current_setting('server_version_num')::int BETWEEN 170000 AND 179999 AND to_regnamespace('auth') IS NULL",'fresh PG17 required')
 db.run("CREATE ROLE provision_installer NOLOGIN NOSUPERUSER; CREATE ROLE auth_test_owner NOLOGIN NOSUPERUSER; CREATE ROLE character_production_owner NOLOGIN NOINHERIT; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE character_production_generator; CREATE ROLE character_production_output_broker; CREATE ROLE bridge_unexpected; CREATE SCHEMA auth AUTHORIZATION auth_test_owner; SET ROLE auth_test_owner; CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb,raw_user_meta_data jsonb); RESET ROLE; GRANT CREATE ON SCHEMA public TO provision_installer; SET ROLE provision_installer; CREATE TABLE public.cs_character_promo_drafts(id uuid); RESET ROLE; GRANT USAGE ON SCHEMA auth TO provision_installer; GRANT SELECT(id,raw_app_meta_data) ON auth.users TO provision_installer;")
 db.run('ALTER DEFAULT PRIVILEGES FOR ROLE provision_installer IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role,character_production_generator,character_production_output_broker; ALTER DEFAULT PRIVILEGES FOR ROLE provision_installer IN SCHEMA public GRANT USAGE ON SEQUENCES TO anon;')
 sql=(db.ROOT/'docs/proposals/character-production-admin-bridge-install.sql').read_text()
 assert sql==subprocess.check_output(['python3','scripts/prepare-planner-admin-install.py'],cwd=db.ROOT,text=True)
 sql=helper.adapt(sql);prefix='SET SESSION AUTHORIZATION provision_installer; '
 before=snapshot();db.run(prefix+sql.replace('\nCOMMIT;','\nROLLBACK;'));assert snapshot()==before
 for broken,label in [(sql.replace('\nCOMMIT;',"\nDO $$ BEGIN RAISE EXCEPTION 'injected'; END $$; COMMIT;"),'injected'),(sql.replace('VOLATILE SECURITY DEFINER','STABLE SECURITY DEFINER'),'identity mismatch')]:
  p=subprocess.run(db.command(),input=prefix+broken,text=True,capture_output=True);assert p.returncode and label in p.stderr,p.stderr;assert snapshot()==before
 p=subprocess.run(db.command(),input='BEGIN; ALTER DEFAULT PRIVILEGES FOR ROLE provision_installer IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO bridge_unexpected; '+prefix+sql,text=True,capture_output=True)
 assert p.returncode and 'ACL mismatch' in p.stderr,p.stderr;assert snapshot()==before
 db.run(prefix+sql)
 for r in ['anon','authenticated','service_role','character_production_generator','character_production_output_broker']:
  db.check('NOT has_function_privilege('+db.quote(r)+",'public.cs_cafe_metricool_is_admin(uuid)','EXECUTE')",'no ordinary execution')
 db.check("NOT has_schema_privilege('character_production_owner','auth','USAGE') AND NOT has_table_privilege('character_production_owner','auth.users','SELECT')",'no identity access granted')
 examples=[({'cafe_sativa_admin':True},{},True),({'cafe_sativa_admin':False},{},False),({'cafe_sativa_admin':'true'},{},False),({}, {'cafe_sativa_admin':True},False),(None,{},False)]
 for n,(app,user,want) in enumerate(examples,1):
  actor=f'99999999-9999-4999-8999-{n:012d}'
  db.run('INSERT INTO auth.users VALUES('+db.quote(actor)+','+db.quote(json.dumps(app))+'::jsonb,'+db.quote(json.dumps(user))+'::jsonb);')
  assert db.run('SET SESSION AUTHORIZATION character_production_owner; SELECT public.cs_cafe_metricool_is_admin('+db.quote(actor)+');')==('t' if want else 'f')
 assert db.run("SET SESSION AUTHORIZATION character_production_owner; SELECT public.cs_cafe_metricool_is_admin(NULL);")=='f'
 assert db.run("SET SESSION AUTHORIZATION character_production_owner; SELECT public.cs_cafe_metricool_is_admin('00000000-0000-4000-8000-000000000000');")=='f'
 db.run("UPDATE auth.users SET raw_app_meta_data='{}' WHERE id='99999999-9999-4999-8999-000000000001';")
 assert db.run("SET SESSION AUTHORIZATION character_production_owner; SELECT public.cs_cafe_metricool_is_admin('99999999-9999-4999-8999-000000000001');")=='f'
 db.finish('planner-admin-install')
if __name__=='__main__':suite()
