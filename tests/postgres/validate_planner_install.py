#!/usr/bin/env python3
"""Disposable PG17 exact installer validation. No live connection or activation."""
import subprocess
import validate_ledger as db
import validate_qa_install as qa
import validate_qa_recurring_install as recurring

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
 # Source admin bridge is an explicit synthetic fixture for this disposable DB.
 # The production installer requires the separately reviewed real bridge.
 db.run(prefix+"CREATE FUNCTION public.cs_cafe_metricool_is_admin(uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT false $$; REVOKE ALL ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) TO character_production_owner;")
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
 db.finish('planner-install')
if __name__=='__main__':suite()
