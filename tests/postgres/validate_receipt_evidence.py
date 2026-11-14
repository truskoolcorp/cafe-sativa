#!/usr/bin/env python3
"""PG17 disposable provisioned NON-superuser owner, receipt evidence only."""
import os, subprocess, json
os.environ['PG_TEST_SERVER']='1'
import validate_ledger as db
def fixture_install(source):
 # Disposable harness only: CREATE is temporary inside the same transaction.
 # Proposal itself grants nothing. Real deployment needs a separately reviewed wrapper.
 return source.replace('BEGIN;',"BEGIN; GRANT CREATE ON SCHEMA public TO character_production_owner; SET LOCAL ROLE character_production_owner; DO $$ BEGIN IF current_user<>'character_production_owner' OR (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN RAISE EXCEPTION 'non-superuser installer required'; END IF; END $$;",1).replace('COMMIT;',"RESET ROLE; REVOKE CREATE ON SCHEMA public FROM character_production_owner; COMMIT;")
def observe(key,task='NULL'):
 return "(SELECT public.character_production_observe_receipt(key,token,digest,"+task+") FROM character_production.jobs WHERE key="+db.quote(key)+")"
def submit(key,task):
 return "(SELECT public.character_production_submitted(key,token,digest,"+db.quote(task)+") FROM character_production.jobs WHERE key="+db.quote(key)+")"
def snapshot():
 return db.run("SELECT jsonb_build_object('functions',(SELECT jsonb_agg(jsonb_build_array(oid,proacl::text,pg_get_functiondef(oid)) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'character_production_%'),'schemas',(SELECT jsonb_agg(jsonb_build_array(oid,nspacl::text) ORDER BY oid) FROM pg_namespace WHERE nspname IN ('public','character_production')),'tables',(SELECT jsonb_agg(jsonb_build_array(oid,relacl::text) ORDER BY oid) FROM pg_class WHERE relnamespace='character_production'::regnamespace),'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m),'jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY key) FROM character_production.jobs j))")
def mutation(key,sql,label):
 db.run('BEGIN; '+sql+' DO $$ BEGIN IF '+observe(key)+' IS DISTINCT FROM false THEN RAISE EXCEPTION '+db.quote(label)+'; END IF; END $$; ROLLBACK;')
