"""Disposable PG17 only: real planner/selection chain, no live credentials."""
import copy,hashlib,json,subprocess,time,concurrent.futures
import validate_ledger as db
import validate_planner as planner
import validate_planner_install as foundation
from validate_enrolled_reads_install import verbatim_run

def suite():
 foundation.suite()
 for name in ['character-production-scheduler-principal.sql','character-production-recurring-selection.sql','character-production-binding-snapshots.sql']:
  source=(db.ROOT/'docs/proposals'/name).read_text()
  db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; '+source)
  if source.rstrip().endswith('ROLLBACK;'):
   db.run('SET ROLE character_production_owner; '+source.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner')
 for role in ['anon','authenticated','service_role']:
  db.check('NOT has_table_privilege('+db.quote(role)+",'character_production.binding_snapshots','SELECT,INSERT,UPDATE,DELETE')",'owner-only snapshots')
  for sig in ['public.character_production_plan_bound(jsonb,text,jsonb,uuid,bigint,uuid,text)','public.character_production_selected_binding(uuid,uuid)']:
   db.check('NOT has_function_privilege('+db.quote(role)+','+db.quote(sig)+",'EXECUTE')",'no runtime grant')
 s,d,p=planner.fixture('bound-original',1)
 q=lambda x:db.quote(json.dumps(x,separators=(',',':')))+'::jsonb'
 own=lambda sql:db.run('SET ROLE character_production_owner; '+sql)
 snap=json.dumps({'version':1,'account':{'model':'avatar_iv'},'image':{'characterId':s['characterId'],'canonicalRevision':s['canonicalRevision'],'portraitSha256':s['portraitSha256'],'audio':{'audioSha256':'b'*64,'voiceId':s['voiceId'],'scriptSha256':hashlib.sha256(s['script'].encode()).hexdigest()}},'speech':{'fixture':'SQL-only; TS binding tests validate full media proof'}},separators=(',',':'))
 digest=hashlib.sha256(snap.encode()).hexdigest();p['validation']['evidenceRef']='binding-snapshot-sha256:'+digest
 p['scheduledAt']=db.run("SELECT to_char(clock_timestamp()+interval '3 seconds','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")
 db.run("INSERT INTO character_production.budgets(provider,period,cap_cents,reserved_cents,enabled) VALUES('heygen',"+db.quote(s['period'])+",2000,0,true) ON CONFLICT(provider,period) DO UPDATE SET cap_cents=2000,enabled=true")
 db.run("INSERT INTO character_production.planning_policies VALUES('"+planner.POL+"',1,true,'{\"evidenceRef\":\"synthetic:snapshot\"}',"+db.quote(s['period'])+",to_timestamp("+str(s['authorizationExpiresAt'])+"/1000.0),ARRAY['synthetic-persona'],ARRAY['synthetic-theme'],31,45,2000,'d61468fdf18c4b478f27857337ddd1ea')")
 call=lambda text:'public.character_production_plan_bound('+','.join([q(s),db.quote(d),q(p),db.quote(planner.POL)+'::uuid','1',db.quote(planner.ACT)+'::uuid',db.quote(text)])+')'
 own('BEGIN; SELECT '+call(snap)+'; ROLLBACK;')
 db.check("NOT EXISTS(SELECT 1 FROM character_production.binding_snapshots) AND NOT EXISTS(SELECT 1 FROM character_production.planning_records)",'planner and snapshot roll back together')
 result=json.loads(own('SELECT '+call(snap)));assert result['snapshotSha256']==digest and result['replayed'] is False
 assert json.loads(own('SELECT '+call(snap)))['replayed'] is True
 assert own('SELECT '+call(snap+' '))==''
 failed=subprocess.run(db.command(),input="SET ROLE character_production_owner; UPDATE character_production.binding_snapshots SET snapshot_text=snapshot_text||' ';",text=True,capture_output=True)
 assert failed.returncode and 'immutable' in failed.stderr
 e='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
 candidates=[dict(ordinal=0,slot=s,digest=d,draftId=p['draftId'],theme=p['theme'],scheduledAt=p['scheduledAt'])]
 db.run("INSERT INTO character_production.scheduler_enrollments SELECT '"+e+"',id,revision,'"+planner.ACT+"',to_jsonb(pol),"+q(candidates)+",repeat('d',64),'synthetic:snapshot',clock_timestamp()-interval '1 minute',expires_at,true FROM character_production.planning_policies pol WHERE id='"+planner.POL+"'; INSERT INTO character_production.scheduler_candidates VALUES('"+e+"',0,"+q(s)+","+db.quote(d)+",'"+p['draftId']+"','synthetic-theme',"+db.quote(p['scheduledAt'])+"); INSERT INTO character_production.scheduler_binding VALUES('cafe-character-planner','"+e+"',true)")
 time.sleep(3.1)
 selected=json.loads(own("SELECT public.character_production_recurring_next('"+e+"')"));assert selected['phase']=='generate'
 read=lambda token:own("SELECT public.character_production_selected_binding('"+e+"','"+token+"')")
 observed=json.loads(read(selected['selectionToken']));assert observed['slot']==s and observed['snapshotText']==snap
 assert read('ffffffff-ffff-4fff-8fff-ffffffffffff')==''
 db.run("INSERT INTO character_production.jobs(key,slot,digest,provider,model,period,provider_binding_revision,cost,state,task) VALUES("+db.quote(s['key'])+","+q(s)+","+db.quote(d)+",'heygen','avatar_iv',"+db.quote(s['period'])+","+db.quote(s['providerBindingRevision'])+",1,'submitted','original-provider-task')")
 assert read(selected['selectionToken'])==''
 collect=json.loads(own("SELECT public.character_production_recurring_next('"+e+"')"));assert collect['phase']=='collect'
 observed=json.loads(read(collect['selectionToken']));assert observed['selected']['payload']['taskId']=='original-provider-task' and observed['snapshotText']==snap and observed['slot']==s
 # Existing selected authority transitions from original collection into QA.
 db.run("UPDATE character_production.jobs SET state='pending_qa',sha=repeat('a',64),bytes=100,bucket='character-production-private',object_path=digest||'/'||repeat('a',64)||'.mp4' WHERE key="+db.quote(s['key']))
 assert read(collect['selectionToken'])==''
 qa=json.loads(own("SELECT public.character_production_recurring_next('"+e+"')"));assert qa['phase']=='qa'
 observed=json.loads(read(qa['selectionToken']));assert observed['selected']['payload']=={'key':s['key'],'digest':d} and observed['slot']==s and observed['snapshotText']==snap
 assert read('ffffffff-ffff-4fff-8fff-ffffffffffff')==''
 db.run("BEGIN; UPDATE public.cs_character_promo_drafts SET spoken_script='Changed fixture' WHERE id="+db.quote(p['draftId'])+"; SET ROLE character_production_owner; DO $$ BEGIN IF public.character_production_selected_binding('"+e+"','"+qa['selectionToken']+"') IS NOT NULL THEN RAISE EXCEPTION 'changed draft accepted'; END IF; END $$; ROLLBACK;")
 # Technical receipt contract fixture; media/provider values are synthetic,
 # not a real codec or full TypeScript-approved BindingSnapshot.
 source=(db.ROOT/'docs/proposals/character-production-technical-receipts.sql').read_text()
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner')
 own(source)
 own(source.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner')
 for role in ['anon','authenticated','service_role']:
  db.check('NOT has_table_privilege('+db.quote(role)+",'character_production.technical_receipts','SELECT,INSERT,UPDATE,DELETE')",'private technical receipts')
  for sig in ['public.character_production_technical_qa_claim(uuid,uuid,timestamptz,uuid)','public.character_production_technical_qa_record(uuid,uuid,timestamptz,uuid,text)','public.character_production_technical_qa_receipt(uuid,uuid)']:
   db.check('NOT has_function_privilege('+db.quote(role)+','+db.quote(sig)+",'EXECUTE')",'no runtime grants')
 own('SELECT public.character_production_qa_materialize('+db.quote(s['key'])+','+db.quote(d)+')')
 m=json.loads(own('SELECT public.character_production_qa_prepare('+db.quote(s['key'])+','+db.quote(d)+')'))
 checks={k:'needs_review' for k in ['canonical_speech','canonical_likeness','lip_sync','visual_text','rights','brand_safety','third_party_watermark']};checks.update(mp4_integrity='pass',duration='pass')
 ev=dict(version=1,videoSha256='a'*64,audioSha256='b'*64,snapshotSha256=digest,actualDurationSeconds=8.2,audioDurationSeconds=8.2,decodedAudioIdentical=True,pcmHashes=['SHA256='+'c'*64]*2,checks=checks,qaApproved=False,publicationApproved=False,evaluator=dict(kind='bounded-native-codec',version=1,ffmpegSha256='d'*64,ffprobeSha256='e'*64,ffmpegVersion='synthetic ffmpeg',ffprobeVersion='synthetic ffprobe'),observedAt=db.run("SELECT to_char(clock_timestamp(),'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')"))
 raw=lambda v:json.dumps(v,separators=(',',':'))
 claim_id='11111111-1111-4111-8111-111111111111'
 write=lambda v,t=qa['selectionToken'],rev=m['expectedUpdatedAt'],claim=claim_id:'SELECT public.character_production_technical_qa_record('+db.quote(e)+','+db.quote(t)+','+db.quote(rev)+'::timestamptz,'+db.quote(claim)+','+db.quote(raw(v))+')'
 receipt=lambda token:own('SELECT public.character_production_technical_qa_receipt('+db.quote(e)+','+db.quote(token)+')')
 before=db.run('SELECT row_to_json(d)::text FROM public.cs_character_promo_drafts d WHERE id='+db.quote(p['draftId']))
 for key,value in [('audioSha256','f'*64),('snapshotSha256','f'*64),('videoSha256','f'*64),('qaApproved',True),('actualDurationSeconds',7.99)]:
  bad=copy.deepcopy(ev);bad[key]=value;assert own(write(bad))==''
 bad=copy.deepcopy(ev);bad['checks']['third_party_watermark']='pass';assert own(write(bad))==''
 assert own(write(ev,'ffffffff-ffff-4fff-8fff-ffffffffffff'))==''
 assert own(write(ev,rev='2000-01-01T00:00:00Z'))==''
 # No record may precede the durable consumed attempt.
 assert own(write(ev))==''
 claim_sql=lambda c,t=qa['selectionToken'],rev=m['expectedUpdatedAt']:'SELECT public.character_production_technical_qa_claim('+db.quote(e)+','+db.quote(t)+','+db.quote(rev)+'::timestamptz,'+db.quote(c)+')'
 assert own(claim_sql(claim_id,rev='2000-01-01T00:00:00Z'))==''
 assert own(claim_sql(claim_id,t='ffffffff-ffff-4fff-8fff-ffffffffffff'))==''
 # Two independent PostgreSQL sessions contend on the actual locked parent.
 def concurrent_claim(c):
  proc=subprocess.run(db.command(),input='SET ROLE character_production_owner; '+claim_sql(c)+';',text=True,capture_output=True)
  assert proc.returncode==0,proc.stderr
  lines=[line for line in proc.stdout.splitlines() if line.startswith('{')]
  assert len(lines)==1,proc.stdout
  return json.loads(lines[0])
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  outcomes=list(pool.map(concurrent_claim,[claim_id,'22222222-2222-4222-8222-222222222222']))
 assert sorted(x['claimed'] for x in outcomes)==[False,True]
 claim_id=next(x['claimId'] for x in outcomes if x['claimed'])
 # Bind winner explicitly (default arguments of prior lambda were captured).
 original_write=write
 write=lambda v,t=qa['selectionToken'],rev=m['expectedUpdatedAt'],claim=claim_id:original_write(v,t,rev,claim)
 for key,value in [('audioSha256','f'*64),('snapshotSha256','f'*64),('videoSha256','f'*64),('qaApproved',True),('actualDurationSeconds',7.99)]:
  bad=copy.deepcopy(ev);bad[key]=value;assert own(write(bad))==''
 bad=copy.deepcopy(ev);bad['checks']['third_party_watermark']='pass';assert own(write(bad))==''
 again=json.loads(own(claim_sql(claim_id)));assert again['claimed'] is False and again['claimId']==claim_id
 assert own(write(ev,claim='33333333-3333-4333-8333-333333333333'))==''
 assert own(write(ev,t='ffffffff-ffff-4fff-8fff-ffffffffffff'))==''
 assert own(write(ev,rev='2000-01-01T00:00:00Z'))==''
 own('BEGIN; '+write(ev)+'; ROLLBACK;')
 db.check('(SELECT count(*) FROM character_production.technical_attempts)=1','claim retained after absent/rolled back receipt')

 db.check('NOT EXISTS(SELECT 1 FROM character_production.technical_receipts)','receipt rollback')
 result=json.loads(own(write(ev)));assert result==dict(evidenceText=raw(ev),evidenceSha256=hashlib.sha256(raw(ev).encode()).hexdigest(),promoId=p['draftId'],videoSha256='a'*64)
 assert json.loads(own(write(ev)))==result
 bad=copy.deepcopy(ev);bad['actualDurationSeconds']=8.3;assert own(write(bad))==''
 assert json.loads(receipt(qa['selectionToken']))==result
 # Fixture-only alternate current token exercises read-only fallback; no
 # runtime retry/reset path is created or authorized by this synthetic change.
 later='44444444-4444-4444-8444-444444444444'
 original_token=qa['selectionToken']
 db.run("UPDATE character_production.recurring_selections SET token="+db.quote(later)+" WHERE enrollment_id="+db.quote(e)+" AND phase='qa'")
 assert json.loads(receipt(later))==result
 assert json.loads(own(claim_sql('55555555-5555-4555-8555-555555555555',t=later)))['claimed'] is False
 assert own(write(ev,t=later))==''
 db.run("UPDATE character_production.recurring_selections SET token="+db.quote(original_token)+" WHERE enrollment_id="+db.quote(e)+" AND phase='qa'")
 assert db.run('SELECT row_to_json(d)::text FROM public.cs_character_promo_drafts d WHERE id='+db.quote(p['draftId']))==before
 failed=subprocess.run(db.command(),input='SET ROLE character_production_owner; UPDATE character_production.technical_receipts SET evidence_text=evidence_text;',text=True,capture_output=True);assert failed.returncode and 'immutable' in failed.stderr
 db.run("UPDATE character_production.scheduler_binding SET enabled=false")
 assert own(write(ev))==''
 assert json.loads(receipt(qa['selectionToken']))==result
 assert receipt('ffffffff-ffff-4fff-8fff-ffffffffffff')==''
 failed=subprocess.run(db.command(),input='SET ROLE character_production_owner; DELETE FROM character_production.technical_attempts;',text=True,capture_output=True);assert failed.returncode and 'immutable' in failed.stderr
 db.finish('technical-receipts')
if __name__=='__main__':
 original=db.run;db.run=verbatim_run
 try:suite()
 finally:db.run=original
