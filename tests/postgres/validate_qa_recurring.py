#!/usr/bin/env python3
"""Disposable PG17 proposal contract, no live installer/runtime grants."""
import json, subprocess, concurrent.futures, time
import validate_ledger as db
import validate_qa_install as base
D='a'*64; H='b'*64

def call(k):return 'public.character_production_qa_materialize('+db.quote(k)+','+db.quote(D)+')'
def check(k,want=True):
 db.run('SET ROLE character_production_owner; DO $$ BEGIN IF '+call(k)+' IS DISTINCT FROM '+str(want).lower()+" THEN RAISE EXCEPTION 'materialize mismatch'; END IF; END $$;")
def fixture(k,n,job=True):
 pid=f'99999999-9999-4999-8999-{n:012d}'
 slot={'key':k,'characterId':'synthetic-persona','script':'Synthetic preapproved script'}
 db.run("INSERT INTO public.cs_character_promo_drafts(id,character_id,promo_key,specialty,title,spoken_script,visual_brief,duration_seconds) VALUES("+db.quote(pid)+",'synthetic-persona',"+db.quote(k)+",'QA','Synthetic','Synthetic preapproved script','Synthetic',8); INSERT INTO character_production.approved_slots(key,digest,slot,enabled) VALUES("+db.quote(k)+','+db.quote(D)+','+db.quote(json.dumps(slot))+"::jsonb,true); INSERT INTO character_production.qa_slot_bindings SELECT a.key,a.digest,a.slot,d.id,d.updated_at,true FROM character_production.approved_slots a,public.cs_character_promo_drafts d WHERE a.key="+db.quote(k)+' AND d.id='+db.quote(pid)+';')
 if job:addjob(k)
 return pid

def addjob(k):
 db.run("INSERT INTO character_production.jobs(key,slot,digest,provider,model,period,provider_binding_revision,cost,state,task,sha,bytes,bucket,object_path) SELECT key,slot,digest,'heygen','avatar_iv','2026-11',repeat('c',64),35,'pending_qa','synthetic-task-'||key,"+db.quote(H)+",64,'character-production-private',digest||'/"+H+".mp4' FROM character_production.approved_slots WHERE key="+db.quote(k)+';')
