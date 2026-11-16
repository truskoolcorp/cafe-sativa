#!/usr/bin/env python3
"""Synthetic broker authority tests, after isolated foundation/queue suite only."""
import os
os.environ['PG_TEST_SERVER']='1'
import validate_ledger as db

def suite():
 db.command()
 source=(db.ROOT/'docs/proposals/character-production-broker-authorization.sql').read_text()
 db.run('SET ROLE ledger_owner; '+source.replace('COMMIT;','ROLLBACK;')+' RESET ROLE;')
 db.check("to_regprocedure('public.character_production_broker_authorized(jsonb)') IS NULL",'broker rollback')
 db.run('SET ROLE ledger_owner; '+source+' RESET ROLE;')
 for role in ['anon','authenticated','service_role','ledger_worker']:
  db.check("NOT has_function_privilege("+db.quote(role)+",'public.character_production_broker_authorized(jsonb)','EXECUTE')",'broker grants closed')
 db.fixture('broker-provider',['broker-job'])
 db.check(db.claim('broker-job')+' IS NOT NULL','broker fixture claimed')
 db.run("SELECT public.character_production_submitted(key,token,digest,'broker-task') FROM character_production.jobs WHERE key='broker-job';")
 job="(SELECT jsonb_build_object('key',key,'token',token,'digest',digest,'taskId',task,'provider',provider,'model',model,'providerBindingRevision',provider_binding_revision) FROM character_production.jobs WHERE key='broker-job')"
 auth=lambda j=job:'public.character_production_broker_authorized('+j+')'
 db.check(auth(),'valid submitted identity')
 for field in ['key','token','digest','taskId','provider','model','providerBindingRevision']:
  db.check('NOT '+auth(job+'||jsonb_build_object('+db.quote(field)+",'wrong')"),'wrong '+field)
 db.run("UPDATE character_production.budgets SET enabled=false WHERE provider='broker-provider';")
 db.check('NOT '+auth(),'disabled budget blocks')
 db.run("UPDATE character_production.budgets SET enabled=true,cap_cents=101 WHERE provider='broker-provider';")
 db.check('NOT '+auth(),'changed cap blocks')
 db.run("UPDATE character_production.budgets SET cap_cents=100 WHERE provider='broker-provider'; UPDATE character_production.approved_slots SET enabled=false WHERE key='broker-job';")
 db.check('NOT '+auth(),'disabled slot blocks')
 db.run("UPDATE character_production.approved_slots SET enabled=true,slot=slot||'{\"script\":\"changed\"}' WHERE key='broker-job';")
 db.check('NOT '+auth(),'changed slot blocks')
 db.run("UPDATE character_production.approved_slots a SET slot=j.slot FROM character_production.jobs j WHERE a.key=j.key AND a.key='broker-job';")
 db.check(auth(),'restored exact authority')
 db.check('public.character_production_output('+job+",repeat('d',64),100)",'synthetic committed output')
 db.check(auth(),'committed identity permits readback')
 # Synthetic fixture deliberately expires both snapshots to isolate expiry check.
 db.run("UPDATE character_production.jobs SET slot=slot||'{\"authorizationExpiresAt\":1}' WHERE key='broker-job'; UPDATE character_production.approved_slots a SET slot=j.slot FROM character_production.jobs j WHERE a.key=j.key AND a.key='broker-job';")
 db.check('NOT '+auth(),'expired exact slot blocks')
 db.finish('broker')
if __name__=='__main__':suite()
