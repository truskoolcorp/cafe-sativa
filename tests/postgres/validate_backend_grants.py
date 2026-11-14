#!/usr/bin/env python3
"""Run after validate_provisioning in PG17 disposable CI. No live connections."""
import os,subprocess
os.environ['PG_TEST_SERVER']='1'
import validate_ledger as db

def suite():
 db.command()
 os.environ['PGDATABASE']='character_ci_provision'
 source=(db.ROOT/'docs/proposals/character-production-backend-grants.sql').read_text()
 # Same transaction; only reviewed installer identity differs in CI. Original
 # bootstrap grantor remains postgres, distinct from provision_installer.
 source=source.replace("'postgres'","'provision_installer'").replace('TO postgres WITH','TO provision_installer WITH').replace('BY postgres;','BY provision_installer;').replace('FROM postgres GRANTED','FROM provision_installer GRANTED')
 prefix='SET SESSION AUTHORIZATION provision_installer; '
 db.check("EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member='provision_installer'::regrole AND grantor='postgres'::regrole AND admin_option AND NOT inherit_option AND NOT set_option)",'real bootstrap grantor differs from installer')
 db.run(prefix+source.replace('\nCOMMIT;','\nROLLBACK;'))
 db.check("NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'character_production_%' AND has_function_privilege('service_role',oid,'EXECUTE'))",'rollback retains denied backend')
 # Deliberately remove one of ten statements: postcondition must abort everything.
 broken=source.replace('GRANT EXECUTE ON FUNCTION public.character_production_failed(jsonb) TO service_role;','')
 p=subprocess.run(db.command(),input=prefix+broken,text=True,capture_output=True)
 assert p.returncode!=0 and 'Exact ten RPC grants missing' in p.stderr
 db.check("NOT has_function_privilege('service_role','public.character_production_output(jsonb,text,bigint)','EXECUTE')",'missing grant rollback')
 db.run(prefix+source)
 db.check("(SELECT count(*)=10 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'character_production_%' AND has_function_privilege('service_role',oid,'EXECUTE'))",'exact ten grants applied')
 db.check("EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member='provision_installer'::regrole AND grantor='postgres'::regrole AND admin_option AND NOT inherit_option AND NOT set_option) AND NOT pg_has_role('provision_installer','character_production_owner','SET')",'original grantor/admin edge preserved')
 for sql in ['SELECT * FROM character_production.jobs','SET LOCAL ROLE character_production_owner']:
  db.run("DO $$ BEGIN SET LOCAL ROLE service_role; BEGIN "+sql+"; RAISE EXCEPTION 'unexpected permission'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; RESET ROLE; END $$;")
 db.run("SET ROLE service_role; SELECT public.character_production_pending('heygen','avatar_v',1); RESET ROLE;")
 p=subprocess.run(db.command(),input=prefix+source,text=True,capture_output=True)
 assert p.returncode!=0 and 'Unexpected preexisting backend function access' in p.stderr
 db.finish('backend-grants')
if __name__=='__main__':suite()
