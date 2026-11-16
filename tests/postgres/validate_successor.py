"""Disposable PG17 succession with actual SQL foundations and receipt RPCs.
Historical rows and media/provider observations are synthetic fixture-only values.
No provider calls, clock replacement, original-row reset or production writes.
"""
import inspect,textwrap,json,hashlib,uuid
import validate_ledger as db
import validate_first_admission as first
import validate_cafe_publication_reconciliation as reconciliation
from validate_enrolled_reads_install import verbatim_run
q=db.quote
j=lambda v:q(json.dumps(v,separators=(',',':')))+'::jsonb'
S='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
RPC='public.character_production_successor_context()'

def exercise(state):
 owner=first.owner;ctx=state['ctx'];occ=state['occ'];L=first.L;P=first.P
 # Reuse exact existing disposable store scaffolding, not a terminal stub.
 setup=inspect.getsource(reconciliation.setup)
 start=setup.index(' db.run("DROP SCHEMA cafe_metricool_private CASCADE;')
 end=setup.index(' auth_before=foundation.auth_snapshot()')
 exec(textwrap.dedent(setup[start:end]),reconciliation.__dict__)
 source=(db.ROOT/'docs/proposals/cafe-publication-reconciliation.sql').read_text()
 db.run('GRANT CREATE ON SCHEMA public TO cafe_metricool_owner; SET ROLE cafe_metricool_owner; '+source.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run('REVOKE CREATE ON SCHEMA public FROM cafe_metricool_owner;')
 proposal=(db.ROOT/'docs/proposals/character-production-successor.sql').read_text()
 assert proposal.rstrip().endswith('ROLLBACK;')
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; '+proposal)
 db.check("to_regclass('character_production.successor_standing') IS NULL",'successor rollback')
 owner(proposal.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner;')
 for role in ['anon','authenticated','service_role']:
  db.check('NOT has_function_privilege('+q(role)+','+q('public.character_production_successor_context()')+",'EXECUTE')",'no runtime successor capability')
  for table in ['successor_standing','successor_edges']:
   db.check('NOT has_table_privilege('+q(role)+','+q('character_production.'+table)+",'SELECT,INSERT,UPDATE,DELETE')",'no successor table exposure')
 owner("INSERT INTO character_production.successor_standing SELECT '"+S+"',l.id,to_jsonb(l),to_jsonb(c),ARRAY['Sentinel_"+'a'*32+"'],clock_timestamp()-interval '1 minute',clock_timestamp()+interval '45 minutes',true FROM character_production.preparation_lanes l JOIN character_production.first_admission_config c ON c.lane_id=l.id WHERE l.id='"+L+"'")
 advance=lambda:owner('SELECT '+RPC)
 assert advance()=='' # no cross-owner grant, no inferred publication
 db.check('NOT EXISTS(SELECT 1 FROM character_production.successor_edges)','no grant cannot advance')
 # Capability exists ONLY in disposable fixture, never in proposal.
 db.run('GRANT EXECUTE ON FUNCTION public.cs_cafe_publication_terminal(uuid) TO character_production_owner;')
 assert advance()==''
 schedule=db.run("SELECT to_char(clock_timestamp()-interval '1 minute','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")
 localdate=db.run('SELECT to_char('+q(schedule)+"::timestamptz AT TIME ZONE 'America/Chicago','YYYY-MM-DD\"T\"HH24:MI:SS')")
 plans=[str(uuid.uuid4()),str(uuid.uuid4())];tokens=[str(uuid.uuid4()),str(uuid.uuid4())]
 own=lambda s:db.run('SET ROLE cafe_metricool_owner; SELECT '+s)
 for n,(network,account) in enumerate([('facebook','105363501666032'),('instagram','cafesativainc')]):
  db.run("INSERT INTO public.cs_character_promo_delivery_plans(id,promo_id,character_id,network,account_id,scheduled_at,status,caption) VALUES("+q(plans[n])+','+q(ctx['draftId'])+",'zaria-solenne',"+q(network)+','+q(account)+','+q(schedule)+",'ready_for_delivery','Synthetic successor fixture')")
 # Both immutable plans must exist before either original attempt claims source.
 for n,(network,account) in enumerate([('facebook','105363501666032'),('instagram','cafesativainc')]):
  snapshot=dict(brandId='7605217',network=network,accountId=account,scheduledAt=schedule)
  db.run("INSERT INTO cafe_metricool_private.approvals VALUES("+q(plans[n])+','+j(snapshot)+",repeat('a',64),"+q(str(n+1)*64)+','+q(str(n+3)*64)+",'{}','"+first.ACT+"',clock_timestamp(),clock_timestamp()+interval '1 hour',false)")
  db.run("INSERT INTO cafe_metricool_private.attempts(plan_id,digest,destination_time_key,media_destination_key,token,state,provider_id,provider_uuid,receipt) VALUES("+q(plans[n])+",repeat('a',64),"+q(str(n+1)*64)+','+q(str(n+3)*64)+','+q(tokens[n])+",'scheduled',"+q('synthetic-'+str(n))+','+q('synthetic-uuid-'+str(n))+",'{}')")
 assert advance()=='','scheduled is not published'
 db.check("(SELECT enabled FROM character_production.scheduler_enrollments WHERE id='"+ctx['enrollmentId']+"')",'scheduled predecessor remains enabled')
 before=owner("SELECT to_jsonb(r)::text FROM character_production.first_admission_records r WHERE occurrence_id='"+occ+"'")
 for n in range(2):
  a=json.loads(own('public.cs_cafe_publication_attempt('+q(plans[n])+')'))
  url='https://www.facebook.com/reel/123456' if n==0 else 'https://www.instagram.com/reel/SyntheticSuccessor/'
  dest='123456' if n==0 else url
  evidence=dict(status='PUBLISHED',postId=a['providerId'],postUuid=a['providerUuid'],network=a['network'],destinationId=dest,publicUrl=url,brand='[7605217,4174093,"America/Chicago","105363501666032","cafesativainc"]',creatorUserId=4174093,publicationDate=dict(dateTime=localdate,timezone='America/Chicago'))
  text=json.dumps(evidence,separators=(',',':'))
  receipt=dict(a,version=1,brandId='7605217',destinationId=dest,publicUrl=url,observedAt=db.run('SELECT clock_timestamp()'),evidenceSha256=hashlib.sha256(text.encode()).hexdigest())
  assert own('public.cs_record_cafe_publication_receipt('+','.join([q(plans[n]),q(tokens[n]),q('a'*64),j(receipt),q(text)])+')')=='t'
  if n==0:
   assert advance()=='','missing Instagram holds'
   db.check("(SELECT enabled FROM character_production.scheduler_enrollments WHERE id='"+ctx['enrollmentId']+"')",'one-receipt predecessor remains enabled')
 assert own("public.cs_cafe_publication_terminal('ffffffff-ffff-4fff-8fff-ffffffffffff')")=='f'
 # Revoked standing must not transition. Transaction rollback preserves original.
 db.run("BEGIN; SET ROLE character_production_owner; UPDATE character_production.successor_standing SET enabled=false WHERE id='"+S+"'; DO $$ BEGIN IF "+RPC+" IS NOT NULL THEN RAISE EXCEPTION 'revoked succession'; END IF; END $$; ROLLBACK;")
 # A separate already allocated current-day history blocks before any new text.
 # Synthetic fixture record is inserted once and rolled back, never edited.
 db.run("BEGIN; SET ROLE character_production_owner; INSERT INTO character_production.approved_slots(key,slot,digest,enabled) SELECT 'synthetic:today-block',jsonb_set(slot,'{key}','\"synthetic:today-block\"'),digest,false FROM character_production.approved_slots WHERE key='first:"+occ+"'; INSERT INTO character_production.planning_records(slot_key,policy_id,policy_revision,digest,slot,plan,promo_id,scheduled_at,dallas_day,quote_cents) SELECT 'synthetic:today-block',policy_id,policy_revision,digest,jsonb_set(slot,'{key}','\"synthetic:today-block\"'),plan,gen_random_uuid(),clock_timestamp(),(clock_timestamp() AT TIME ZONE 'America/Chicago')::date,quote_cents FROM character_production.planning_records WHERE promo_id='"+ctx['draftId']+"'; DO $$ BEGIN IF "+RPC+" IS NOT NULL OR EXISTS(SELECT 1 FROM character_production.successor_edges) OR NOT EXISTS(SELECT 1 FROM character_production.scheduler_enrollments WHERE id='"+ctx['enrollmentId']+"' AND enabled) THEN RAISE EXCEPTION 'current day guard failed'; END IF; END $$; ROLLBACK;")
 result=json.loads(advance());assert result['status']=='successor_prepared' and result['priorOccurrenceId']==occ and result['occurrenceId']!=occ
 nextctx=result['context'];assert nextctx['occurrenceId']==result['occurrenceId'] and nextctx['identity'] is None and not nextctx['textStarted'] and not nextctx['speechStarted']
 assert nextctx['textKey']==owner("SELECT 'daily:'||to_char(clock_timestamp() AT TIME ZONE 'America/Chicago','YYYY-MM-DD')||':zaria-solenne'")
 db.check('(SELECT count(*)=1 FROM character_production.successor_edges)','one daily successor')
 again=json.loads(advance());assert again['status']=='current_occurrence' and again['context']['occurrenceId']==nextctx['occurrenceId']
 assert owner("SELECT to_jsonb(r)::text FROM character_production.first_admission_records r WHERE occurrence_id='"+occ+"'")==before,'original manifest retained'
 db.check("NOT (SELECT enabled FROM character_production.scheduler_enrollments WHERE id='"+ctx['enrollmentId']+"')",'old paid authority revoked only after positive pair')
 db.check("NOT EXISTS(SELECT 1 FROM character_production.approved_slots WHERE key='first:"+occ+"' AND enabled)",'old slot revoked')
 # First-admission predecessor exception is only for this exact generated lane.
 nextlane=owner("SELECT lane_id FROM character_production.preparation_occurrences WHERE id='"+nextctx['occurrenceId']+"'")
 assert owner("SELECT character_production.successor_admission_prior('"+nextlane+"')")=='t'
 assert owner("SELECT character_production.successor_admission_prior('"+L+"')")=='f'
 # Owner misconfiguration cannot choose arbitrarily between overlapping scopes.
 db.run("BEGIN; SET ROLE character_production_owner; INSERT INTO character_production.successor_standing SELECT 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',l.id,to_jsonb(l),to_jsonb(c),ARRAY['Sentinel_"+'b'*32+"'],clock_timestamp()-interval '1 minute',clock_timestamp()+interval '30 minutes',true FROM character_production.preparation_lanes l JOIN character_production.first_admission_config c ON c.lane_id=l.id WHERE l.id='"+nextlane+"'; DO $$ BEGIN IF "+RPC+" IS NOT NULL THEN RAISE EXCEPTION 'ambiguous standing selected'; END IF; END $$; ROLLBACK;")

 # Genuine second text claim/save, original manifest generation, first_admit
 # and scoped planner. Synthetic media proofs remain fixture-only.
 nextkey=nextctx['textKey'];newscript='Synthetic successor asks what detail catches your eye.';lease=nextctx['lease']
 assert owner("SELECT public.character_production_preparation_claim('"+nextctx['occurrenceId']+"','text')")=='t'
 token=owner("SELECT public.character_production_text_claim("+','.join([q(nextkey),q('a'*64),j(state['tsource']),q(first.B),q(lease['period']),'10','20',q(lease['rateEvidence']),str(lease['expiresAt']),'1','3'])+")");assert token
 assert owner("SELECT public.character_production_text_save("+','.join([q(nextkey),q(token),q('a'*64),j({'spokenScript':newscript}),q('synthetic:next-receipt'),'100','20'])+")")=='t'
 newctx=first.context();assert newctx['occurrenceId']==nextctx['occurrenceId'] and newctx['active'] is True
 prior_budget=owner("SELECT reserved_cents FROM character_production.budgets WHERE provider='heygen' AND period="+q(newctx['period']))
 code=inspect.getsource(first.suite)
 start=code.index(' # Synthetic native proof mirrors')
 end=code.index(' def admit(',start)
 env=dict(first.__dict__,**state);env.update(ctx=newctx,occ=nextctx['occurrenceId'],key=nextkey,token=token,script=newscript)
 exec(textwrap.dedent(code[start:end]),env)
 receipt=json.loads(owner("SELECT public.character_production_first_admit('"+nextctx['occurrenceId']+"',"+q(env['serialized'])+")"))
 assert receipt['id']==newctx['enrollmentId'] and receipt['currentAuthority'] is True
 assert owner("SELECT enrollment_id FROM character_production.scheduler_binding WHERE enabled")==newctx['enrollmentId']
 assert owner("SELECT enabled FROM character_production.scheduler_enrollments WHERE id='"+ctx['enrollmentId']+"'")=='f'
 validation=dict(state['validation'],slotDigest=first.hasharray(list(env['slot'].values())),providerBindingRevision=env['bd'],observedAt=db.run("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')"))
 planned=owner("SELECT public.character_production_scheduler_plan('"+newctx['enrollmentId']+"',0,"+j(validation)+")");assert json.loads(planned)['draftId']==newctx['draftId']
 assert owner("SELECT reserved_cents FROM character_production.budgets WHERE provider='heygen' AND period="+q(newctx['period']))==prior_budget,'planner cannot reset or reserve provider ledger'
 db.check('(SELECT count(*)=2 FROM character_production.scheduler_enrollments)','exact original plus successor')
 owner("UPDATE character_production.successor_standing SET enabled=false WHERE id='"+S+"'")
 assert advance()=='' and owner("SELECT character_production.successor_admission_prior('"+nextlane+"')")=='f'
 db.check("NOT (SELECT enabled FROM character_production.preparation_lanes WHERE id='"+nextlane+"')",'standing revoke cascades only descendants')
 db.finish('successor')

def seed_history(state):
 # This fixture INSERTS a complete historical original once. It does not call
 # today's planner then rewrite its immutable day. PR187 separately exercises
 # genuine first admission; below we exercise genuine successor admission.
 owner=first.owner;L=first.L;B=first.B;P=first.P;h=state['history']
 key='daily:'+h['day']+':zaria-solenne';occ=str(uuid.uuid4());enrollment=str(uuid.uuid4());draft=str(uuid.uuid4())
 tsource={'characterId':'zaria-solenne','roomKey':'gallery','voiceId':'5zneNR4v1Uw5AjIZ9Un4','canonicalRevision':'b'*64,'portraitSha256':'c'*64};script='Synthetic historical original.'
 owner("INSERT INTO character_production.preparation_occurrences(lane_id,id,text_key,text_started,speech_started,created_at) VALUES('"+L+"','"+occ+"',"+q(key)+",true,true,"+q(h['approved'])+"::timestamptz)")
 token=owner("INSERT INTO character_production.text_replenishment_attempts(key,budget_id,source_snapshot,source_digest,created_at,state,output,provider_id,input_tokens,output_tokens) VALUES("+q(key)+",'"+B+"',"+j(tsource)+",repeat('a',64),"+q(h['approved'])+"::timestamptz+interval '1 second','awaiting_audio_binding_and_qa',"+j({'spokenScript':script})+",'synthetic:historical',100,20) RETURNING token")
 expiry=int(owner("SELECT floor(extract(epoch FROM expires_at)*1000)::bigint FROM character_production.preparation_lanes WHERE id='"+L+"'"))
 ctx=dict(occurrenceId=occ,draftId=draft,enrollmentId=enrollment,generationAt=h['scheduled'],expiresAt=expiry,period=state['clock']['period'],capCents=2000)
 code=inspect.getsource(first.suite);a=code.index(' # Synthetic native proof mirrors');b=code.index(' def admit(',a)
 env=dict(first.__dict__,**state);env.update(ctx=ctx,occ=occ,key=key,token=token,script=script,tsource=tsource)
 exec(textwrap.dedent(code[a:b]),env)
 serialized=env['serialized'];slot=env['slot'];digest=first.hasharray(list(slot.values()))
 validation=dict(brand='cafe-sativa',accountId=state['account']['expectedUsername'],slotDigest=digest,canonicalRevision=slot['canonicalRevision'],providerBindingRevision=env['bd'],theme='gallery-art',rightsApproved=True,sourceBound=True,evidenceRef='synthetic:historical',observedAt=h['approved'])
 plan=dict(version=1,draftId=draft,scheduledAt=h['scheduled'],theme='gallery-art',validation=validation)
 candidate=dict(ordinal=0,slot=slot,digest=digest,draftId=draft,theme='gallery-art',scheduledAt=h['scheduled'])
 owner("INSERT INTO character_production.first_admission_records(occurrence_id,lane_id,enrollment_id,draft_id,generation_at,created_at,manifest_text,manifest_sha256) VALUES('"+occ+"','"+L+"','"+enrollment+"','"+draft+"',"+q(h['scheduled'])+","+q(h['approved'])+","+q(serialized)+","+q(first.sha(serialized))+")")
 owner("INSERT INTO character_production.scheduler_enrollments SELECT '"+enrollment+"',id,revision,'"+first.ACT+"',to_jsonb(p),"+j([candidate])+","+q(first.sha(serialized))+",'synthetic:historical',"+q(h['approved'])+"::timestamptz,to_timestamp("+str(expiry)+"/1000.0),true FROM character_production.planning_policies p WHERE id='"+P+"'; INSERT INTO character_production.scheduler_candidates VALUES('"+enrollment+"',0,"+j(slot)+","+q(digest)+",'"+draft+"','gallery-art',"+q(h['scheduled'])+"); INSERT INTO character_production.scheduler_binding VALUES('cafe-character-planner','"+enrollment+"',true)")
 owner("INSERT INTO character_production.approved_slots VALUES("+q(slot['key'])+","+j(slot)+","+q(digest)+",true); INSERT INTO character_production.schedules(key,digest,scheduled_at,not_after,enabled) VALUES("+q(slot['key'])+","+q(digest)+","+q(h['scheduled'])+",to_timestamp("+str(expiry)+"/1000.0),true)")
 owner("INSERT INTO character_production.planning_records(slot_key,policy_id,policy_revision,digest,slot,plan,promo_id,scheduled_at,dallas_day,quote_cents,created_at) VALUES("+q(slot['key'])+",'"+P+"',1,"+q(digest)+","+j(slot)+","+j(plan)+",'"+draft+"',"+q(h['scheduled'])+","+q(h['day'])+",35,"+q(h['approved'])+")")
 assert owner("SELECT public.character_production_new_blank_draft('"+draft+"',"+j(slot)+","+q(digest)+",'gallery-art')")
 env.update(validation=validation,ctx=ctx,occ=occ)
 exercise(env)

def replace_once(source,old,new):
 assert source.count(old)==1,old
 return source.replace(old,new)

def suite():
 # Actual first-admission setup only; history is inserted once by seed_history.
 source=inspect.getsource(first.suite)
 end=source.index(' # Explicit synthetic historical original rows')
 source=source[:end]
 source=replace_once(source,"ARRAY['gallery-art'],1,45,2000", "ARRAY['gallery-art'],2,45,2000")
 source=replace_once(source,"clock_timestamp()-interval '1 minute',date_trunc('milliseconds',clock_timestamp()+interval '1 hour'),true); INSERT INTO character_production.preparation_binding", "clock_timestamp()-interval '2 days',date_trunc('milliseconds',clock_timestamp()+interval '1 hour'),true); INSERT INTO character_production.preparation_binding")
 marker=" quote={'cents':35"
 pos=source.index(marker)
 history=""" history=json.loads(db.run(\"SELECT jsonb_build_object('day',((clock_timestamp() AT TIME ZONE 'America/Chicago')::date-1)::text,'approved',to_char((((clock_timestamp() AT TIME ZONE 'America/Chicago')::date::timestamp-interval '10 minutes') AT TIME ZONE 'America/Chicago') AT TIME ZONE 'UTC','YYYY-MM-DD\\\"T\\\"HH24:MI:SS.MS\\\"Z\\\"'),'scheduled',to_char((((clock_timestamp() AT TIME ZONE 'America/Chicago')::date::timestamp-interval '5 minutes') AT TIME ZONE 'America/Chicago') AT TIME ZONE 'UTC','YYYY-MM-DD\\\"T\\\"HH24:MI:SS.MS\\\"Z\\\"'),'observedMs',floor(extract(epoch FROM (((clock_timestamp() AT TIME ZONE 'America/Chicago')::date::timestamp-interval '10 minutes') AT TIME ZONE 'America/Chicago'))*1000)::bigint)\"))\n"""
 source=source[:pos]+history+source[pos:]
 source=replace_once(source,"'observedAt':clock['now'],'expiresAt':clock['now']+3600000", "'observedAt':history['observedMs'],'expiresAt':history['observedMs']+86400000")
 source=replace_once(source,'rate_evidence,expires_at,enabled) VALUES','rate_evidence,expires_at,enabled,reserved_cents) VALUES')
 source=replace_once(source,"'synthetic:rate',date_trunc('milliseconds',clock_timestamp()+interval '1 hour'),true)","'synthetic:rate',date_trunc('milliseconds',clock_timestamp()+interval '1 hour'),true,10)")
 source+=' seed_history(locals())\n'
 namespace=dict(first.__dict__,seed_history=seed_history)
 exec(source,namespace);namespace['suite']()

if __name__=='__main__':
 original=db.run;db.run=verbatim_run
 try:suite()
 finally:db.run=original
