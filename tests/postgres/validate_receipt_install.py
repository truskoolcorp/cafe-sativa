#!/usr/bin/env python3
"""Actual PG17 inert receipt installer, existing non-superuser/bootstrap path."""
import os, subprocess, json
os.environ['PG_TEST_SERVER']='1'
import validate_ledger as db
import validate_provisioning as provision
import validate_backend_grants as backend
import validate_receipt_evidence as evidence

def snapshot():
 return db.run("SELECT jsonb_build_object('base',"+"("+"SELECT jsonb_build_object('functions',(SELECT jsonb_agg(jsonb_build_array(oid,proacl::text,proowner,pg_get_functiondef(oid)) ORDER BY oid) FROM pg_proc WHERE (pronamespace='character_production'::regnamespace OR (pronamespace='public'::regnamespace AND proname LIKE 'character_production_%')) AND prokind='f'),'schemas',(SELECT jsonb_agg(jsonb_build_array(oid,nspacl::text) ORDER BY oid) FROM pg_namespace WHERE nspname IN ('public','character_production')),'objects',(SELECT jsonb_agg(jsonb_build_array(oid,relacl::text,relowner,relrowsecurity,relforcerowsecurity) ORDER BY oid) FROM pg_class WHERE relnamespace='character_production'::regnamespace),'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m))"+"),'rows',(SELECT jsonb_agg(x ORDER BY x::text) FROM (SELECT jsonb_build_array('jobs',to_jsonb(j)) x FROM character_production.jobs j UNION ALL SELECT jsonb_build_array('slots',to_jsonb(j)) FROM character_production.approved_slots j UNION ALL SELECT jsonb_build_array('budgets',to_jsonb(j)) FROM character_production.budgets j UNION ALL SELECT jsonb_build_array('schedules',to_jsonb(j)) FROM character_production.schedules j) q))")
def service_call(key,task='NULL'):
 row=json.loads(db.run("SELECT jsonb_build_object('token',token,'digest',digest) FROM character_production.jobs WHERE key="+db.quote(key)))
 return 'public.character_production_observe_receipt('+','.join([db.quote(key),db.quote(row['token']),db.quote(row['digest']),task])+')'
def service_assert(expr,label):
 db.run("SET SESSION AUTHORIZATION service_role; DO $$ BEGIN IF ("+expr+") IS DISTINCT FROM TRUE THEN RAISE EXCEPTION "+db.quote(label)+"; END IF; END $$;")
