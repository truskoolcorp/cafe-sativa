#!/usr/bin/env python3
"""Disposable PG17 exact installer validation. No live connection or activation."""
import subprocess
import validate_ledger as db
import validate_qa_install as qa
import validate_qa_recurring_install as recurring

def auth_snapshot():
 return db.run("SELECT jsonb_build_object('defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d),'ns',(SELECT jsonb_build_array(nspowner,nspacl::text) FROM pg_namespace WHERE nspname='auth'),'table',(SELECT jsonb_build_array(relowner,relacl::text,relrowsecurity,relforcerowsecurity) FROM pg_class WHERE oid='auth.users'::regclass),'columns',(SELECT jsonb_agg(jsonb_build_array(attnum,attacl::text) ORDER BY attnum) FROM pg_attribute WHERE attrelid='auth.users'::regclass),'rows',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM auth.users u))")

def suite():
 recurring.suite()
 source=(db.ROOT/'docs/proposals/character-production-planner-install.sql').read_text()
 assert source==subprocess.check_output(['python3','scripts/prepare-planner-install.py'],cwd=db.ROOT,text=True)
 sql=qa.adapt(source);prefix='SET SESSION AUTHORIZATION provision_installer; '
 before=qa.snapshot()
 p=subprocess.run(db.command(),input=prefix+sql,text=True,capture_output=True)
 assert p.returncode and 'prerequisites required' in p.stderr,p.stderr
 assert before==qa.snapshot()
 # Install actual reviewed wallet guard, not a function-name test double.
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; '+(db.ROOT/'docs/proposals/character-production-receipt-evidence.sql').read_text())
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner;')
 budget=(db.ROOT/'docs/proposals/character-production-heygen-budget-install.sql').read_text()
 assert budget==subprocess.check_output(['python3','scripts/prepare-heygen-budget-install.py'],cwd=db.ROOT,text=True)
 db.run(prefix+qa.adapt(budget))
 # Actual source-owned bridge installer with distinct synthetic auth owner.
 # Only the identities/data are synthetic, never the permission predicate.
 db.check("to_regnamespace('auth') IS NULL",'fresh auth fixture required')
 db.run("CREATE ROLE auth_planner_test_owner NOLOGIN NOSUPERUSER; CREATE SCHEMA auth AUTHORIZATION auth_planner_test_owner; SET ROLE auth_planner_test_owner; CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb,raw_user_meta_data jsonb); RESET ROLE; GRANT USAGE ON SCHEMA auth TO provision_installer; GRANT SELECT(id,raw_app_meta_data) ON auth.users TO provision_installer; INSERT INTO auth.users VALUES('88888888-8888-4888-8888-888888888888','{\"cafe_sativa_admin\":true}','{}'),('88888888-8888-4888-8888-888888888889','{}','{\"cafe_sativa_admin\":true}');")
 db.run('ALTER DEFAULT PRIVILEGES FOR ROLE provision_installer IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role,character_production_generator,character_production_output_broker; ALTER DEFAULT PRIVILEGES FOR ROLE provision_installer IN SCHEMA public GRANT USAGE ON SEQUENCES TO anon;')
 auth_before=auth_snapshot()
 admin=(db.ROOT/'docs/proposals/character-production-admin-bridge-install.sql').read_text()
 assert admin==subprocess.check_output(['python3','scripts/prepare-planner-admin-install.py'],cwd=db.ROOT,text=True)
 db.run(prefix+qa.adapt(admin))
 assert auth_snapshot()==auth_before,'bridge must preserve auth rows/authority'
 db.run("SET SESSION AUTHORIZATION character_production_owner; DO $$ BEGIN IF NOT public.cs_cafe_metricool_is_admin('88888888-8888-4888-8888-888888888888') OR public.cs_cafe_metricool_is_admin('88888888-8888-4888-8888-888888888889') THEN RAISE EXCEPTION 'genuine admin predicate mismatch'; END IF; END $$;")
 db.check("NOT has_schema_privilege('character_production_owner','auth','USAGE') AND NOT has_column_privilege('character_production_owner','auth.users','id','SELECT') AND NOT has_column_privilege('character_production_owner','auth.users','raw_app_meta_data','SELECT')",'bridge grants no direct identity access')
 before=qa.snapshot()
 db.run(prefix+sql.replace('\nCOMMIT;','\nROLLBACK;'));assert qa.snapshot()==before
 for broken,label in [
  (sql.replace('\nCOMMIT;',"\nDO $$ BEGIN RAISE EXCEPTION 'injected abort'; END $$; COMMIT;"),'injected abort'),
  (sql.replace(" IF EXISTS(SELECT 1 FROM character_production.planning_policies)"," UPDATE character_production.budgets SET reserved_cents=reserved_cents+1;\n IF EXISTS(SELECT 1 FROM character_production.planning_policies)"),'Ledger data changed'),
  (sql.replace('RETURNS jsonb LANGUAGE sql SECURITY DEFINER','RETURNS jsonb LANGUAGE sql SECURITY INVOKER'),'function identity mismatch'),
 ]:
  p=subprocess.run(db.command(),input=prefix+broken,text=True,capture_output=True)
  assert p.returncode and label in p.stderr,p.stderr
  assert qa.snapshot()==before,label
 db.run('CREATE ROLE planner_unexpected NOLOGIN;')
 for namespace,kind,right in [('public','FUNCTIONS','EXECUTE'),('character_production','TABLES','SELECT')]:
  setup='ALTER DEFAULT PRIVILEGES FOR ROLE character_production_owner IN SCHEMA '+namespace+' GRANT '+right+' ON '+kind+' TO planner_unexpected; '
  p=subprocess.run(db.command(),input='BEGIN; '+setup+prefix+sql,text=True,capture_output=True)
  assert p.returncode and 'ACL mismatch' in p.stderr,p.stderr
  assert qa.snapshot()==before
 db.run(prefix+sql)
 db.check("NOT pg_has_role('provision_installer','character_production_owner','SET') AND NOT has_schema_privilege('character_production_owner','public','CREATE')",'temporary authority removed')
 for name in ['planning_policies','planning_records','heygen_wallet_policy','heygen_wallet_evidence','heygen_slot_evidence']:
  db.check('(SELECT count(*)=0 FROM character_production.'+name+')','no enrollment or spend')
 for role in ['anon','authenticated','service_role','character_production_generator','character_production_output_broker']:
  for sig in ['character_production_plan(jsonb,text,jsonb,uuid,bigint,uuid)','character_production_planning_policy(uuid)','character_production_planned_draft(uuid,jsonb,text,text)','character_production_new_blank_draft(uuid,jsonb,text,text)']:
   db.check('NOT has_function_privilege('+db.quote(role)+','+db.quote('public.'+sig)+",'EXECUTE')",'no runtime planner grants')
 db.check("(SELECT cap_cents=40 AND reserved_cents=35 FROM character_production.budgets WHERE provider='heygen' AND period='2026-11')",'original budget untouched')
 assert auth_snapshot()==auth_before,'chained installer preserved auth rows/authority'
 db.finish('planner-install')
if __name__=='__main__':suite()
