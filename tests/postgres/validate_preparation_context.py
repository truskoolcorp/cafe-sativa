"""Isolated PG17 rehearsal: original preparation context only, never providers/live."""
import concurrent.futures,json,hashlib,subprocess,threading
import validate_ledger as db
import validate_planner_install as foundation
from validate_enrolled_reads_install import verbatim_run

ACT='88888888-8888-4888-8888-888888888888'
B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
L='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
OTHER='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
q=db.quote
CTX='public.character_production_preparation_context()'

def owner(sql):return db.run('SET ROLE character_production_owner; '+sql).strip()
def read():
 raw=owner('SELECT '+CTX)
 return json.loads(raw) if raw else None

def fail(sql,label):
 p=subprocess.run(db.command(),input=sql,text=True,capture_output=True)
 assert p.returncode and label in p.stderr,p.stderr

def suite():
 foundation.suite()
 db.check("current_setting('server_version_num')::integer BETWEEN 170000 AND 179999",'PG17 only')
 auth=foundation.auth_snapshot()
 for name,table in [('character-production-replenishment.sql','text_replenishment_attempts'),('character-production-fresh-speech-source.sql','included_speech_scopes'),('character-production-preparation-context.sql','preparation_lanes')]:
  source=(db.ROOT/'docs/proposals'/name).read_text();assert source.rstrip().endswith('ROLLBACK;')
  db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; '+source)
  db.check("to_regclass('character_production."+table+"') IS NULL",'source rollback')
  db.run('SET ROLE character_production_owner; '+source.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner;')
 for role in ['anon','authenticated','service_role']:
  for table in ['preparation_lanes','preparation_binding','preparation_occurrences']:
   db.check('NOT has_table_privilege('+q(role)+','+q('character_production.'+table)+",'SELECT,INSERT,UPDATE,DELETE')",'no runtime table grants')
  for sig in ['character_production_preparation_context()','character_production_preparation_claim(uuid,text)']:
   db.check('NOT has_function_privilege('+q(role)+','+q('public.'+sig)+",'EXECUTE')",'no runtime RPC grants')
 assert read() is None
 owner("INSERT INTO character_production.text_replenishment_budgets(id,period,model,input_micro_usd,output_micro_usd,max_cost_cents,cap_cents,rate_evidence,expires_at,enabled) VALUES('"+B+"',to_char(clock_timestamp() AT TIME ZONE 'America/Chicago','YYYY-MM'),'claude-haiku-4-5-20251001',1,3,10,20,'synthetic:rate-ceiling',date_trunc('second',clock_timestamp())+interval '1 hour',true)")
 scope={'characterId':'zaria-solenne','roomKey':'gallery'}
 lane="INSERT INTO character_production.preparation_lanes(id,actor_id,reference,owner_message_ids,source_scope,budget_id,authorized_at,expires_at,enabled) VALUES('"+L+"','"+ACT+"','synthetic:preparation',ARRAY['Sentinel_"+'a'*32+"'],"+q(json.dumps(scope))+"::jsonb,'"+B+"',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',true); INSERT INTO character_production.preparation_binding VALUES('zaria-gallery-preparation','"+L+"');"
 # Actual short-lived context and saved text are created before waiting for
 # expiry; no rewriting timestamps or inventing a recovery identity afterward.
 short=lane.replace("clock_timestamp()+interval '1 hour'","clock_timestamp()+interval '2 seconds'")
 recovery_sql="""DO $$ DECLARE c jsonb; original jsonb; token uuid; b character_production.text_replenishment_budgets; BEGIN
 c:=public.character_production_preparation_context();
 IF NOT public.character_production_preparation_claim((c->>'occurrenceId')::uuid,'text') THEN RAISE EXCEPTION 'short context phase claim'; END IF;
 SELECT * INTO b FROM character_production.text_replenishment_budgets LIMIT 1;
 token:=public.character_production_text_claim(c->>'textKey',repeat('a',64),'{"characterId":"zaria-solenne","roomKey":"gallery","voiceId":"5zneNR4v1Uw5AjIZ9Un4"}',b.id,b.period,b.max_cost_cents,b.cap_cents,b.rate_evidence,floor(extract(epoch FROM b.expires_at)*1000)::bigint,b.input_micro_usd,b.output_micro_usd);
 IF token IS NULL OR NOT public.character_production_text_save(c->>'textKey',token,repeat('a',64),'{"spokenScript":"Synthetic expiring context"}','synthetic:receipt',100,20) THEN RAISE EXCEPTION 'short actual text save'; END IF;
 original:=public.character_production_preparation_context();
 IF original->'identity'='null'::jsonb THEN RAISE EXCEPTION 'original identity absent'; END IF;
 PERFORM pg_sleep(2.1);c:=public.character_production_preparation_context();
 IF c->'active' IS DISTINCT FROM 'false'::jsonb OR c->'identity' IS DISTINCT FROM original->'identity' OR c->>'occurrenceId' IS DISTINCT FROM original->>'occurrenceId' OR public.character_production_preparation_claim((c->>'occurrenceId')::uuid,'speech') THEN RAISE EXCEPTION 'expired context renewed or identity changed'; END IF;
 END $$;"""
 db.run('BEGIN; SET ROLE character_production_owner; '+short+recovery_sql+' ROLLBACK;')
 owner(lane)
 # Real admin bridge revocation prevents even creation of a new occurrence.
 db.run("BEGIN; UPDATE auth.users SET raw_app_meta_data='{}' WHERE id='"+ACT+"'; SET ROLE character_production_owner; DO $$ BEGIN IF "+CTX+" IS NOT NULL THEN RAISE EXCEPTION 'revoked context created'; END IF; END $$; ROLLBACK;")
 # A prior-day immutable occurrence is synthetic history, not a newly authorized
 # task. It must remain the original row and cannot claim another daily phase.
 oldkey='daily:2000-01-01:zaria-solenne'
 db.run("BEGIN; SET ROLE character_production_owner; INSERT INTO character_production.preparation_occurrences(lane_id,text_key) VALUES('"+L+"',"+q(oldkey)+"); DO $$ DECLARE c jsonb:="+CTX+"; BEGIN IF c->>'textKey' IS DISTINCT FROM "+q(oldkey)+" OR public.character_production_preparation_claim((c->>'occurrenceId')::uuid,'text') THEN RAISE EXCEPTION 'prior-day replay'; END IF; END $$; ROLLBACK;")
 # Synthetic historical ORIGINAL rows are inserted with original timestamps,
 # then the real save RPC supplies receipt identity. No timestamp reset, claim
 # replay or current authorization is fabricated for this prior day.
 history="""DO $$ DECLARE token uuid; c jsonb; k text:='daily:2000-01-01:zaria-solenne'; BEGIN
 INSERT INTO character_production.preparation_occurrences(lane_id,text_key,text_started,created_at) VALUES('"""+L+"""',k,true,'2000-01-01T12:00:00Z');
 INSERT INTO character_production.text_replenishment_attempts(key,budget_id,source_snapshot,source_digest,created_at) VALUES(k,'"""+B+"""','{"characterId":"zaria-solenne","roomKey":"gallery","voiceId":"5zneNR4v1Uw5AjIZ9Un4"}',repeat('a',64),'2000-01-01T12:00:01Z') RETURNING text_replenishment_attempts.token INTO token;
 IF NOT public.character_production_text_save(k,token,repeat('a',64),'{"spokenScript":"Synthetic original historical script"}','synthetic:historical-receipt',100,20) THEN RAISE EXCEPTION 'historical receipt save'; END IF;
 c:=public.character_production_preparation_context();
 IF c->'identity'='null'::jsonb OR c->'identity'->>'textAttemptToken' IS DISTINCT FROM token::text OR c->>'textKey' IS DISTINCT FROM k OR public.character_production_preparation_claim((c->>'occurrenceId')::uuid,'speech') THEN RAISE EXCEPTION 'historical original identity/replay'; END IF;
 END $$;"""
 db.run('BEGIN; SET ROLE character_production_owner; '+history+' ROLLBACK;')
 # A different lane already owning today's unique key must yield NULL, not
 # an adopted occurrence or a unique-key exception. This is fixture-only setup.
 conflict=lane.split("; INSERT INTO character_production.preparation_binding")[0].replace(L,OTHER)+";"
 db.run("BEGIN; SET ROLE character_production_owner; "+conflict+" INSERT INTO character_production.preparation_occurrences(lane_id,text_key) VALUES('"+OTHER+"','daily:'||to_char(clock_timestamp() AT TIME ZONE 'America/Chicago','YYYY-MM-DD')||':zaria-solenne'); DO $$ BEGIN IF "+CTX+" IS NOT NULL OR EXISTS(SELECT 1 FROM character_production.preparation_occurrences WHERE lane_id='"+L+"') THEN RAISE EXCEPTION 'other lane occurrence adopted'; END IF; END $$; ROLLBACK;")
 # Synchronize first admission, then repeatedly exercise concurrent recovery.
 # No reset, deletion or fabricated new key between rounds.
 for round_index in range(8):
  barrier=threading.Barrier(8)
  def simultaneous_read(_):
   barrier.wait(timeout=30)
   return read()
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: contexts=list(pool.map(simultaneous_read,range(8)))
  c=contexts[0]
  assert c and all(item==c for item in contexts) and c['active'] is True and c['identity'] is None
  if round_index==0: original_occurrence=c['occurrenceId']
  assert c['occurrenceId']==original_occurrence
  db.check('(SELECT count(*)=1 FROM character_production.preparation_occurrences)','concurrent original context stable')
 key=c['textKey'];occ=c['occurrenceId']
 assert key==owner("SELECT 'daily:'||to_char(clock_timestamp() AT TIME ZONE 'America/Chicago','YYYY-MM-DD')||':zaria-solenne'")
 db.check('(SELECT count(*)=1 FROM character_production.preparation_occurrences)','one original context')
 def claim(phase='text',oid=occ):return owner('SELECT public.character_production_preparation_claim('+q(oid)+','+q(phase)+')')
 assert claim('other')=='f' and claim('text',OTHER)=='f' and claim('speech')=='f'
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: claimed=list(pool.map(lambda _:claim(),range(2)))
 assert sorted(claimed)==['f','t'],claimed
 assert read()['textStarted'] is True and claim()=='f'
 fail("SET ROLE character_production_owner; UPDATE character_production.preparation_occurrences SET text_started=false;",'immutable')
 fail("SET ROLE character_production_owner; DELETE FROM character_production.preparation_occurrences;",'immutable')
 fail("SET ROLE character_production_owner; UPDATE character_production.preparation_lanes SET expires_at=expires_at+interval '1 hour';",'immutable')
 fail("SET ROLE character_production_owner; UPDATE character_production.preparation_binding SET lane_id=lane_id;",'immutable')
 for table in ['preparation_lanes','preparation_binding']:
  fail('SET ROLE character_production_owner; DELETE FROM character_production.'+table+';','immutable')
 fail("SET ROLE character_production_owner; UPDATE character_production.preparation_occurrences SET speech_started=false,text_started=false;",'immutable')
 # Use actual text claim/save RPCs. Provider values are explicitly synthetic
 # fixture data; this is not evidence of an external API call or generated media.
 expiry=owner("SELECT floor(extract(epoch FROM expires_at)*1000)::bigint FROM character_production.text_replenishment_budgets WHERE id='"+B+"'")
 digest='a'*64
 source={**scope,'voiceId':'5zneNR4v1Uw5AjIZ9Un4'}
 args=[q(key),q(digest),q(json.dumps(source))+'::jsonb',q(B),q(key[6:13]),'10','20',q('synthetic:rate-ceiling'),expiry,'1','3']
 token=owner('SELECT public.character_production_text_claim('+','.join(args)+')');assert token
 assert read()['identity'] is None and read()['textState']=='claimed' and claim()=='f' and claim('speech')=='f'
 assert owner('SELECT public.character_production_text_claim('+','.join(args)+')')==''
 script='Synthetic preparation fixture text; no provider call.'
 save=[q(key),q(token),q(digest),q(json.dumps({'spokenScript':script}))+'::jsonb',q('synthetic:provider-receipt'),'100','20']
 assert owner('SELECT public.character_production_text_save('+','.join(save)+')')=='t'
 c=read();identity={'textAttemptKey':key,'textAttemptToken':token,'textSourceDigest':digest,'scriptSha256':hashlib.sha256(script.encode()).hexdigest()}
 assert c['identity']==identity and c['textStarted'] is True
 assert owner('SELECT public.character_production_text_save('+','.join(save)+')')=='f'
 # Expired lease/context still returns exact original identity for read-only
 # recovery, never grants renewed authority or a fresh occurrence.
 db.run("BEGIN; UPDATE auth.users SET raw_app_meta_data='{}' WHERE id='"+ACT+"'; SET ROLE character_production_owner; DO $$ DECLARE c jsonb:="+CTX+"; BEGIN IF c->'active' IS DISTINCT FROM 'false'::jsonb OR c->'identity' IS DISTINCT FROM "+q(json.dumps(identity))+"::jsonb OR c->'sourceScope' IS DISTINCT FROM 'null'::jsonb OR public.character_production_preparation_claim('"+occ+"','speech') THEN RAISE EXCEPTION 'revocation lost original identity'; END IF; END $$; ROLLBACK;")
 assert claim('speech')=='f', 'saved text alone cannot consume speech phase without actual speech scope'
 owner("INSERT INTO character_production.included_speech_scopes VALUES('"+L+"','"+ACT+"','synthetic:current-speech',ARRAY['Sentinel_"+'a'*32+"'],clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',true); INSERT INTO character_production.included_speech_binding VALUES('zaria-gallery-fresh-speech','"+L+"',true);")
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: spoken=list(pool.map(lambda _:claim('speech'),range(2)))
 assert sorted(spoken)==['f','t'],spoken
 assert claim('speech')=='f'
 owner("UPDATE character_production.preparation_lanes SET enabled=false WHERE id='"+L+"'")
 c=read();assert c['active'] is False and c['identity']==identity and c['occurrenceId']==occ and c['lease'] is None
 fail("SET ROLE character_production_owner; UPDATE character_production.preparation_lanes SET enabled=true;",'immutable')
 assert claim()=='f' and claim('speech')=='f'
 assert owner("SELECT reserved_cents FROM character_production.text_replenishment_budgets WHERE id='"+B+"'")=='10'
 assert foundation.auth_snapshot()==auth,'no identity authority changes'
 db.finish('preparation-context')

if __name__=='__main__':
 original=db.run;db.run=verbatim_run
 try:suite()
 finally:db.run=original