def suite():
 base.suite()
 sql=(db.ROOT/'docs/proposals/character-production-qa-recurring.sql').read_text()
 policies=(db.ROOT/'docs/proposals/character-production-qa-recurring-policies.sql').read_text()
 # Disposable DDL setup, not a production installer: explicitly restore grants.
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; GRANT REFERENCES(id) ON public.cs_character_promo_drafts TO character_production_owner;')
 before=base.snapshot(); db.run('SET ROLE character_production_owner; '+sql.replace('COMMIT;','ROLLBACK;')); assert base.snapshot()==before
 db.run('SET ROLE character_production_owner; '+sql)
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner; REVOKE REFERENCES(id) ON public.cs_character_promo_drafts FROM character_production_owner; GRANT USAGE ON SCHEMA character_production TO provision_installer;')
 db.run('SET SESSION AUTHORIZATION provision_installer; '+policies)
 db.run('REVOKE USAGE ON SCHEMA character_production FROM provision_installer;')
 for r in ['anon','authenticated','service_role','character_production_generator','character_production_output_broker']:
  db.check("NOT has_function_privilege("+db.quote(r)+",'public.character_production_qa_materialize(text,text)','EXECUTE') AND NOT has_function_privilege("+db.quote(r)+",'public.character_production_qa_ready_slots(integer)','EXECUTE')",'no runtime grants')
 # Prebind before job exists; no jobs FK and no runtime draft creation.
 pid=fixture('pre-job',1,False);check('pre-job',False);addjob('pre-job')
 db.run("SET ROLE character_production_owner; SELECT id FROM public.cs_character_promo_drafts WHERE id='"+pid+"' FOR UPDATE;")
 p=subprocess.run(db.command(),input="SET ROLE character_production_owner; UPDATE public.cs_character_promo_drafts SET updated_at=now() WHERE id='"+pid+"';",text=True,capture_output=True);assert p.returncode and 'row-level security' in p.stderr,p.stderr
 check('pre-job');check('pre-job')
 db.check("(SELECT count(*)=1 FROM character_production.qa_targets WHERE job_key='pre-job')",'idempotent exact target')
 # Mutation and revocation must refuse; rollback restores original evidence.
 for i,mutation in enumerate([
  "UPDATE character_production.approved_slots SET enabled=false WHERE key={k}",
  "UPDATE character_production.qa_slot_bindings SET enabled=false WHERE slot_key={k}",
  "UPDATE character_production.qa_slot_bindings SET digest=repeat('f',64) WHERE slot_key={k}",
  "UPDATE character_production.qa_slot_bindings SET slot=slot-'script' WHERE slot_key={k}",
  "UPDATE character_production.jobs SET object_path='wrong' WHERE key={k}",
  "UPDATE character_production.jobs SET bucket='wrong' WHERE key={k}",
  "UPDATE character_production.jobs SET state='unknown',sha=NULL,bytes=NULL,bucket=NULL,object_path=NULL WHERE key={k}",
  "UPDATE public.cs_character_promo_drafts SET updated_at=updated_at+interval '1 second' WHERE promo_key={k}",
  "UPDATE public.cs_character_promo_drafts SET spoken_script='changed' WHERE promo_key={k}",
  "UPDATE public.cs_character_promo_drafts SET publication_approved_at=now() WHERE promo_key={k}",
  "UPDATE public.cs_character_promo_drafts SET video_asset_path='existing' WHERE promo_key={k}"]):
  k='deny-'+str(i);fixture(k,10+i)
  db.run('BEGIN; '+mutation.format(k=db.quote(k))+'; SET ROLE character_production_owner; DO $$ BEGIN IF '+call(k)+" THEN RAISE EXCEPTION 'invalid binding accepted'; END IF; END $$; ROLLBACK;")
 # Real concurrent independent connections serialize exact replay to one target.
 fixture('race',30)
 def runone():return db.run('SET ROLE character_production_owner; SELECT '+call('race')+';')
 leader=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 leader.stdin.write("SET application_name='qa_recurring_race'; BEGIN; SET ROLE character_production_owner; SELECT key FROM character_production.approved_slots WHERE key='race' FOR UPDATE; SELECT pg_sleep(3); SELECT "+call('race')+"; COMMIT;\n");leader.stdin.close()
 for _ in range(50):
  if db.run("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='qa_recurring_race' AND wait_event='PgSleep')")=='t':break
  time.sleep(.05)
 else:raise AssertionError('race lock barrier not observed')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:runone(),range(2)))
 leader.wait(timeout=10);out=leader.stdout.read();err=leader.stderr.read();assert leader.returncode==0 and 't' in out.splitlines(),(out,err)
 assert all(x=='t' for x in results),results
 db.check("(SELECT count(*)=1 FROM character_production.qa_targets WHERE job_key='race')",'race one target')
 db.run("SET ROLE character_production_owner; UPDATE character_production.qa_slot_bindings SET enabled=false WHERE slot_key='race';")
 check('race',False)
 db.check("(SELECT enabled=false FROM character_production.qa_targets WHERE job_key='race')",'binding revocation propagated')
 db.check("public.character_production_qa_prepare('race',repeat('a',64)) IS NULL",'existing bridge revoked')
 p=subprocess.run(db.command(),input="UPDATE character_production.qa_slot_bindings SET enabled=true WHERE slot_key='race';",text=True,capture_output=True);assert p.returncode and 'immutable' in p.stderr,p.stderr
 # Stale oldest rows are not returned; no limit-one starvation on known invalidity.
 for k,mut in [('pre-job',"updated_at=updated_at+interval '1 second'"),('deny-0',"publication_approved_at=now()")]:
  db.run('BEGIN; UPDATE public.cs_character_promo_drafts SET '+mut+' WHERE promo_key='+db.quote(k)+"; SET ROLE character_production_owner; DO $$ BEGIN IF EXISTS(SELECT 1 FROM jsonb_array_elements(public.character_production_qa_ready_slots(5)) x WHERE x->>'key'="+db.quote(k)+") THEN RAISE EXCEPTION 'stale queued'; END IF; END $$; ROLLBACK;")
 # Deleting a materialized binding revokes target too; no orphan authority.
 fixture('deleted',40);check('deleted')
 db.run("SET ROLE character_production_owner; DELETE FROM character_production.qa_slot_bindings WHERE slot_key='deleted';")
 db.check("(SELECT enabled=false FROM character_production.qa_targets WHERE job_key='deleted')",'delete revoked target')
 # Ready discovery is bounded and includes materialized-but-uncommitted targets.
 db.run("SET ROLE character_production_owner; DO $$ BEGIN IF jsonb_array_length(public.character_production_qa_ready_slots(999))>5 OR public.character_production_qa_ready_slots(0)<>'[]'::jsonb THEN RAISE EXCEPTION 'limit'; END IF; END $$;")
 # Isolate limit-one selection from every earlier synthetic binding.
 db.run('SET ROLE character_production_owner; UPDATE character_production.qa_slot_bindings SET enabled=false;')
 fixture('queue-stale',50);fixture('queue-malformed',51);fixture('queue-valid',52)
 db.run("UPDATE public.cs_character_promo_drafts SET publication_approved_at=now() WHERE promo_key='queue-stale'; UPDATE character_production.jobs SET object_path='wrong' WHERE key='queue-malformed';")
 db.run("SET ROLE character_production_owner; DO $$ BEGIN IF public.character_production_qa_ready_slots(1) IS DISTINCT FROM jsonb_build_array(jsonb_build_object('key','queue-valid','digest',repeat('a',64))) THEN RAISE EXCEPTION 'old invalid rows starve valid'; END IF; END $$;")
 db.check("(SELECT reserved_cents=35 AND cap_cents=40 FROM character_production.budgets WHERE provider='heygen' AND period='2026-11')",'no spend changes')
 db.finish('qa-recurring')
if __name__=='__main__':suite()
