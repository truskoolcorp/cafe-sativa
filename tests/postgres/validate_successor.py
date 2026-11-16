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

def suite():
 # Reuse genuine first-admission setup, validation, manifest, and scheduler_plan.
 # Replace ONLY creation of today's text with explicitly historical original
 # fixture rows + actual save. No existing immutable timestamp is changed.
 source=inspect.getsource(first.suite)
 end=source.index(' fail("SET ROLE character_production_owner; UPDATE character_production.first_admission_records SET generation_at=')
 source=source[:end]+' exercise(locals())\n'
 start=source.index(" prep=json.loads(owner('SELECT public.character_production_preparation_context()'))")
 stop=source.index(' def contender(fn):',start)
 historical=''' tsource={'characterId':'zaria-solenne','roomKey':'gallery','voiceId':'5zneNR4v1Uw5AjIZ9Un4','canonicalRevision':'b'*64,'portraitSha256':'c'*64};script='Synthetic prior-day original, never a provider call.'
 key='daily:2000-01-01:zaria-solenne'
 occ=owner("INSERT INTO character_production.preparation_occurrences(lane_id,text_key,text_started,created_at) VALUES('"+L+"',"+q(key)+",true,'2000-01-01T12:00:00Z') RETURNING id")
 token=owner("INSERT INTO character_production.text_replenishment_attempts(key,budget_id,source_snapshot,source_digest,created_at) VALUES("+q(key)+",'"+B+"',"+q(raw(tsource))+"::jsonb,repeat('a',64),'2000-01-01T12:00:01Z') RETURNING token")
 assert owner("SELECT public.character_production_text_save("+','.join([q(key),q(token),q('a'*64),q(raw({'spokenScript':script}))+'::jsonb',q('synthetic:original-receipt'),'100','20'])+")")=='t'
'''
 source=source[:start]+historical+source[stop:]
 namespace=dict(first.__dict__,exercise=exercise)
 exec(source,namespace)
 namespace['suite']()

if __name__=='__main__':
 original=db.run;db.run=verbatim_run
 try:suite()
 finally:db.run=original
