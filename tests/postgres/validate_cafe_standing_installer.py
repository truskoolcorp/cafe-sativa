#!/usr/bin/env python3
"""Disposable PG17 wrapper rehearsal; no production manifests or connections."""
import importlib.util,json,os,subprocess
import validate_ledger as db
import validate_cafe_standing_publication as standing
from validate_enrolled_reads_install import verbatim_run
spec=importlib.util.spec_from_file_location('standing_install',db.ROOT/'scripts/prepare-cafe-standing-install.py')
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)
CATALOG=(db.ROOT/'scripts/cafe-standing-catalog.sql').read_text()
STANDING=(db.ROOT/'docs/proposals/cafe-standing-publication-authority.sql').read_text()
SIX=['character_production_scheduler_context(uuid)','character_production_scheduler_reconciled(uuid,integer)','character_production_scheduler_plan(uuid,integer,jsonb)','character_production_scheduler_due(uuid,text,text,integer)','character_production_scheduler_pending(uuid,text,text,integer)','character_production_scheduler_qa_ready(uuid,integer)']
FOUR=['cs_preflight_cafe_metricool(uuid,text)','cs_claim_cafe_metricool(uuid,text,text,text)','cs_identity_cafe_metricool(uuid,uuid,text,text)','cs_finish_cafe_metricool(uuid,uuid,text,jsonb)']
class SetupComplete(Exception):pass

def capture():return json.loads(verbatim_run('BEGIN READ ONLY; SET LOCAL search_path=pg_catalog; '+CATALOG+' ROLLBACK;'))
def grants():return verbatim_run("SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,p.proacl::text) ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.oid IN ("+','.join(db.quote('public.'+s)+'::regprocedure' for s in SIX+FOUR)+')')
def fail(sql,label):
 p=subprocess.run(db.command(),input=sql,text=True,capture_output=True,timeout=60)
 db.LOG.append(p.stdout+p.stderr);assert p.returncode and label in p.stderr,(label,p.stdout,p.stderr)

def setup():
 # Reuse exact established source-owned planner/admin/Café dependency chain,
 # stopping before the standing contract is first installed. No stubs or live data.
 expected=STANDING.replace('\nCOMMIT;','\nROLLBACK;')
 def intercept(sql):
  if sql==expected:raise SetupComplete()
  return verbatim_run(sql)
 db.run=intercept
 try:
  standing.main()
 except SetupComplete:pass
 else:raise AssertionError('Exact fixture pre-install boundary not reached')
 finally:db.run=verbatim_run
 for name in ['character-production-enrolled-queues.sql','character-production-enrolled-qa.sql']:
  db.run('SET ROLE character_production_owner; '+(db.ROOT/'docs/proposals'/name).read_text())
 db.run('RESET ROLE; REVOKE CREATE ON SCHEMA public FROM character_production_owner,cafe_metricool_owner;')
 # Actual existing six scheduler/four dispatch function grants, only disposable.
 db.run(''.join('GRANT EXECUTE ON FUNCTION public.'+s+' TO service_role;' for s in SIX+FOUR))

def main():
 assert os.environ.get('PG_DISPOSABLE_TEST_CONFIRM')=='yes' and os.environ.get('PGHOST') in ['localhost','127.0.0.1','::1']
 setup();before=capture();before_grants=grants()
 assert all(before['catalog'][k] for k in ['roles','members','functions','relations','columns'])
 # Obtain expected-after from actual source application inside a rollback-only
 # disposable transaction. Never substitute fixture output for live evidence.
 candidate=json.loads(json.dumps(before));candidate['catalog']['functions'].append({'synthetic':'collection-only'})
 rehearsal=installer.generate(before,candidate)
 start=rehearsal.index('DO $guard$ DECLARE actual jsonb;',rehearsal.index('Unexpected activation data'))
 collection=rehearsal[:start]+CATALOG+'\nROLLBACK;'
 after=json.loads(db.run(collection));assert after!=before
 assert capture()==before and grants()==before_grants
 sql=installer.generate(before,after)
 db.run(sql)
 assert capture()==before and grants()==before_grants,'rehearsal must restore catalog/grants'
 # Before drift: injected unrelated existing RPC grant is never accepted.
 drift="GRANT EXECUTE ON FUNCTION public.cs_preflight_cafe_metricool(uuid,text) TO anon;"
 fail(sql.replace('BEGIN;','BEGIN; '+drift,1),'Exact reviewed before catalog mismatch')
 assert capture()==before
 # Expected-after drift and interrupted DDL both roll back all new objects.
 wrong=json.loads(json.dumps(after));wrong['catalog']['functions'].append({'synthetic':'incorrect'})
 fail(installer.generate(before,wrong),'Exact reviewed after catalog mismatch')
 assert capture()==before
 # Recollect exact synthetic expected state to diagnose any catalog instability
 # without relaxing the byte-normalized equality guard.
 repeated=json.loads(db.run(collection))
 if repeated!=after:
  differences={k:{'expectedOnly':[x for x in after['catalog'][k] if x not in repeated['catalog'][k]],'actualOnly':[x for x in repeated['catalog'][k] if x not in after['catalog'][k]],'orderChanged': sorted(map(json.dumps,after['catalog'][k]))==sorted(map(json.dumps,repeated['catalog'][k]))} for k in after['catalog'] if after['catalog'][k]!=repeated['catalog'][k]}
  raise AssertionError('Synthetic repeated catalog differs: '+json.dumps(differences,sort_keys=True))
 assert capture()==before
 fail(sql.replace('-- Deliberately no commit mode.',"DO $$ BEGIN RAISE EXCEPTION 'injected abort'; END $$;\n-- Deliberately no commit mode."),'injected abort')
 assert capture()==before and grants()==before_grants
 # Independent absence/denial checks, not just catalog equality.
 db.check("to_regclass('cafe_metricool_private.publication_scopes') IS NULL AND to_regclass('cafe_metricool_private.semantic_budgets') IS NULL",'no persistent activation tables')
 for s in SIX+FOUR:db.check("has_function_privilege('service_role',"+db.quote('public.'+s)+",'EXECUTE')",'existing scoped grant preserved')
 db.finish('cafe-standing-installer')
if __name__=='__main__':
 original=db.run;db.run=verbatim_run
 try:main()
 finally:db.run=original
