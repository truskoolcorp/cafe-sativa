#!/usr/bin/env python3
"""Exact canary owner wrapper, disposable PG17 only; no network/provider calls."""
import os, subprocess
os.environ['PG_TEST_SERVER']='1'
import validate_ledger as db

def suite():
 db.command()
 os.environ['PGDATABASE']='character_ci_provision'
 source=(db.ROOT/'docs/proposals/character-production-zaria-canary-owner.sql').read_text()
 body=(db.ROOT/'docs/proposals/character-production-zaria-canary-body.sql').read_text()
 assert source.split('-- BEGIN EXACT REVIEWED CANARY BODY\n')[1].split('-- END EXACT REVIEWED CANARY BODY')[0] == body
 # Only installer identity and clock are substituted in this disposable fixture.
 # Slots, digest, authorization, quote and absolute window remain exact. Fixed
 # clock avoids a test that passes only during the actual production window.
 source=source.replace("'postgres'","'provision_installer'").replace('TO postgres WITH','TO provision_installer WITH').replace('BY postgres;','BY provision_installer;').replace('FROM postgres GRANTED','FROM provision_installer GRANTED')
 source=source.replace('clock_timestamp()',"'2026-11-14T17:40:00Z'::timestamptz")
 prefix='SET SESSION AUTHORIZATION provision_installer; '
 db.check("NOT (SELECT rolsuper FROM pg_roles WHERE rolname='provision_installer')",'non-superuser actual installer')
 # External snapshot compares raw ACLs, owners and every membership/grantor/
 # option, in addition to the wrapper's own effective privilege assertions.
 snapshot="""SELECT jsonb_build_object(
 'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m),
 'functions',(SELECT jsonb_agg(jsonb_build_array(oid,proowner,proacl) ORDER BY oid) FROM pg_proc WHERE pronamespace='character_production'::regnamespace OR (pronamespace='public'::regnamespace AND proname LIKE 'character_production_%')),
 'objects',(SELECT jsonb_agg(jsonb_build_array(oid,relowner,relacl) ORDER BY oid) FROM pg_class WHERE relnamespace='character_production'::regnamespace),
 'schemas',(SELECT jsonb_agg(jsonb_build_array(oid,nspowner,nspacl) ORDER BY oid) FROM pg_namespace WHERE oid IN ('character_production'::regnamespace,'public'::regnamespace)))::text;"""
 before=db.run(snapshot)
 def unchanged(empty=True):
  assert db.run(snapshot)==before, 'all original memberships and raw ACLs preserved'
  db.check("NOT pg_has_role('provision_installer','character_production_owner','SET') AND NOT pg_has_role('provision_installer','character_production_owner','USAGE')",'no residual SET/INHERIT authority')
  if empty:
   db.check("NOT EXISTS(SELECT 1 FROM character_production.budgets) AND NOT EXISTS(SELECT 1 FROM character_production.approved_slots) AND NOT EXISTS(SELECT 1 FROM character_production.schedules) AND NOT EXISTS(SELECT 1 FROM character_production.jobs)",'rollback leaves empty ledger')
 db.run(prefix+source.replace('\nCOMMIT;','\nROLLBACK;'))
 unchanged()
 # Failure after first insert must undo rows AND the temporary role grant.
 broken=source.replace('INSERT INTO character_production.approved_slots',"DO $$ BEGIN RAISE EXCEPTION 'injected insert failure'; END $$;\nINSERT INTO character_production.approved_slots",1)
 p=subprocess.run(db.command(),input=prefix+broken,text=True,capture_output=True)
 assert p.returncode!=0 and 'injected insert failure' in p.stderr
 unchanged()
 # Missing schedule aborts exact row-count postcondition, not a partial commit.
 broken='\n'.join(line for line in source.split('\n') if not line.startswith('INSERT INTO character_production.schedules'))
 p=subprocess.run(db.command(),input=prefix+broken,text=True,capture_output=True)
 assert p.returncode!=0 and 'Canary row counts differ' in p.stderr
 unchanged()
 # Prove the wrapper catches an otherwise authorized accidental ACL expansion.
 broken=source.replace('RESET ROLE;', 'GRANT SELECT ON character_production.jobs TO service_role;\nRESET ROLE;',1)
 p=subprocess.run(db.command(),input=prefix+broken,text=True,capture_output=True)
 assert p.returncode!=0 and 'Table or sequence ACL changed' in p.stderr
 unchanged()
 db.run(prefix+source)
 unchanged(False)
 db.check("(SELECT count(*)=1 FROM character_production.budgets) AND (SELECT count(*)=1 FROM character_production.approved_slots) AND (SELECT count(*)=1 FROM character_production.schedules) AND NOT EXISTS(SELECT 1 FROM character_production.jobs)",'exact one-shot rows, zero jobs')
 # Duplicate execution refuses instead of upserting/replacing/replenishing.
 p=subprocess.run(db.command(),input=prefix+source,text=True,capture_output=True)
 assert p.returncode!=0 and 'Expected empty ledger' in p.stderr
 unchanged(False)
 for sql in ['SELECT * FROM character_production.jobs','SET LOCAL ROLE character_production_owner']:
  db.run("SET SESSION AUTHORIZATION service_role; DO $$ BEGIN BEGIN "+sql+"; RAISE EXCEPTION 'unexpected permission'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;")
 db.finish('canary-owner')
if __name__=='__main__':suite()
