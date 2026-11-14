#!/usr/bin/env python3
"""Synthetic original-task reconciliation; never connects to production/providers."""
import os,subprocess
os.environ['PG_TEST_SERVER']='1'
import validate_ledger as db

def suite():
 db.command();os.environ['PGDATABASE']='character_ci_provision'
 source=(db.ROOT/'docs/proposals/character-production-original-reconcile.sql').read_text()
 source=source.replace("'postgres'","'provision_installer'").replace('TO postgres WITH','TO provision_installer WITH').replace('BY postgres;','BY provision_installer;').replace('FROM postgres GRANTED','FROM provision_installer GRANTED').replace('clock_timestamp()',"'2026-11-14T18:08:00Z'::timestamptz")
 db.run("""INSERT INTO character_production.jobs(key,slot,digest,provider,model,period,provider_binding_revision,cost,state,created_at)
 SELECT key,slot,digest,'heygen','avatar_iv','2026-11',slot->>'providerBindingRevision',35,'unknown','2026-11-14T18:00:35.712Z' FROM character_production.approved_slots;
 UPDATE character_production.budgets SET reserved_cents=35;""")
 prefix='SET SESSION AUTHORIZATION provision_installer; '
 db.check("NOT (SELECT rolsuper FROM pg_roles WHERE rolname='provision_installer')",'non-superuser installer')
 snapshot="SELECT jsonb_build_object('jobs',(SELECT jsonb_agg(to_jsonb(j)-ARRAY['state','task']) FROM character_production.jobs j),'budgets',(SELECT jsonb_agg(to_jsonb(b)) FROM character_production.budgets b),'slots',(SELECT jsonb_agg(to_jsonb(s)) FROM character_production.approved_slots s),'schedules',(SELECT jsonb_agg(to_jsonb(s)) FROM character_production.schedules s),'roles',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m))::text;"
 before=db.run(snapshot)
 def check(state):
  assert before==db.run(snapshot),'original token/digest/cost/slot/budget/memberships unchanged'
  db.check("(SELECT state="+db.quote(state)+" AND "+("task IS NULL" if state=='unknown' else "task='c8246007ce21cee14e38f409b4492967'")+" FROM character_production.jobs)",'exact state/task')
  db.check("NOT pg_has_role('provision_installer','character_production_owner','SET') AND NOT pg_has_role('provision_installer','character_production_owner','USAGE')",'no retained owner authority')
 db.run(prefix+source.replace('\nCOMMIT;','\nROLLBACK;'));check('unknown')
 broken=source.replace(' IF (to_jsonb(before_row)'," RAISE EXCEPTION 'injected after task association';\n IF (to_jsonb(before_row)")
 p=subprocess.run(db.command(),input=prefix+broken,text=True,capture_output=True)
 assert p.returncode!=0 and 'injected after task association' in p.stderr
 check('unknown')
 for mutation in ["slot=slot-'characterId'", "slot=slot-'authorizationId'", "digest=repeat('f',64)", "task='different-task'", "slot=jsonb_set(slot,'{durationSeconds}','10')"]:
  original=db.run("SELECT row_to_json(j)::text FROM character_production.jobs j;").strip()
  db.run('UPDATE character_production.jobs SET '+mutation+';')
  p=subprocess.run(db.command(),input=prefix+source,text=True,capture_output=True)
  assert p.returncode!=0,mutation
  db.run("UPDATE character_production.jobs SET slot=("+db.quote(original)+"::jsonb)->'slot',digest=("+db.quote(original)+"::jsonb)->>'digest',task=NULL;")
  check('unknown')
 db.run(prefix+source);check('submitted')
 p=subprocess.run(db.command(),input=prefix+source,text=True,capture_output=True)
 assert p.returncode!=0 and 'Original reservation provenance differs' in p.stderr
 check('submitted')
 db.finish('original-reconcile')
if __name__=='__main__':suite()
