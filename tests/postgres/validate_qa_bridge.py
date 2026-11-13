#!/usr/bin/env python3
"""Run after ledger suite in the same disposable cluster."""
from validate_ledger import ROOT, run, check, install, privileges, quote, finish
COLUMNS='id,character_id,spoken_script,status,audio_asset_path,video_asset_path,voice_approved_at,video_qa_approved_at,publication_approved_at,updated_at'
def promo(n): return '00000000-0000-0000-0000-'+str(n).zfill(12)
def draft(n):
 run('INSERT INTO public.cs_character_promo_drafts('+COLUMNS+') VALUES('+quote(promo(n))+",'test-character','Synthetic script','draft',NULL,NULL,NULL,NULL,NULL,'2026-01-01T00:00:00.123456Z');")
def qa_fixture(key,n):
 run("INSERT INTO character_production.approved_slots(key,slot,digest,enabled) SELECT "+quote(key)+",slot||jsonb_build_object('key',"+quote(key)+"),digest,true FROM character_production.approved_slots WHERE key='first';")
 run("INSERT INTO character_production.jobs(key,slot,digest,provider,model,period,provider_binding_revision,cost,state,task,sha,bytes,bucket,object_path) SELECT "+quote(key)+",slot||jsonb_build_object('key',"+quote(key)+"),digest,provider,model,period,provider_binding_revision,cost,'pending_qa',"+quote(key)+",sha,bytes,bucket,object_path FROM character_production.jobs WHERE key='first';")
 draft(n)
 run("INSERT INTO character_production.qa_targets SELECT "+quote(key)+",repeat('a',64),id,updated_at,true FROM public.cs_character_promo_drafts WHERE id="+quote(promo(n))+';')
def commit(key="'first'",sha="repeat('d',64)",size='100',pid="(m->>'promoId')::uuid",stamp="(m->>'expectedUpdatedAt')::timestamptz",bucket="m->>'destinationBucket'",path="m->>'destinationPath'"):
 return 'public.character_production_qa_commit('+','.join([key,"repeat('a',64)",sha,size,pid,stamp,bucket,path])+')'
def suite():
 run('SET ROLE ledger_owner; CREATE TABLE public.cs_character_promo_drafts(id uuid PRIMARY KEY,character_id text,spoken_script text,status text,audio_asset_path text,video_asset_path text,voice_approved_at timestamptz,video_qa_approved_at timestamptz,publication_approved_at timestamptz,updated_at timestamptz NOT NULL); RESET ROLE;')
 install('character-production-qa-bridge.sql');privileges();draft(1);draft(2)
 run("INSERT INTO character_production.qa_targets SELECT 'first',repeat('a',64),id,updated_at,true FROM public.cs_character_promo_drafts WHERE id="+quote(promo(1))+';')
 prepare="public.character_production_qa_prepare('first',repeat('a',64))"
 check(prepare+"->>'state'='copy'",'valid QA prepare')
 check("public.character_production_qa_prepare('first',repeat('e',64)) IS NULL",'wrong digest')
 for col,value in [('audio_asset_path',"'audio.wav'"),('video_asset_path',"'video.mp4'"),('voice_approved_at','clock_timestamp()'),('video_qa_approved_at','clock_timestamp()'),('publication_approved_at','clock_timestamp()')]:
  run('UPDATE public.cs_character_promo_drafts SET '+col+'='+value+' WHERE id='+quote(promo(1))+';');check(prepare+' IS NULL','nonnull '+col);run('UPDATE public.cs_character_promo_drafts SET '+col+'=NULL WHERE id='+quote(promo(1))+';')
 for col,value,restore in [('status',"'published'","'draft'"),('spoken_script',"'changed'","'Synthetic script'"),('character_id',"'other'","'test-character'")]:
  run('UPDATE public.cs_character_promo_drafts SET '+col+'='+value+' WHERE id='+quote(promo(1))+';');check(prepare+' IS NULL','wrong '+col);run('UPDATE public.cs_character_promo_drafts SET '+col+'='+restore+' WHERE id='+quote(promo(1))+';')
 run("UPDATE character_production.approved_slots SET slot=slot||'{\"model\":\"mutated\"}' WHERE key='first';");check(prepare+' IS NULL','same digest changed snapshot');run("UPDATE character_production.approved_slots SET slot=slot||'{\"model\":\"test-model\"}' WHERE key='first';")
 for table,key in [('approved_slots','key'),('qa_targets','job_key')]:
  run('UPDATE character_production.'+table+' SET enabled=false WHERE '+key+"='first';");check(prepare+' IS NULL','revoked '+table);run('UPDATE character_production.'+table+' SET enabled=true WHERE '+key+"='first';")
 for label,args in [('sha',{'sha':"repeat('e',64)"}),('size',{'size':'101'}),('promo',{'pid':quote(promo(2))+'::uuid'}),('microsecond',{'stamp':"(m->>'expectedUpdatedAt')::timestamptz+interval '1 microsecond'"}),('bucket',{'bucket':"'wrong'"}),('path',{'path':"'wrong'"})]:
  run('DO $$ DECLARE m jsonb:='+prepare+'; BEGIN IF '+commit(**args)+' THEN RAISE EXCEPTION '+quote('wrong '+label+' accepted')+'; END IF; END $$;')
 run('DO $$ DECLARE m jsonb:='+prepare+"; BEGIN UPDATE character_production.qa_targets SET promo_id="+quote(promo(2))+" WHERE job_key='first'; IF "+commit()+" THEN RAISE EXCEPTION 'prepared target changed'; END IF; UPDATE character_production.qa_targets SET promo_id="+quote(promo(1))+" WHERE job_key='first'; UPDATE public.cs_character_promo_drafts SET updated_at=updated_at+interval '1 microsecond' WHERE id="+quote(promo(1))+"; IF "+commit()+" THEN RAISE EXCEPTION 'stale timestamp accepted'; END IF; UPDATE public.cs_character_promo_drafts SET updated_at=(m->>'expectedUpdatedAt')::timestamptz WHERE id="+quote(promo(1))+"; IF NOT "+commit()+' OR NOT '+commit()+" THEN RAISE EXCEPTION 'commit/idempotence failed'; END IF; END $$;")
 check(prepare+"->>'state'='committed'",'receipt reconcile')
 check("(SELECT count(*)=1 FROM character_production.qa_ingestion_receipts)",'single receipt')
 check("NOT EXISTS(SELECT 1 FROM public.cs_character_promo_drafts WHERE status!='draft' OR audio_asset_path IS NOT NULL OR voice_approved_at IS NOT NULL OR video_qa_approved_at IS NOT NULL OR publication_approved_at IS NOT NULL)",'no approval publication changes')
 check("public.character_production_qa_pending(5)='[]'::jsonb",'receipted queue omission')
 for n in range(10,17): qa_fixture('queue-'+str(n),n)
 for limit,count in [(999,5),(1,1),(0,0),(-1,0)]: check('jsonb_array_length(public.character_production_qa_pending('+str(limit)+'))='+str(count),'bounded queue')
 run("UPDATE character_production.qa_targets SET enabled=false WHERE job_key LIKE 'queue-%';");check("public.character_production_qa_pending(5)='[]'::jsonb",'disabled targets omitted')
 run('BEGIN ISOLATION LEVEL REPEATABLE READ; DO $$ BEGIN IF '+prepare+" IS NOT NULL THEN RAISE EXCEPTION 'stale isolation accepted'; END IF; END $$; COMMIT;")
 finish('qa')
if __name__=='__main__': suite()
