"""Disposable PG17 contract checks; uses genuine chained foundation, no shim."""
import json, subprocess, concurrent.futures, datetime
import validate_planner as planner
import validate_ledger as db
import validate_planner_install as foundation

def suite():
 foundation.suite()
 source=(db.ROOT/'docs/proposals/character-production-scheduler-principal.sql').read_text()
 auth_before=foundation.auth_snapshot()
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; '+source)
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner;')
 signatures=['character_production_scheduler_context(uuid)','character_production_scheduler_reconciled(uuid,integer)','character_production_scheduler_plan(uuid,integer,jsonb)']
 for role in ['anon','authenticated','service_role','character_production_generator','character_production_output_broker']:
  for sig in signatures: db.check('NOT has_function_privilege('+db.quote(role)+','+db.quote('public.'+sig)+",'EXECUTE')",'proposal has no runtime grant')
 # The fixture alone supplies the proposed narrow permission delta, then proves
 # missing durable enrollment cannot become authority. No production enrollment.
 db.run('GRANT EXECUTE ON FUNCTION '+','.join('public.'+s for s in signatures)+' TO service_role;')
 for expression in ["public.character_production_scheduler_context('11111111-1111-4111-8111-111111111111')","public.character_production_scheduler_reconciled('11111111-1111-4111-8111-111111111111',0)","public.character_production_scheduler_plan('11111111-1111-4111-8111-111111111111',0,'{}')"]:
  db.run('SET ROLE service_role; DO $$ BEGIN IF '+expression+" IS NOT NULL THEN RAISE EXCEPTION 'Absent enrollment authorized'; END IF; END $$;")
 for table in ['scheduler_enrollments','scheduler_candidates','scheduler_binding']:
  db.check('(SELECT count(*)=0 FROM character_production.'+table+')','no fabricated enrollment')
  for privilege in ['SELECT','INSERT','UPDATE','DELETE']:
   db.check("NOT has_table_privilege('service_role','character_production."+table+"','"+privilege+"')",'no runtime enrollment table access')
 db.check("NOT has_function_privilege('service_role','public.character_production_plan(jsonb,text,jsonb,uuid,bigint,uuid)','EXECUTE')",'raw planner remains inaccessible')
 assert foundation.auth_snapshot()==auth_before

 # Synthetic records only in the disposable cluster; real SQL/admin chain above.
 pol=planner.POL; enrolled='22222222-2222-4222-8222-222222222222'
 slot,digest,plan=planner.fixture('scheduler-contract')
 plan['scheduledAt']=datetime.datetime.fromisoformat(plan['scheduledAt']).isoformat(timespec='milliseconds').replace('+00:00','Z')
 candidate=dict(ordinal=0,slot=slot,digest=digest,draftId=plan['draftId'],theme=plan['theme'],scheduledAt=plan['scheduledAt'])
 q=lambda x:db.quote(json.dumps(x))+'::jsonb'
 db.run("INSERT INTO character_production.budgets(provider,period,cap_cents,reserved_cents,enabled) VALUES('heygen',"+db.quote(slot['period'])+",2000,35,true) ON CONFLICT(provider,period) DO UPDATE SET cap_cents=2000; INSERT INTO character_production.planning_policies VALUES('"+pol+"',1,true,'{\"evidenceRef\":\"synthetic:owner-review\",\"privateField\":\"secret-ci-only\"}',"+db.quote(slot['period'])+",to_timestamp("+str(slot['authorizationExpiresAt'])+"/1000.0),ARRAY['synthetic-persona'],ARRAY['synthetic-theme'],31,45,2000,'d61468fdf18c4b478f27857337ddd1ea');")
 db.run("INSERT INTO character_production.scheduler_enrollments SELECT '"+enrolled+"',id,revision,'"+planner.ACT+"',to_jsonb(p),"+q([candidate])+",repeat('a',64),'synthetic:explicit-enrollment',clock_timestamp()-interval '1 minute',expires_at,true FROM character_production.planning_policies p WHERE id='"+pol+"'; INSERT INTO character_production.scheduler_candidates VALUES('"+enrolled+"',0,"+q(slot)+","+db.quote(digest)+",'"+plan['draftId']+"','"+plan['theme']+"',"+db.quote(plan['scheduledAt'])+");")
 context="public.character_production_scheduler_context('"+enrolled+"')"
 write="public.character_production_scheduler_plan('"+enrolled+"',0,"+q(plan['validation'])+")"
 rpc=lambda expression:db.run('SET ROLE service_role; SELECT '+expression+';')
 assert rpc(context)=='','unbound UUID must not authorize'
 db.run("INSERT INTO character_production.scheduler_binding VALUES('cafe-character-planner','"+enrolled+"',true)")
 current=json.loads(rpc(context));assert current['policy']['policy']['ownerEvidenceRef']=='synthetic:owner-review'
 assert 'secret-ci-only' not in json.dumps(current)
 assert current['candidates']==[candidate]

 # Distinct synthetic enrollments in rolled-back transactions, never history edits.
 variant='33333333-3333-4333-8333-333333333333'
 for label,expiry,approved,authorization in [
  ('enrollment beyond policy',"expires_at+interval '1 second'","clock_timestamp()-interval '1 minute'",slot['authorizationExpiresAt']),
  ('candidate after enrollment',"clock_timestamp()+interval '2 minutes'","clock_timestamp()-interval '1 minute'",slot['authorizationExpiresAt']),
  ('candidate before approval',"expires_at",db.quote(plan['scheduledAt'])+"::timestamptz+interval '1 second'",slot['authorizationExpiresAt']),
  ('slot authority beyond enrollment',"expires_at-interval '1 minute'","clock_timestamp()-interval '1 minute'",slot['authorizationExpiresAt']),
  ('slot authority before scheduled',"expires_at","clock_timestamp()-interval '1 minute'",0),
  ('slot authority wrong type',"expires_at","clock_timestamp()-interval '1 minute'",str(slot['authorizationExpiresAt'])),
  ('slot authority null',"expires_at","clock_timestamp()-interval '1 minute'",None),
  ('slot authority too large',"expires_at","clock_timestamp()-interval '1 minute'",10**30),
 ]:
  vslot=dict(slot);vslot['authorizationExpiresAt']=authorization
  vcandidate=dict(candidate,slot=vslot,draftId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  vcontext="public.character_production_scheduler_context('"+variant+"')"
  db.run("BEGIN; INSERT INTO character_production.scheduler_enrollments SELECT '"+variant+"',id,revision,'"+planner.ACT+"',to_jsonb(p),"+q([vcandidate])+",repeat('a',64),'synthetic:expiry-negative',"+approved+","+expiry+",true FROM character_production.planning_policies p WHERE id='"+pol+"'; INSERT INTO character_production.scheduler_candidates VALUES('"+variant+"',0,"+q(vslot)+","+db.quote(digest)+",'"+vcandidate['draftId']+"','"+plan['theme']+"',"+db.quote(plan['scheduledAt'])+"); UPDATE character_production.scheduler_binding SET enrollment_id='"+variant+"'; SET ROLE service_role; DO $$ BEGIN IF "+vcontext+" IS NOT NULL THEN RAISE EXCEPTION "+db.quote(label)+"; END IF; END $$; ROLLBACK;")
 # Later insertion changes the sealed set: invalidates, never expands authority.
 extra="INSERT INTO character_production.scheduler_candidates VALUES('"+enrolled+"',1,"+q(slot)+","+db.quote(digest)+",'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','"+plan['theme']+"',"+db.quote(plan['scheduledAt'])+");"
 db.run("BEGIN; "+extra+" SET ROLE service_role; DO $$ BEGIN IF "+context+" IS NOT NULL THEN RAISE EXCEPTION 'unsealed set accepted'; END IF; END $$; ROLLBACK;")
 db.run("BEGIN; UPDATE auth.users SET raw_app_meta_data='{}' WHERE id='"+planner.ACT+"'; SET ROLE service_role; DO $$ BEGIN IF "+context+" IS NOT NULL OR "+write+" IS NOT NULL THEN RAISE EXCEPTION 'revoked admin accepted'; END IF; END $$; ROLLBACK;")
 bad=dict(plan['validation']);bad['slotDigest']='f'*64
 assert rpc("public.character_production_scheduler_plan('"+enrolled+"',0,"+q(bad)+")")=='','wrong binding assertion denied'
 before=db.run("SELECT jsonb_agg(to_jsonb(b) ORDER BY provider,period) FROM character_production.budgets b")
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  results=list(pool.map(lambda _:json.loads(rpc(write)),range(3)))
 assert sum(not r['replayed'] for r in results)==1,results
 db.check("(SELECT count(*)=1 FROM character_production.planning_records WHERE slot_key='scheduler-contract')",'single race plan')
 assert before==db.run("SELECT jsonb_agg(to_jsonb(b) ORDER BY provider,period) FROM character_production.budgets b"),'planner cannot reserve/spend'
 assert rpc("public.character_production_scheduler_reconciled('"+enrolled+"',0)")=='t'
 for mutation in ["UPDATE character_production.scheduler_binding SET enabled=false","DELETE FROM character_production.scheduler_binding"]:
  db.run("BEGIN; "+mutation+"; DO $$ BEGIN IF EXISTS(SELECT 1 FROM character_production.approved_slots WHERE key='scheduler-contract' AND enabled) OR EXISTS(SELECT 1 FROM character_production.schedules WHERE key='scheduler-contract' AND enabled) OR EXISTS(SELECT 1 FROM character_production.qa_slot_bindings WHERE slot_key='scheduler-contract' AND enabled) THEN RAISE EXCEPTION 'downstream not revoked'; END IF; END $$; SET ROLE service_role; DO $$ BEGIN IF "+write+" IS NOT NULL THEN RAISE EXCEPTION 'revoked binding wrote'; END IF; END $$; ROLLBACK;")
 # Concurrent revocation/write: any accepted write precedes revocation commit.
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  futures=[pool.submit(rpc,write),pool.submit(db.run,"UPDATE character_production.scheduler_binding SET enabled=false")]
  for f in futures:f.result()
 assert rpc(write)=='','no write after revoke commit'
 assert rpc(context)==''
 db.finish('scheduler-principal-contract')
if __name__=='__main__':suite()