def suite():
 db.command();os.environ['PGDATABASE']='character_ci_provision'
 db.check("current_setting('server_version_num')::int BETWEEN 170000 AND 179999",'PG17 required')
 db.check("NOT (SELECT rolsuper FROM pg_roles WHERE rolname='character_production_owner')",'real non-superuser function owner')
 db.check("to_regprocedure('public.character_production_observe_receipt(text,text,text,text)') IS NULL",'fresh receipt fixture')
 keys=['receipt-current','receipt-expired','receipt-unknown','receipt-submitted','receipt-rollback']
 db.fixture('receipt-evidence',keys,cap=500,cost=35)
 for key in keys:db.check(db.claim(key)+' IS NOT NULL','fixture claim '+key)
 source=(db.ROOT/'docs/proposals/character-production-receipt-evidence.sql').read_text()
 db.check("NOT has_schema_privilege('character_production_owner','public','CREATE')",'fixture starts without owner CREATE')
 before=snapshot()
 db.run(fixture_install(source).replace('COMMIT;','ROLLBACK;'))
 assert snapshot()==before,'rollback must retain functions, ACLs, memberships, jobs'
 broken=source.replace('COMMIT;',"UPDATE character_production.jobs SET task='rollback-only' WHERE key='receipt-rollback'; DO $$ BEGIN RAISE EXCEPTION 'injected receipt rollback'; END $$; COMMIT;")
 p=subprocess.run(db.command(),input=fixture_install(broken),text=True,capture_output=True,timeout=30)
 db.LOG.append(p.stdout+p.stderr);assert p.returncode and 'injected receipt rollback' in p.stderr
 assert snapshot()==before,'error rollback restores all old function definitions and data'
 acl_sql="SELECT jsonb_agg(jsonb_build_array(oid,proacl::text,proowner) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'character_production_%' AND proname<>'character_production_observe_receipt'"
 prior_acl=db.run(acl_sql)
 db.run(fixture_install(source))
 assert db.run(acl_sql)==prior_acl,'existing function ACL/owner must not change'
 installed=json.loads(snapshot()); original=json.loads(before)
 for section in ['schemas','tables','members','jobs']: assert installed[section]==original[section],section+' unchanged by install'
 for role in ['anon','authenticated','service_role','character_production_generator','character_production_output_broker']:
  db.check('NOT has_function_privilege('+db.quote(role)+",'public.character_production_observe_receipt(text,text,text,text)','EXECUTE')",'new RPC grants absent '+role)
  db.run('SET SESSION AUTHORIZATION '+role+"; DO $$ BEGIN BEGIN PERFORM public.character_production_observe_receipt(NULL,NULL,NULL,NULL); RAISE EXCEPTION 'unexpected execute'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;")
 db.check(observe('receipt-current'),'current exact preflight')
 db.check("NOT public.character_production_observe_receipt(NULL,NULL,NULL,NULL)",'all NULL denied')
 db.check("NOT public.character_production_observe_receipt('missing','missing','missing',NULL)",'missing job denied')
 db.check("NOT (SELECT public.character_production_observe_receipt(key,'foreign-token',digest,NULL) FROM character_production.jobs WHERE key='receipt-current')",'foreign token denied')
 db.check("NOT (SELECT public.character_production_observe_receipt(key,token,repeat('f',64),NULL) FROM character_production.jobs WHERE key='receipt-current')",'foreign digest denied')
 mutation('receipt-current',"UPDATE character_production.approved_slots SET enabled=false WHERE key='receipt-current';",'revoked denied')
 mutation('receipt-current',"UPDATE character_production.approved_slots SET slot=slot||'{\"model\":\"foreign\"}' WHERE key='receipt-current';",'changed exact authority denied')
 mutation('receipt-current',"UPDATE character_production.approved_slots SET slot=slot-'authorizationId' WHERE key='receipt-current';",'missing authority denied')
 mutation('receipt-current',"UPDATE character_production.budgets SET enabled=false WHERE provider='receipt-evidence';",'disabled budget denied')
 mutation('receipt-current',"UPDATE character_production.budgets SET cap_cents=501 WHERE provider='receipt-evidence';",'missing matched authority row denied')
 # Simulate passage beyond original authorization without changing task authority.
 db.run("UPDATE character_production.jobs SET slot=jsonb_set(slot,'{authorizationExpiresAt}','0') WHERE key='receipt-expired'; UPDATE character_production.approved_slots SET slot=jsonb_set(slot,'{authorizationExpiresAt}','0') WHERE key='receipt-expired';")
 db.check('NOT '+observe('receipt-expired'),'expired preflight denied')
 db.check(observe('receipt-expired',"'original-expired-task'"),'late original evidence retained')
 db.check(observe('receipt-expired',"'original-expired-task'"),'late evidence replay idempotent')
 db.check('NOT '+observe('receipt-expired',"'different-task'"),'cannot overwrite evidence')
 db.check("(SELECT state='submitting' AND task='original-expired-task' FROM character_production.jobs WHERE key='receipt-expired')",'evidence does not promote')
 db.check(observe('receipt-current',"'original-current-task'"),'current evidence retained')
 db.check('NOT '+observe('receipt-current'),'preflight denied once ID exists')
 db.check('NOT '+submit('receipt-current','mismatched-task'),'markSubmitted cannot replace observed ID')
 db.check(submit('receipt-current','original-current-task'),'matching observed ID can transition')
 db.check('NOT '+observe('receipt-current',"'original-current-task'"),'submitted state no evidence mutation')
 db.check(observe('receipt-unknown',"'original-unknown-task'"),'unknown fixture evidence')
 db.run("SELECT public.character_production_unknown(key,token,digest) FROM character_production.jobs WHERE key='receipt-unknown';")
 db.check(observe('receipt-unknown',"'original-unknown-task'"),'unknown evidence retained idempotently')
 db.check('NOT '+observe('receipt-unknown'),'unknown cannot preflight')
 db.check('NOT '+submit('receipt-unknown','original-unknown-task'),'unknown cannot silently promote')
 db.check("NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.character_production_pending('receipt-evidence','test-model',50)) j WHERE j->>'key'='receipt-unknown')",'unknown absent from pending')
 db.check(db.claim('receipt-unknown')+' IS NULL','unknown no new claim')
 db.run("SELECT public.character_production_unknown(key,token,digest) FROM character_production.jobs WHERE key='receipt-submitted'; UPDATE character_production.approved_slots SET enabled=false WHERE key='receipt-submitted';")
 db.check(observe('receipt-submitted',"'late-unknown-task'"),'late evidence allowed after revocation in unknown state')
 db.check("(SELECT state='unknown' AND task='late-unknown-task' FROM character_production.jobs WHERE key='receipt-submitted')",'late receipt cannot advance unknown')
 db.check('NOT '+observe('receipt-rollback',"'bad task with spaces'"),'invalid task rejected')
 db.check("(SELECT reserved_cents=175 FROM character_production.budgets WHERE provider='receipt-evidence')",'no additional spend or refund')
 db.check("(SELECT state='unknown' AND task='original-unknown-task' FROM character_production.jobs WHERE key='receipt-unknown')",'unknown original evidence unchanged')
 db.finish('receipt-evidence')
if __name__=='__main__':suite()
