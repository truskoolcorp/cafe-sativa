#!/usr/bin/env python3
"""Disposable restricted-owner install; no runtime grant or real data."""
import subprocess
import validate_ledger as db
import validate_qa_install as qa
import validate_planner_install as foundation
import validate_scheduler_principal_install as principal

def snapshot():return (qa.snapshot(),foundation.auth_snapshot())
def suite():
 principal.suite()
 source=(db.ROOT/'docs/proposals/character-production-enrolled-reads-install.sql').read_text()
 assert source==subprocess.check_output(['python3','scripts/prepare-enrolled-reads-install.py'],cwd=db.ROOT,text=True)
 sql=qa.adapt(source);prefix='SET SESSION AUTHORIZATION provision_installer; '
 before=snapshot()
 db.run(prefix+sql.replace('\nCOMMIT;','\nROLLBACK;'));assert snapshot()==before
 for broken,label in [
  (sql.replace('\nCOMMIT;',"\nDO $$ BEGIN RAISE EXCEPTION 'injected abort'; END $$; COMMIT;"),'injected abort'),
  (sql.replace('RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER','RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER'),'identity mismatch'),
  (sql.replace(' CREATE TEMP TABLE si_rows_after'," UPDATE character_production.budgets SET reserved_cents=reserved_cents+1;\n CREATE TEMP TABLE si_rows_after"),'Ledger data changed'),
 ]:
  p=subprocess.run(db.command(),input=prefix+broken,text=True,capture_output=True)
  assert p.returncode and label in p.stderr,p.stderr
  assert snapshot()==before
 for setup,label in [
  ('GRANT CREATE ON SCHEMA public TO character_production_owner;','Unexpected temporary authority'),
  ('ALTER ROLE character_production_owner BYPASSRLS;','Unsafe owner baseline'),
  ('GRANT EXECUTE ON FUNCTION public.character_production_due(text,text,integer) TO anon;','Dependency ACL mismatch: public.character_production_due'),
  ("CREATE OR REPLACE FUNCTION public.character_production_pending(p_provider text,p_model text,p_limit integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT '[]'::jsonb $$;",'Dependency definition mismatch'),
  ('DROP FUNCTION public.character_production_qa_ready_slots(integer);','Dependency definition mismatch'),
 ]:
  p=subprocess.run(db.command(),input='BEGIN; '+setup+prefix+sql,text=True,capture_output=True)
  assert p.returncode and label in p.stderr,p.stderr
  assert snapshot()==before
 auth_before=foundation.auth_snapshot();db.run(prefix+sql);assert foundation.auth_snapshot()==auth_before
 for role in ['anon','authenticated','service_role','character_production_generator','character_production_output_broker']:
  for sig in ['character_production_scheduler_due(uuid,text,text,integer)','character_production_scheduler_pending(uuid,text,text,integer)','character_production_scheduler_qa_ready(uuid,integer)']:
   db.check('NOT has_function_privilege('+db.quote(role)+','+db.quote('public.'+sig)+",'EXECUTE')",'no runtime grants')
 db.check("NOT pg_has_role('provision_installer','character_production_owner','SET') AND NOT has_schema_privilege('character_production_owner','public','CREATE')",'temporary authority removed')
 p=subprocess.run(db.command(),input=prefix+sql,text=True,capture_output=True)
 assert p.returncode and 'already exist' in p.stderr,p.stderr
 db.finish('enrolled-reads-install')
if __name__=='__main__':suite()
