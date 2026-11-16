#!/usr/bin/env python3
"""Requires existing disposable CI foundation created by validate_concurrency.py."""
import os,json
os.environ['PG_TEST_SERVER']='1'
import validate_ledger as db

def suite():
 db.command()  # Guard explicit local disposable database and consent before reads.
 db.check("to_regclass('character_production.approved_slots') IS NOT NULL",'foundation required')
 source=(db.ROOT/'docs/proposals/character-production-queue.sql').read_text()
 db.run('SET ROLE ledger_owner; '+source.replace('COMMIT;','ROLLBACK;')+' RESET ROLE;')
 db.check("to_regclass('character_production.schedules') IS NULL",'queue rollback')
 db.run('SET ROLE ledger_owner; '+source+' RESET ROLE;')
 for role in ['anon','authenticated','service_role','ledger_worker']:
  db.check("NOT has_function_privilege("+db.quote(role)+",'public.character_production_due(text,text,integer)','EXECUTE')",'queue function grants closed')
  db.check("NOT has_table_privilege("+db.quote(role)+",'character_production.schedules','SELECT,INSERT,UPDATE,DELETE')",'queue table grants closed')
 keys=['queue-a','queue-b','queue-future','queue-disabled','queue-mismatch','queue-expiry','queue-claimed']
 db.fixture('queue-provider',keys,cap=1000)
 db.run("INSERT INTO character_production.schedules(key,digest,scheduled_at,not_after,enabled) SELECT key,digest,date_trunc('minute',clock_timestamp())-interval '1 minute',to_timestamp((slot->>'authorizationExpiresAt')::numeric/1000),true FROM character_production.approved_slots WHERE slot->>'provider'='queue-provider';")
 db.run("UPDATE character_production.schedules SET scheduled_at=clock_timestamp()+interval '1 hour' WHERE key='queue-future'; UPDATE character_production.schedules SET enabled=false WHERE key='queue-disabled'; UPDATE character_production.schedules SET digest=repeat('f',64) WHERE key='queue-mismatch'; UPDATE character_production.schedules SET not_after=not_after-interval '1 second' WHERE key='queue-expiry';")
 db.check(db.claim('queue-claimed')+' IS NOT NULL','claimed fixture')
 def due(limit=25):return json.loads(db.run("SELECT public.character_production_due('queue-provider','test-model',"+str(limit)+");"))
 result=due();assert [x['slot']['key'] for x in result['rows']]==['queue-a','queue-b'];assert isinstance(result['observedAt'],int)
 assert len(due(1)['rows'])==1;assert len(due(0)['rows'])==0
 for state in ['submitting','unknown','failed']:
  db.run("UPDATE character_production.jobs SET state="+db.quote(state)+" WHERE key='queue-claimed';")
  assert len(due()['rows'])==2
 db.run("UPDATE character_production.approved_slots SET enabled=false WHERE key='queue-a';")
 assert [x['slot']['key'] for x in due()['rows']]==['queue-b']
 db.run("UPDATE character_production.budgets SET enabled=false WHERE provider='queue-provider';")
 assert due()['rows']==[]
 db.finish('queue')
if __name__=='__main__':suite()