def suite():
 db.command()
 db.check("current_setting('server_version_num')::int BETWEEN 170000 AND 179999",'PG17')
 db.run('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')
 provision.suite();backend.suite()
 os.environ['PGDATABASE']='character_ci_provision'
 db.check("NOT (SELECT rolsuper FROM pg_roles WHERE rolname='provision_installer')",'actual non-superuser installer')
 keys=['install-current','install-expired','install-unknown']
 db.fixture('receipt-install',keys,cap=120,cost=35)
 for key in keys:db.check(db.claim(key)+' IS NOT NULL','synthetic prior job '+key)
 db.run("INSERT INTO character_production.schedules(key,digest,scheduled_at,not_after,enabled) SELECT key,digest,now()-interval '2 hours',now()-interval '1 hour',false FROM character_production.approved_slots WHERE key LIKE 'install-%'; UPDATE character_production.approved_slots SET slot=jsonb_set(slot,'{authorizationExpiresAt}','0') WHERE key='install-expired'; UPDATE character_production.jobs SET slot=jsonb_set(slot,'{authorizationExpiresAt}','0') WHERE key='install-expired'; SELECT public.character_production_unknown(key,token,digest) FROM character_production.jobs WHERE key='install-unknown';")
 source=(db.ROOT/'docs/proposals/character-production-receipt-install.sql').read_text()
 assert source==subprocess.check_output(['python3','scripts/prepare-receipt-evidence-install.py'],cwd=db.ROOT,text=True),'generated pinned source differs'
 source=source.replace("'postgres'","'provision_installer'").replace('TO postgres WITH','TO provision_installer WITH').replace('BY postgres;','BY provision_installer;').replace('FROM postgres GRANTED','FROM provision_installer GRANTED')
 prefix='SET SESSION AUTHORIZATION provision_installer; '
 before=snapshot()
 db.run(prefix+source.replace('\nCOMMIT;','\nROLLBACK;'))
 assert snapshot()==before,'explicit rollback restores definitions, rows and privileges'
 injection="GRANT EXECUTE ON FUNCTION public.character_production_observe_receipt(text,text,text,text) TO service_role;"
 for inject,expected in [(" UPDATE character_production.jobs SET task='injected-task' WHERE key='install-expired';",'Receipt install changed production ledger rows'),(" GRANT EXECUTE ON FUNCTION public.character_production_observe_receipt(text,text,text,text) TO anon;",'Expected only owner and backend evidence execute')]:
  broken=source.replace(injection,injection+inject)
  p=subprocess.run(db.command(),input=prefix+broken,text=True,capture_output=True,timeout=40);db.LOG.append(p.stdout+p.stderr)
  assert p.returncode and expected in p.stderr,p.stdout+p.stderr
  assert snapshot()==before,'failed install restores exact prior data/function/ACL/member state'
 db.run(prefix+source)
 after=json.loads(snapshot());old=json.loads(before)
 for section in ['schemas','objects','members']:assert after['base'][section]==old['base'][section],section+' unchanged'
 assert after['rows']==old['rows'],'all original ledger rows unchanged'
 # Existing submitted ACL and owner are identical; only its body intentionally changes.
 funcs={x[0]:x for x in after['base']['functions']}
 submitted=int(db.run("SELECT 'public.character_production_submitted(text,text,text,text)'::regprocedure::oid"))
 for x in old['base']['functions']:
  assert funcs[x[0]][:3]==x[:3]
  if str(x[0])!=str(submitted):assert funcs[x[0]]==x
 assert sum(str(x[0])==str(submitted) for x in old['base']['functions'])==1,'exact submitted function identity found'
 db.check("NOT pg_has_role('provision_installer','character_production_owner','SET') AND NOT has_schema_privilege('character_production_owner','public','CREATE')",'temporary owner restored')
 db.check("(SELECT count(*)=11 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'character_production_%' AND has_function_privilege('service_role',oid,'EXECUTE'))",'only eleventh backend RPC added')
 for role in ['anon','authenticated','character_production_generator','character_production_output_broker']:
  db.run('SET SESSION AUTHORIZATION '+role+"; DO $$ BEGIN BEGIN PERFORM public.character_production_observe_receipt(NULL,NULL,NULL,NULL); RAISE EXCEPTION 'unexpected evidence execute'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;")
 service_assert(service_call('install-current'),'current exact preflight')
 service_assert('NOT '+service_call('install-expired'),'expired authority cannot preflight')
 service_assert(service_call('install-expired',"'original-late-id'"),'late evidence saved only')
 service_assert(service_call('install-expired',"'original-late-id'"),'late replay idempotent')
 service_assert('NOT '+service_call('install-expired',"'foreign-id'"),'late overwrite denied')
 db.check("(SELECT state='submitting' AND task='original-late-id' FROM character_production.jobs WHERE key='install-expired')",'expired evidence cannot auto-promote')
 service_assert(service_call('install-unknown',"'original-unknown-id'"),'unknown late evidence allowed')
 service_assert('NOT '+service_call('install-unknown'),'unknown preflight denied')
 db.check('NOT '+evidence.submit('install-unknown','original-unknown-id'),'unknown cannot promote')
 service_assert(service_call('install-current',"'original-current-id'"),'current evidence')
 db.check('NOT '+evidence.submit('install-current','foreign-current-id'),'submitted rejects mismatched evidence')
 db.check(evidence.submit('install-current','original-current-id'),'matching evidence transitions')
 db.check("NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.character_production_pending('receipt-install','test-model',5)) j WHERE j->>'key'='install-unknown')",'unknown never pending')
 db.check("(SELECT reserved_cents=105 AND cap_cents=120 FROM character_production.budgets WHERE provider='receipt-install')",'no new spend or authority')
 p=subprocess.run(db.command(),input=prefix+source,text=True,capture_output=True,timeout=40)
 assert p.returncode and 'Existing receipt function requires reconciliation' in p.stderr
 db.finish('receipt-install')
if __name__=='__main__':suite()
