#!/usr/bin/env python3
import os,subprocess
os.environ['PG_TEST_SERVER']='1'
import validate_ledger as db

def suite():
 db.command();os.environ['PGDATABASE']='character_ci_provision'
 s=(db.ROOT/'docs/proposals/character-production-original-recovery.sql').read_text()
 s=s.replace("'postgres'","'provision_installer'").replace('TO postgres WITH','TO provision_installer WITH').replace('BY postgres;','BY provision_installer;').replace('FROM postgres GRANTED','FROM provision_installer GRANTED')
 s=s.replace('clock_timestamp()',"coalesce(nullif(current_setting('test.recovery_now',true),''),'2026-11-14T18:40:00Z')::timestamptz")
 before=db.run("SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m;")
 prefix='SET SESSION AUTHORIZATION provision_installer; '
 db.run(prefix+s.replace('\nCOMMIT;','\nROLLBACK;'))
 db.check("to_regprocedure('public.character_production_original_recovery_job()') IS NULL",'rollback removes new function')
 db.run(prefix+s)
 assert before==db.run("SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m;")
 db.check("NOT pg_has_role('provision_installer','character_production_owner','SET')",'no retained owner authority')
 call="public.character_production_original_recovery_job()"
 db.check(call+" IS NOT NULL",'exact original after original authorization expiry')
 for when in ['2026-11-14T18:29:59Z','2026-11-14T20:30:00Z','2026-11-14T21:00:00Z']:
  db.run("SET test.recovery_now="+db.quote(when)+"; DO $$ BEGIN IF "+call+" IS NOT NULL THEN RAISE EXCEPTION 'window leak'; END IF; END $$;")
 for mutation in ["task='foreign'","digest=repeat('f',64)","slot=slot-'authorizationId'","cost=34"]:
  db.run("BEGIN; UPDATE character_production.jobs SET "+mutation+"; DO $$ BEGIN IF "+call+" IS NOT NULL THEN RAISE EXCEPTION 'proof leak'; END IF; END $$; ROLLBACK;")
 for role in ['anon','authenticated','character_production_generator','character_production_output_broker']:
  p=subprocess.run(db.command(),input='SET SESSION AUTHORIZATION '+role+'; SELECT '+call+';',text=True,capture_output=True);assert p.returncode!=0
 db.check("NOT public.character_production_original_recovery_commit('{}'::jsonb)",'bad job rejected')
 before_job=db.run("SELECT to_jsonb(j)-ARRAY['state','sha','bytes','bucket','object_path'] FROM character_production.jobs j;")
 before_budget=db.run('SELECT to_jsonb(b) FROM character_production.budgets b;')
 for i in range(2):db.run("SET SESSION AUTHORIZATION service_role; DO $$ BEGIN IF public.character_production_original_recovery_commit("+call+"->'job') IS DISTINCT FROM true THEN RAISE EXCEPTION 'exact commit rejected'; END IF; END $$;")
 assert before_job==db.run("SELECT to_jsonb(j)-ARRAY['state','sha','bytes','bucket','object_path'] FROM character_production.jobs j;")
 assert before_budget==db.run('SELECT to_jsonb(b) FROM character_production.budgets b;')
 db.check("(SELECT state='pending_qa' AND bytes=4023955 FROM character_production.jobs)",'private QA only')
 db.finish('original-recovery')
if __name__=='__main__':suite()
