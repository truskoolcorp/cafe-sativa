"""Isolated PG17 first-admission contract. Synthetic media proofs, no providers.
Real text/preparation/planner/scheduler functions; never install into live DB.
"""
import concurrent.futures,copy,hashlib,json,subprocess
import validate_ledger as db
import validate_planner_install as foundation
from validate_enrolled_reads_install import verbatim_run
q=db.quote
L='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';P='77777777-7777-4777-8777-777777777777';ACT='88888888-8888-4888-8888-888888888888'
CTX='public.character_production_first_admission_context()'
raw=lambda x:json.dumps(x,separators=(',',':'),ensure_ascii=False)
sha=lambda s:hashlib.sha256(s.encode()).hexdigest()
hasharray=lambda x:sha(raw(x))
def owner(s):return db.run('SET ROLE character_production_owner; '+s).strip()
def context():
 s=owner('SELECT '+CTX);return json.loads(s) if s else None
def fail(s,label):
 p=subprocess.run(db.command(),input=s,text=True,capture_output=True);assert p.returncode and label in p.stderr,p.stderr

def suite():
 foundation.suite();auth=foundation.auth_snapshot()
 db.check("current_setting('server_version_num')::integer BETWEEN 170000 AND 179999",'PG17')
 for name,table in [('character-production-replenishment.sql','text_replenishment_attempts'),('character-production-fresh-speech-source.sql','included_speech_scopes'),('character-production-preparation-context.sql','preparation_lanes'),('character-production-scheduler-principal.sql','scheduler_enrollments'),('character-production-first-admission.sql','first_admission_config')]:
  source=(db.ROOT/'docs/proposals'/name).read_text();assert source.rstrip().endswith(('ROLLBACK;','COMMIT;'))
  tail='ROLLBACK;' if source.rstrip().endswith('ROLLBACK;') else 'COMMIT;'
  db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; '+source.rsplit(tail,1)[0]+'ROLLBACK;')
  db.check("to_regclass('character_production."+table+"') IS NULL",'proposal rollback')
  owner(source.rsplit(tail,1)[0]+'COMMIT;')
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner;')
 for role in ['anon','authenticated','service_role']:
  for sig in ['character_production_first_admission_context()','character_production_first_admit(uuid,text)']:
   db.check('NOT has_function_privilege('+q(role)+','+q('public.'+sig)+",'EXECUTE')",'no runtime admission grant')
  for table in ['first_admission_config','first_admission_records']:
   db.check('NOT has_table_privilege('+q(role)+','+q('character_production.'+table)+",'SELECT,INSERT,UPDATE,DELETE')",'no runtime source table grant')
 assert context() is None
 clock=json.loads(db.run("SELECT jsonb_build_object('period',to_char(clock_timestamp() AT TIME ZONE 'America/Chicago','YYYY-MM'),'now',floor(extract(epoch FROM clock_timestamp())*1000)::bigint,'expiry',floor(extract(epoch FROM (date_trunc('month',clock_timestamp() AT TIME ZONE 'America/Chicago')+interval '1 month') AT TIME ZONE 'America/Chicago')*1000)::bigint)"))
 owner("INSERT INTO character_production.text_replenishment_budgets(id,period,model,input_micro_usd,output_micro_usd,max_cost_cents,cap_cents,rate_evidence,expires_at,enabled) VALUES('"+B+"',"+q(clock['period'])+",'claude-haiku-4-5-20251001',1,3,10,20,'synthetic:rate',date_trunc('milliseconds',clock_timestamp()+interval '1 hour'),true);")
 owner("INSERT INTO character_production.preparation_lanes(id,actor_id,reference,owner_message_ids,source_scope,budget_id,authorized_at,expires_at,enabled) VALUES('"+L+"','"+ACT+"','synthetic:first',ARRAY['Sentinel_"+'a'*32+"'],'{\"characterId\":\"zaria-solenne\",\"roomKey\":\"gallery\"}','"+B+"',clock_timestamp()-interval '1 minute',date_trunc('milliseconds',clock_timestamp()+interval '1 hour'),true); INSERT INTO character_production.preparation_binding VALUES('zaria-gallery-preparation','"+L+"');")
 db.run("INSERT INTO character_production.budgets(provider,period,cap_cents,reserved_cents,enabled) VALUES('heygen',"+q(clock['period'])+",2000,35,true) ON CONFLICT(provider,period) DO UPDATE SET cap_cents=2000;")
 owner("INSERT INTO character_production.planning_policies VALUES('"+P+"',1,true,'{\"evidenceRef\":\"synthetic:first-owner\"}',"+q(clock['period'])+",to_timestamp("+str(clock['expiry'])+"/1000.0),ARRAY['zaria-solenne'],ARRAY['gallery-art'],1,45,2000,'d61468fdf18c4b478f27857337ddd1ea');")
 image={'avatarId':'fixture-avatar','canonicalRevision':'b'*64,'portraitSha256':'c'*64,'imageBytes':12,'mime':'image/png'}
 account={'linkId':'fixture-link','model':'avatar_iv','aspectRatio':'16:9','expectedUsername':'d61468fdf18c4b478f27857337ddd1ea'}
 quote={'cents':35,'durationSeconds':8,'observedAt':clock['now'],'expiresAt':clock['now']+3600000,'evidenceRef':'synthetic:quote'}
 owner("INSERT INTO character_production.first_admission_config SELECT '"+L+"',id,revision,to_jsonb(p),'gallery-art',"+q(raw(image))+"::jsonb,"+q(raw(account))+"::jsonb,"+q(raw(quote))+"::jsonb,'synthetic:rights',true FROM character_production.planning_policies p WHERE id='"+P+"';")
 # Explicit synthetic historical original rows (not timestamp mutation of
 # today's task) exercise retained prior-day identity with current video scope.
 # The actual text-save RPC supplies identity; no old paid claim is retried.
 historical="""DO $$ DECLARE tok uuid; o uuid; c jsonb; k text:='daily:2000-01-01:zaria-solenne'; BEGIN
 INSERT INTO character_production.preparation_occurrences(lane_id,text_key,text_started,created_at) VALUES('"""+L+"""',k,true,'2000-01-01T12:00:00Z') RETURNING id INTO o;
 INSERT INTO character_production.text_replenishment_attempts(key,budget_id,source_snapshot,source_digest,created_at) VALUES(k,'"""+B+"""',jsonb_build_object('characterId','zaria-solenne','roomKey','gallery','voiceId','5zneNR4v1Uw5AjIZ9Un4','canonicalRevision',repeat('b',64),'portraitSha256',repeat('c',64)),repeat('a',64),'2000-01-01T12:00:01Z') RETURNING token INTO tok;
 IF NOT public.character_production_text_save(k,tok,repeat('a',64),'{"spokenScript":"Synthetic historical original"}','synthetic:historical',100,20) THEN RAISE EXCEPTION 'historical save absent'; END IF;
 c:=public.character_production_first_admission_context();
 IF c IS NULL OR c->'active' IS DISTINCT FROM 'true'::jsonb OR c#>>'{identity,textAttemptKey}' IS DISTINCT FROM k OR c#>>'{identity,textAttemptToken}' IS DISTINCT FROM tok::text THEN RAISE EXCEPTION 'current video authority cannot use original prior-day identity'; END IF;
 UPDATE character_production.preparation_lanes SET enabled=false;
 c:=public.character_production_first_admission_context();
 IF c->'active' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'expired original lane renewed'; END IF;
 END $$;"""
 db.run('BEGIN; SET ROLE character_production_owner; '+historical+' ROLLBACK;')
 prep=json.loads(owner('SELECT public.character_production_preparation_context()'));occ=prep['occurrenceId'];key=prep['textKey']
 assert owner("SELECT public.character_production_preparation_claim('"+occ+"','text')")=='t'
 tsource={'characterId':'zaria-solenne','roomKey':'gallery','voiceId':'5zneNR4v1Uw5AjIZ9Un4','canonicalRevision':'b'*64,'portraitSha256':'c'*64};lease=prep['lease'];script='Look closely. What detail changes the way you see this work?'
 token=owner("SELECT public.character_production_text_claim("+','.join([q(key),q('a'*64),q(raw(tsource))+'::jsonb',q(B),q(lease['period']),'10','20',q(lease['rateEvidence']),str(lease['expiresAt']),'1','3'])+")");assert token
 assert owner("SELECT public.character_production_text_save("+','.join([q(key),q(token),q('a'*64),q(raw({'spokenScript':script}))+'::jsonb',q('synthetic:receipt'),'100','20'])+")")=='t'
 def contender(fn):
  try:return fn()
  except RuntimeError as e:
   if 'could not obtain lock' not in str(e):raise
   return None
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: cs=list(pool.map(lambda _:contender(context),range(2)))
 assert any(cs),cs
 ctx=context();assert ctx and all(x is None or x==ctx for x in cs) and ctx['active'] is True and ctx['accepted'] is None
 assert ctx['occurrenceId']==occ and ctx['identity']['textAttemptToken']==token
 # Synthetic native proof mirrors existing verified binding shapes, not evidence
 # that a provider produced audio. The trusted JS layer must verify real bytes.
 audio={'characterId':'zaria-solenne','avatarId':image['avatarId'],'voiceId':tsource['voiceId'],'voiceModel':'eleven_multilingual_v2','canonicalRevision':image['canonicalRevision'],'portraitSha256':image['portraitSha256'],'scriptSha256':sha(script),'audioSha256':'d'*64,'audioBytes':12,'mime':'audio/mpeg','provider':'elevenlabs','synthesisReceiptId':'fixture-receipt'}
 ad=hasharray(['rendered-audio-v1',*[audio[k] for k in ['characterId','avatarId','voiceId','voiceModel','canonicalRevision','portraitSha256','scriptSha256','audioSha256','audioBytes','mime','provider','synthesisReceiptId']]])
 img={k:v for k,v in image.items() if k!='avatarId'};img.update(characterId='zaria-solenne',audio=audio)
 imd=hasharray(['canonical-image-v1','zaria-solenne',image['canonicalRevision'],image['portraitSha256'],image['imageBytes'],image['mime'],ad])
 bd=hasharray(['heygen-avatar-binding-v1','heygen',account['linkId'],'avatar_iv','zaria-solenne',image['canonicalRevision'],image['portraitSha256'],audio['voiceId'],audio['avatarId'],account['aspectRatio'],'mp4','1080p','rendered-audio-v1',ad,'canonical-image-v1',imd])
 slot=dict(key='first:'+occ,characterId='zaria-solenne',script=script,canonicalRevision=image['canonicalRevision'],voiceId=audio['voiceId'],portraitSha256=image['portraitSha256'],provider='heygen',model='avatar_iv',durationSeconds=quote['durationSeconds'],authorizationId='first:'+occ,authorizationExpiresAt=ctx['expiresAt'],period=ctx['period'],quoteCents=quote['cents'],periodCapCents=ctx['capCents'],providerBindingRevision=bd)
 snapshot={'version':1,'account':account,'image':img,'speech':{'key':'fresh-zaria-'+hasharray([key,token,sha(script)]),'claimSha256':'e'*64,'receiptSha256':'f'*64,'scopeId':L,'textAttemptKey':key,'textAttemptToken':token,'textSourceDigest':'a'*64}}
 manifest={'enabled':True,'deadlineMs':30000,'heygen':{k:v for k,v in account.items() if k!='expectedUsername'},'expectedUsername':account['expectedUsername'],'images':[{'image':img,'snapshotText':raw(snapshot),'themes':['gallery-art'],'rightsEvidenceRef':'synthetic:rights','quoteEvidenceRef':quote['evidenceRef'],'quoteCents':quote['cents'],'durationSeconds':quote['durationSeconds'],'quoteObservedAt':quote['observedAt'],'quoteExpiresAt':quote['expiresAt']}],'candidates':[{'slot':slot,'draftId':ctx['draftId'],'scheduledAt':ctx['generationAt'],'theme':'gallery-art','policyId':P,'policyRevision':1}]}
 serialized=raw(manifest)
 def admit(m=serialized,oid=occ):return owner('SELECT public.character_production_first_admit('+q(oid)+','+q(m)+')')
 for mutate in [lambda m:m['candidates'][0]['slot'].update(script='Wrong script'),lambda m:m['candidates'][0].update(policyId=L),lambda m:m['candidates'][0].update(draftId=L),lambda m:m['images'][0].update(quoteCents=1),lambda m:m.update(expectedUsername='wrong')]:
  bad=copy.deepcopy(manifest);mutate(bad);assert admit(raw(bad))==''
 # No existing scheduler enrollment or dormant binding may be overwritten.
 db.run("BEGIN; SET ROLE character_production_owner; INSERT INTO character_production.scheduler_enrollments VALUES('"+L+"','"+P+"',1,'"+ACT+"','{}','[{}]',repeat('a',64),'synthetic:prior',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',false); INSERT INTO character_production.scheduler_binding VALUES('cafe-character-planner','"+L+"',false); DO $$ BEGIN IF public.character_production_first_admit('"+occ+"',"+q(serialized)+") IS NOT NULL THEN RAISE EXCEPTION 'retargeted existing enrollment'; END IF; END $$; ROLLBACK;")
 paid=lambda:db.run("SELECT jsonb_build_object('jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY key) FROM character_production.jobs j),'budgets',(SELECT jsonb_agg(to_jsonb(b) ORDER BY provider,period) FROM character_production.budgets b))")
 before=paid()
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(lambda _:contender(admit),range(2)))
 assert any(results),results
 receipts=[json.loads(x) for x in results if x is not None]
 receipts.append(json.loads(admit()));assert receipts[0]==receipts[1] and receipts[0]['manifest']==serialized and receipts[0]['id']==ctx['enrollmentId']
 assert context()['accepted']['manifest']==serialized and admit(serialized+' ')==''
 db.check('(SELECT count(*)=1 FROM character_production.scheduler_enrollments)','exactly one enrollment')
 db.check('(SELECT count(*)=1 FROM character_production.scheduler_candidates)','exactly one candidate')
 assert before==paid(),'admission cannot reserve HeyGen funds or create provider jobs'
 assert json.loads(owner("SELECT public.character_production_scheduler_context('"+ctx['enrollmentId']+"')"))['manifestSha256']==sha(serialized)
 digest=hasharray(list(slot.values()))
 validation={'brand':'cafe-sativa','accountId':account['expectedUsername'],'slotDigest':digest,'canonicalRevision':slot['canonicalRevision'],'providerBindingRevision':bd,'theme':'gallery-art','rightsApproved':True,'sourceBound':True,'evidenceRef':'synthetic:fixture-only','observedAt':db.run("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")}
 # Existing scoped planner executes after admission. Synthetic validation is
 # confined to this disposable fixture, never fabricated production approval.
 planned=owner("SELECT public.character_production_scheduler_plan('"+ctx['enrollmentId']+"',0,"+q(raw(validation))+"::jsonb)");assert planned
 assert json.loads(planned)['draftId']==ctx['draftId'] and before==paid()
 fail("SET ROLE character_production_owner; UPDATE character_production.first_admission_records SET generation_at=generation_at+interval '1 minute';",'immutable')
 fail("SET ROLE character_production_owner; UPDATE character_production.first_admission_config SET quote='{}';",'immutable')
 # Unrelated enrollment is deliberately not current; revocation must leave it
 # untouched rather than disabling all scheduler authority.
 owner("INSERT INTO character_production.scheduler_enrollments VALUES('"+L+"','"+P+"',1,'"+ACT+"','{}','[{}]',repeat('a',64),'synthetic:unrelated',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',true)")
 for mutation in ["UPDATE character_production.preparation_lanes SET enabled=false WHERE id='"+L+"';", "UPDATE character_production.first_admission_config SET enabled=false WHERE lane_id='"+L+"';"]:
  db.run("BEGIN; SET ROLE character_production_owner; "+mutation+" DO $$ BEGIN IF character_production.scheduler_current('"+ctx['enrollmentId']+"') IS NOT NULL OR EXISTS(SELECT 1 FROM character_production.approved_slots WHERE key="+q(slot['key'])+" AND enabled) OR NOT EXISTS(SELECT 1 FROM character_production.scheduler_enrollments WHERE id='"+L+"' AND enabled) THEN RAISE EXCEPTION 'revocation containment failure'; END IF; END $$; ROLLBACK;")
 owner('UPDATE character_production.first_admission_config SET enabled=false')
 assert context()['active'] is False and context()['accepted']['manifest']==serialized
 assert json.loads(admit())['currentAuthority'] is False
 assert foundation.auth_snapshot()==auth,'no auth changes'
 db.finish('first-admission')
if __name__=='__main__':
 original=db.run;db.run=verbatim_run
 try:suite()
 finally:db.run=original
