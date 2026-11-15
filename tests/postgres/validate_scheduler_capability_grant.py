#!/usr/bin/env python3
"""Disposable future capability delta. Never production activation."""
import subprocess,re
import validate_ledger as db
import validate_qa_install as qa
import validate_planner_install as planner
import validate_scheduler_principal_install as foundation

def suite():
 foundation.suite()
 source=(db.ROOT/'docs/proposals/character-production-scheduler-capability-grant.sql').read_text()
 assert source==subprocess.check_output(['python3','scripts/prepare-scheduler-capability-grant.py'],cwd=db.ROOT,text=True)
 sql=qa.adapt(source);prefix='SET SESSION AUTHORIZATION provision_installer; '
 before=(qa.snapshot(),planner.auth_snapshot())
 db.run(prefix+sql.replace('\nCOMMIT;','\nROLLBACK;'))
 assert before==(qa.snapshot(),planner.auth_snapshot())
 for broken,label in [(sql.replace('\nCOMMIT;',"\nDO $$ BEGIN RAISE EXCEPTION 'injected abort'; END $$; COMMIT;"),'injected abort'),(sql.replace('TO service_role;','TO authenticated;'),'result ACL mismatch')]:
  p=subprocess.run(db.command(),input=prefix+broken,text=True,capture_output=True)
  assert p.returncode and label in p.stderr,p.stderr
  assert before==(qa.snapshot(),planner.auth_snapshot())
 # Extra baseline privilege and function body drift must not be normalized.
 for setup,label in [("GRANT EXECUTE ON FUNCTION public.character_production_scheduler_context(uuid) TO anon;",'baseline ACL mismatch'),("ALTER FUNCTION public.character_production_scheduler_context(uuid) SECURITY INVOKER;",'identity/body mismatch')]:
  p=subprocess.run(db.command(),input='BEGIN; '+setup+prefix+sql,text=True,capture_output=True)
  assert p.returncode and label in p.stderr,p.stderr
  assert before==(qa.snapshot(),planner.auth_snapshot())
 p=subprocess.run(db.command(),input="BEGIN; ALTER FUNCTION character_production.scheduler_current(uuid) SECURITY INVOKER; "+prefix+sql,text=True,capture_output=True)
 assert p.returncode and 'dependency identity/body mismatch' in p.stderr,p.stderr
 assert before==(qa.snapshot(),planner.auth_snapshot())
 principal=(db.ROOT/'docs/proposals/character-production-scheduler-principal.sql').read_text()
 guard=re.search(r'CREATE FUNCTION character_production\.scheduler_current\([^;]+?AS \$\$.*?\$\$;',principal,re.S).group(0)
 guard=guard.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1).replace(' RETURN e;',' RETURN NULL;')
 p=subprocess.run(db.command(),input='BEGIN; '+guard+prefix+sql,text=True,capture_output=True)
 assert p.returncode and 'dependency identity/body mismatch' in p.stderr,p.stderr
 assert before==(qa.snapshot(),planner.auth_snapshot())
 auth_before=planner.auth_snapshot();db.run(prefix+sql);assert planner.auth_snapshot()==auth_before
 signatures=['character_production_scheduler_context(uuid)','character_production_scheduler_reconciled(uuid,integer)','character_production_scheduler_plan(uuid,integer,jsonb)']
 for sig in signatures:
  db.check("has_function_privilege('service_role',"+db.quote('public.'+sig)+",'EXECUTE')",'exact capability granted')
  for role in ['anon','authenticated','character_production_generator','character_production_output_broker']:
   db.check('NOT has_function_privilege('+db.quote(role)+','+db.quote('public.'+sig)+",'EXECUTE')",'no other runtime grant')
 for sig in ['character_production_plan(jsonb,text,jsonb,uuid,bigint,uuid)','character_production_planning_policy(uuid)','character_production_planned_draft(uuid,jsonb,text,text)','character_production_new_blank_draft(uuid,jsonb,text,text)']:
  db.check("NOT has_function_privilege('service_role',"+db.quote('public.'+sig)+",'EXECUTE')",'no raw planner/source grant')
 for table in ['scheduler_enrollments','scheduler_candidates','scheduler_binding']:
  db.check('(SELECT count(*)=0 FROM character_production.'+table+')','empty enrollment')
  for right in ['SELECT','INSERT','UPDATE','DELETE']:
   db.check("NOT has_table_privilege('service_role','character_production."+table+"','"+right+"')",'no table authority')
 db.run("SET ROLE service_role; DO $$ BEGIN IF public.character_production_scheduler_context('11111111-1111-4111-8111-111111111111') IS NOT NULL THEN RAISE EXCEPTION 'grant invented enrollment'; END IF; END $$;")
 p=subprocess.run(db.command(),input=prefix+sql,text=True,capture_output=True)
 assert p.returncode and 'baseline ACL mismatch' in p.stderr,p.stderr
 db.finish('scheduler-capability-grant')
if __name__=='__main__':suite()
