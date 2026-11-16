#!/usr/bin/env python3
"""Apply exact offline bundle as NON-superuser CREATEROLE in fresh disposable DB."""
import os,subprocess
os.environ['PG_TEST_SERVER']='1'
import validate_ledger as db

def suite():
 db.command()
 db.run('CREATE ROLE provision_installer NOLOGIN NOSUPERUSER CREATEROLE CREATEDB; CREATE DATABASE character_ci_provision OWNER provision_installer;')
 os.environ['PGDATABASE']='character_ci_provision'
 source=subprocess.check_output(['node','--input-type=module','-e',"import {readFileSync} from 'node:fs';import {prepareProvisioning} from './scripts/prepare-character-provisioning.mjs';process.stdout.write(prepareProvisioning(n=>readFileSync('docs/proposals/'+n,'utf8')).sql)"],cwd=db.ROOT,text=True)
 prefix='SET SESSION AUTHORIZATION provision_installer; '
 db.run(prefix+source.replace('\nCOMMIT;','\nROLLBACK;'))
 db.check("to_regnamespace('character_production') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname LIKE 'character_production_%')",'full rollback')
 db.run(prefix+source)
 owner='character_production_owner';gen='character_production_generator';broker='character_production_output_broker'
 expected={gen:['authorization(text,text)','claim(jsonb,text)','submitted(text,text,text,text)','unknown(text,text,text)','pending(text,text,integer)','failed(jsonb)','due(text,text,integer)'],broker:['output_status(jsonb,text,bigint)','output(jsonb,text,bigint)','broker_authorized(jsonb)']}
 for role,signatures in expected.items():
  for signature in signatures:db.check("has_function_privilege("+db.quote(role)+","+db.quote('public.character_production_'+signature)+",'EXECUTE')",'allowed function '+signature)
  allowed=','.join(db.quote('character_production_'+s.split('(')[0]) for s in signatures)
  db.check("NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='character_production' OR (n.nspname='public' AND p.proname LIKE 'character_production_%')) AND p.proname NOT IN ("+allowed+") AND has_function_privilege("+db.quote(role)+",p.oid,'EXECUTE'))",'no extra EXECUTE')
  db.check("NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relkind='r' AND has_table_privilege("+db.quote(role)+",c.oid,'SELECT,INSERT,UPDATE,DELETE'))",'no direct table grants')
  db.check("NOT has_schema_privilege("+db.quote(role)+",'character_production','USAGE')",'no private schema usage')
 for role in ['anon','authenticated','service_role']:
  db.check("NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'character_production_%' AND has_function_privilege("+db.quote(role)+",p.oid,'EXECUTE'))",'no ordinary app rights')
 # PG17 bootstrap grant is ADMIN-only; creator self-SET grant must be removed.
 db.check("(SELECT count(*)=3 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname LIKE 'character_production_%' AND m.member='provision_installer'::regrole AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)",'exact admin-only edges')
 db.check("NOT pg_has_role('provision_installer','character_production_owner','SET')",'installer cannot SET owner after cleanup')
 db.check("NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname LIKE 'character_production_%' AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication))",'roles inert')
 # Negative actual invocations, not just ACL metadata.
 for role,sql in [(gen,'SELECT public.character_production_output(NULL,NULL,NULL)'),(broker,'SELECT public.character_production_claim(NULL,NULL)'),(gen,'SELECT * FROM character_production.jobs')]:
  db.run("DO $$ BEGIN SET LOCAL ROLE "+role+"; BEGIN "+sql+"; RAISE EXCEPTION 'unexpected permission'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; RESET ROLE; END $$;")
 db.check("to_regclass('character_production.qa_targets') IS NULL",'QA excluded')
 # Reapplication refuses existing roles/schema; transaction rollback keeps existing evidence.
 p=subprocess.run(db.command(),input=prefix+source,text=True,capture_output=True)
 assert p.returncode!=0 and 'reconcile first' in p.stderr
 db.finish('provisioning')
if __name__=='__main__':suite()
