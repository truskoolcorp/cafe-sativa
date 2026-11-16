"""Disposable PG17 source tests; real admin bridge, synthetic identities only."""
import json,subprocess
import validate_ledger as db
import validate_planner_install as foundation
from validate_enrolled_reads_install import verbatim_run

def suite():
 foundation.suite()
 for file in ['character-production-replenishment.sql','character-production-fresh-speech-source.sql']:
  source=(db.ROOT/'docs/proposals'/file).read_text();assert source.rstrip().endswith('ROLLBACK;')
  db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; '+source)
  target='text_replenishment_attempts' if 'replenishment' in file else 'included_speech_scopes'
  db.check("to_regclass('character_production."+target+"') IS NULL",'source rolls back')
  db.run('SET ROLE character_production_owner; '+source.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner;')
 for role in ['anon','authenticated','service_role']:
  db.check('NOT has_function_privilege('+db.quote(role)+",'public.character_production_fresh_speech_source(text)','EXECUTE')",'no source grant')
  for table in ['included_speech_scopes','included_speech_binding']:
   db.check('NOT has_table_privilege('+db.quote(role)+",'character_production."+table+"','SELECT,INSERT,UPDATE,DELETE')",'no scope grants')
 key='daily:'+db.run("SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Chicago','YYYY-MM-DD')").strip()+':zaria-solenne'
 actor='88888888-8888-4888-8888-888888888888';scope='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';budget='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
 def owner(sql):return db.run('SET ROLE character_production_owner; '+sql).strip()
 def read(k=key):return owner('SELECT public.character_production_fresh_speech_source('+db.quote(k)+')')
 assert read()==''
 owner("INSERT INTO character_production.included_speech_scopes VALUES('"+scope+"','"+actor+"','fixture-standing',ARRAY['Sentinel_"+'a'*32+"'],clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',true); INSERT INTO character_production.included_speech_binding VALUES('zaria-gallery-fresh-speech','"+scope+"',true);")
 owner("INSERT INTO character_production.text_replenishment_budgets(id,period,model,input_micro_usd,output_micro_usd,max_cost_cents,cap_cents,rate_evidence,expires_at) VALUES('"+budget+"','2026-11','claude-haiku-4-5-20251001',1,3,1,1,'fixture',clock_timestamp()+interval '1 hour');")
 source=json.dumps({'characterId':'zaria-solenne','roomKey':'gallery','voiceId':'5zneNR4v1Uw5AjIZ9Un4'})
 owner("INSERT INTO character_production.text_replenishment_attempts(key,budget_id,source_snapshot,source_digest) VALUES("+db.quote(key)+",'"+budget+"',"+db.quote(source)+"::jsonb,repeat('a',64))")
 assert read()==''
 owner("UPDATE character_production.text_replenishment_attempts SET state='awaiting_audio_binding_and_qa',output='{\"spokenScript\":\"Fixture\"}',provider_id='fixture',input_tokens=100,output_tokens=20")
 assert db.run("BEGIN ISOLATION LEVEL REPEATABLE READ; SET ROLE character_production_owner; SELECT public.character_production_fresh_speech_source("+db.quote(key)+"); ROLLBACK;").strip()==''
 result=json.loads(read());assert result['attempt']['key']==key and result['scopeId']==scope and result['authority']['revoked'] is False
 assert set(result)=={'scopeId','attempt','authority'} and read('daily:2000-01-01:zaria-solenne')=='' and read(key.replace('zaria-solenne','ahnika'))==''
 db.run("UPDATE auth.users SET raw_app_meta_data='{}' WHERE id='"+actor+"'");assert read()==''
 db.run("UPDATE auth.users SET raw_app_meta_data='{\"cafe_sativa_admin\":true}' WHERE id='"+actor+"'");assert read()!=''
 p=subprocess.run(db.command(),input="SET ROLE character_production_owner; UPDATE character_production.included_speech_scopes SET expires_at=expires_at+interval '1 hour';",text=True,capture_output=True)
 assert p.returncode and 'immutable' in p.stderr
 owner("UPDATE character_production.included_speech_binding SET enabled=false")
 assert read()==''
 db.check("NOT (SELECT enabled FROM character_production.included_speech_scopes)",'binding revokes old scope')
 p=subprocess.run(db.command(),input="SET ROLE character_production_owner; UPDATE character_production.included_speech_scopes SET enabled=true;",text=True,capture_output=True)
 assert p.returncode and 'immutable' in p.stderr
 db.finish('fresh-speech-source')
if __name__=='__main__':
 original=db.run;db.run=verbatim_run
 try:suite()
 finally:db.run=original
