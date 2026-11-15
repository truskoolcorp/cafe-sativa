#!/usr/bin/env python3
"""Disposable future capability delta. Never production activation."""
import subprocess,re
import validate_ledger as db
import validate_qa_install as qa
import validate_planner_install as planner
import validate_enrolled_reads_install as foundation

def attempt(sql):
 p=subprocess.run(db.command(),input=sql+'\n',text=True,capture_output=True,timeout=30)
 db.LOG.append(p.stdout+p.stderr)
 return p

def suite():
 original=db.run;db.run=foundation.verbatim_run
 try:_suite()
 finally:db.run=original

def _suite():
 foundation.suite()
 # Reproduce verified live proxy/source topology, not zero-membership assumptions.
 db.run("CREATE ROLE authenticator LOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS; ALTER ROLE service_role NOLOGIN INHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB BYPASSRLS; CREATE ROLE capability_outsider NOLOGIN NOINHERIT;")
 grantor=db.run("SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.grantor WHERE m.roleid='character_production_owner'::regrole AND m.member='provision_installer'::regrole")
 assert grantor.isidentifier(),grantor
 db.run('GRANT service_role TO authenticator WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY '+grantor+'; GRANT service_role TO provision_installer WITH ADMIN TRUE,INHERIT TRUE,SET TRUE GRANTED BY '+grantor+';')
 source=(db.ROOT/'docs/proposals/character-production-enrolled-runtime-capability-grant.sql').read_text()
 assert source==subprocess.check_output(['python3','scripts/prepare-enrolled-runtime-capability-grant.py'],cwd=db.ROOT,text=True)
 sql=qa.adapt(source);prefix='SET SESSION AUTHORIZATION provision_installer; '
 before=(qa.snapshot(),planner.auth_snapshot())
 # Each unsafe membership must fail without altering existing topology/data.
 for setup,label in [
  ('GRANT capability_outsider TO character_production_owner WITH INHERIT TRUE,SET TRUE;','Unsafe ledger owner memberships'),
  ('GRANT character_production_owner TO capability_outsider WITH INHERIT TRUE,SET TRUE;','Unsafe ledger owner memberships'),
  ('GRANT capability_outsider TO service_role WITH INHERIT TRUE,SET TRUE;','Service role membership baseline mismatch'),
  ('GRANT service_role TO capability_outsider WITH INHERIT FALSE,SET TRUE;','Service role membership baseline mismatch'),
  ('GRANT authenticator TO capability_outsider WITH INHERIT FALSE,SET TRUE;','Unexpected effective service principal'),
 ]:
  proc=attempt('BEGIN; '+setup+prefix+sql)
  assert proc.returncode and label in proc.stderr,proc.stderr
  assert before==(qa.snapshot(),planner.auth_snapshot())
 db.run(prefix+sql.replace('\nCOMMIT;','\nROLLBACK;'))
 assert before==(qa.snapshot(),planner.auth_snapshot())
 for broken,label in [(sql.replace('\nCOMMIT;',"\nDO $$ BEGIN RAISE EXCEPTION 'injected abort'; END $$; COMMIT;"),'injected abort'),(sql.replace('TO service_role;','TO authenticated;'),'result ACL mismatch')]:
  p=attempt(prefix+broken)
  assert p.returncode and label in p.stderr,p.stderr
  assert before==(qa.snapshot(),planner.auth_snapshot())
 # Extra baseline privilege and function body drift must not be normalized.
 for setup,label in [("GRANT EXECUTE ON FUNCTION public.character_production_scheduler_context(uuid) TO anon;",'baseline ACL mismatch'),("ALTER FUNCTION public.character_production_scheduler_context(uuid) SECURITY INVOKER;",'identity/body mismatch')]:
  p=attempt('BEGIN; '+setup+prefix+sql)
  assert p.returncode and label in p.stderr,p.stderr
  assert before==(qa.snapshot(),planner.auth_snapshot())
 p=attempt("BEGIN; ALTER FUNCTION character_production.scheduler_current(uuid) SECURITY INVOKER; "+prefix+sql)
 assert p.returncode and 'dependency identity/body mismatch' in p.stderr,p.stderr
 assert before==(qa.snapshot(),planner.auth_snapshot())
 principal=(db.ROOT/'docs/proposals/character-production-scheduler-principal.sql').read_text()
 guard=re.search(r'CREATE FUNCTION character_production\.scheduler_current\([^;]+?AS \$\$.*?\$\$;',principal,re.S).group(0)
 guard=guard.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1).replace(' RETURN e;',' RETURN NULL;')
 p=attempt('BEGIN; '+guard+prefix+sql)
 assert p.returncode and 'dependency identity/body mismatch' in p.stderr,p.stderr
 assert before==(qa.snapshot(),planner.auth_snapshot())
 for setup,label in [("GRANT EXECUTE ON FUNCTION public.character_production_scheduler_context(uuid) TO service_role;",'baseline ACL mismatch'),("GRANT EXECUTE ON FUNCTION public.character_production_scheduler_due(uuid,text,text,integer) TO service_role;",'baseline ACL mismatch'),("ALTER FUNCTION public.character_production_scheduler_qa_ready(uuid,integer) SECURITY INVOKER;",'identity/body mismatch')]:
  p=attempt('BEGIN; '+setup+prefix+sql)
  assert p.returncode and label in p.stderr,(label,p.stderr)
  assert before==(qa.snapshot(),planner.auth_snapshot())
 auth_before=planner.auth_snapshot();db.run(prefix+sql);assert planner.auth_snapshot()==auth_before
 signatures=['character_production_scheduler_context(uuid)','character_production_scheduler_reconciled(uuid,integer)','character_production_scheduler_plan(uuid,integer,jsonb)','character_production_scheduler_due(uuid,text,text,integer)','character_production_scheduler_pending(uuid,text,text,integer)','character_production_scheduler_qa_ready(uuid,integer)']
 db.check("pg_has_role('authenticator','service_role','SET') AND NOT pg_has_role('authenticator','service_role','USAGE') AND pg_has_role('provision_installer','service_role','USAGE')",'reviewed proxy/source access retained')
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
 p=attempt(prefix+sql)
 assert p.returncode and 'baseline ACL mismatch' in p.stderr,p.stderr
 db.finish('enrolled-runtime-capability-grant')
if __name__=='__main__':suite()
