#!/usr/bin/env python3
"""Disposable PG17 exact intent authorization/replay/concurrency checks."""
import os,concurrent.futures
os.environ['PG_TEST_SERVER']='1'
import validate_ledger as db

def suite():
 db.command();source=(db.ROOT/'docs/proposals/character-production-upload-intent.sql').read_text()
 db.run('SET ROLE ledger_owner; '+source+' RESET ROLE;')
 for role in ['anon','authenticated','service_role','ledger_worker']:
  for sig in ['upload_reserve(jsonb,text,bigint)','upload_inspect(jsonb)','upload_finalize(jsonb,text,bigint)']:
   db.check('NOT has_function_privilege('+db.quote(role)+','+db.quote('public.character_production_'+sig)+",'EXECUTE')",'no runtime grants')
 db.fixture('upload-fixture',['upload-job'])
 db.check(db.claim('upload-job')+' IS NOT NULL','claim')
 db.run("SELECT public.character_production_submitted(key,token,digest,'upload-task') FROM character_production.jobs WHERE key='upload-job';")
 job="(SELECT jsonb_build_object('key',key,'token',token,'digest',digest,'taskId',task,'provider',provider,'model',model,'providerBindingRevision',provider_binding_revision) FROM character_production.jobs WHERE key='upload-job')"
 reserve=lambda j=job,sha="repeat('d',64)",n='100':'public.character_production_upload_reserve('+j+','+sha+','+n+')'
 for field in ['key','token','digest','taskId','provider','model','providerBindingRevision']:
  db.check(reserve(job+"||jsonb_build_object("+db.quote(field)+",'wrong')")+' IS NULL','wrong identity '+field)
 for n in ['0','15','36700161','NULL']:db.check(reserve(n=n)+' IS NULL','bad bytes')
 db.check(reserve(sha="'wrong'")+' IS NULL','bad hash')
 # Two DB sessions compete for the one signing intent.
 def attempt(_):return db.run('SELECT '+reserve()+' IS NOT NULL;')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(attempt,[1,2]))
 assert sorted(results)==['f','t'],results
 db.check(reserve()+' IS NULL','replay cannot re-sign');db.check(reserve(sha="repeat('e',64)")+' IS NULL','different hash cannot replace')
 inspect='public.character_production_upload_inspect('+job+')'
 finalize=lambda sha="repeat('d',64)",n='100':'public.character_production_upload_finalize('+job+','+sha+','+n+')'
 db.check(inspect+' IS NOT NULL','intent exists')
 db.check('NOT '+finalize(sha="repeat('e',64)"),'wrong sha');db.check('NOT '+finalize(n='101'),'wrong size')
 for table,where in [('budgets',"provider='upload-fixture'"),('approved_slots',"key='upload-job'")]:
  db.run('UPDATE character_production.'+table+' SET enabled=false WHERE '+where+';');db.check(inspect+' IS NULL','revoke inspect');db.check('NOT '+finalize(),'revoke finalize');db.run('UPDATE character_production.'+table+' SET enabled=true WHERE '+where+';')
 db.check(finalize(),'attest');db.check(finalize(),'same receipt idempotent')
 db.run("UPDATE character_production.upload_intents SET expires_at=clock_timestamp()-interval '1 second' WHERE key='upload-job';")
 db.check(inspect+' IS NULL','expired inspect');db.check('NOT '+finalize(),'expired finalize');db.check(reserve()+' IS NULL','expired intent never reissued')
 db.check("(SELECT state='pending_qa' FROM character_production.jobs WHERE key='upload-job')",'QA only')
 db.finish('upload-intent')
if __name__=='__main__':suite()
