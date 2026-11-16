#!/usr/bin/env python3
"""Disposable exact scheduler installer; no runtime grant or enrollment."""
import subprocess
import validate_ledger as db
import validate_qa_install as qa
import validate_planner_install as foundation

def snapshot():return (qa.snapshot(),foundation.auth_snapshot())
def suite():
 foundation.suite()
 source=(db.ROOT/'docs/proposals/character-production-scheduler-principal-install.sql').read_text()
 assert source==subprocess.check_output(['python3','scripts/prepare-scheduler-principal-install.py'],cwd=db.ROOT,text=True)
 sql=qa.adapt(source);prefix='SET SESSION AUTHORIZATION provision_installer; '
 before=snapshot()
 db.run(prefix+sql.replace('\nCOMMIT;','\nROLLBACK;'));assert snapshot()==before
 for broken,label in [
  (sql.replace('\nCOMMIT;',"\nDO $$ BEGIN RAISE EXCEPTION 'injected abort'; END $$; COMMIT;"),'injected abort'),
  (sql.replace('RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER','RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER'),'identity mismatch'),
  (sql.replace(' IF EXISTS(SELECT 1 FROM character_production.scheduler_enrollments)'," UPDATE character_production.budgets SET reserved_cents=reserved_cents+1;\n IF EXISTS(SELECT 1 FROM character_production.scheduler_enrollments)"),'Ledger data changed'),
 ]:
  p=subprocess.run(db.command(),input=prefix+broken,text=True,capture_output=True)
  assert p.returncode and label in p.stderr,p.stderr
  assert snapshot()==before
 db.run('CREATE ROLE scheduler_unexpected NOLOGIN;')
 for schema,kind,right in [('public','FUNCTIONS','EXECUTE'),('character_production','TABLES','SELECT')]:
  setup='ALTER DEFAULT PRIVILEGES FOR ROLE character_production_owner IN SCHEMA '+schema+' GRANT '+right+' ON '+kind+' TO scheduler_unexpected; '
  p=subprocess.run(db.command(),input='BEGIN; '+setup+prefix+sql,text=True,capture_output=True)
  assert p.returncode and 'ACL mismatch' in p.stderr,p.stderr
  assert snapshot()==before
 auth_before=foundation.auth_snapshot()
 db.run(prefix+sql)
 assert foundation.auth_snapshot()==auth_before
 db.check("NOT pg_has_role('provision_installer','character_production_owner','SET') AND NOT has_schema_privilege('character_production_owner','public','CREATE')",'temporary authority removed')
 for table in ['scheduler_enrollments','scheduler_candidates','scheduler_binding']:
  db.check('(SELECT count(*)=0 FROM character_production.'+table+')','empty scheduler')
 for role in ['anon','authenticated','service_role','character_production_generator','character_production_output_broker']:
  for sig in ['character_production_scheduler_context(uuid)','character_production_scheduler_reconciled(uuid,integer)','character_production_scheduler_plan(uuid,integer,jsonb)']:
   db.check('NOT has_function_privilege('+db.quote(role)+','+db.quote('public.'+sig)+",'EXECUTE')",'no runtime grants')
 p=subprocess.run(db.command(),input=prefix+sql,text=True,capture_output=True)
 assert p.returncode and 'already exists' in p.stderr,p.stderr
 db.finish('scheduler-principal-install')
if __name__=='__main__':suite()
