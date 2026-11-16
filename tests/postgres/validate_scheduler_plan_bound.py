"""Disposable PG17 only: real planner/selection chain, no live credentials."""
import copy,hashlib,json,subprocess,time
import validate_ledger as db
import validate_planner as planner
import validate_planner_install as foundation
from validate_enrolled_reads_install import verbatim_run

def suite():
 foundation.suite()
 for name in ['character-production-scheduler-principal.sql','character-production-recurring-selection.sql','character-production-binding-snapshots.sql','character-production-scheduler-plan-bound.sql']:
  source=(db.ROOT/'docs/proposals'/name).read_text()
  db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; '+source)
  if source.rstrip().endswith('ROLLBACK;'):
   db.run('SET ROLE character_production_owner; '+source.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner')
 for role in ['anon','authenticated','service_role']:
  db.check('NOT has_table_privilege('+db.quote(role)+",'character_production.binding_snapshots','SELECT,INSERT,UPDATE,DELETE')",'owner-only snapshots')
  for sig in ['public.character_production_plan_bound(jsonb,text,jsonb,uuid,bigint,uuid,text)','public.character_production_selected_binding(uuid,uuid)','public.character_production_scheduler_plan_bound(uuid,integer,jsonb,text)']:
   db.check('NOT has_function_privilege('+db.quote(role)+','+db.quote(sig)+",'EXECUTE')",'no runtime grant')
 s,d,p=planner.fixture('bound-enrolled-original',1)
 q=lambda x:db.quote(json.dumps(x,separators=(',',':')))+'::jsonb'
 own=lambda sql:db.run('SET ROLE character_production_owner; '+sql)
 snap=json.dumps({'version':1,'account':{'model':'avatar_iv'},'image':{'characterId':s['characterId'],'canonicalRevision':s['canonicalRevision'],'portraitSha256':s['portraitSha256'],'audio':{'voiceId':s['voiceId'],'scriptSha256':hashlib.sha256(s['script'].encode()).hexdigest()}},'speech':{'fixture':'SQL-only; TS binding tests validate full media proof'}},separators=(',',':'))
 digest=hashlib.sha256(snap.encode()).hexdigest();p['validation']['evidenceRef']='binding-snapshot-sha256:'+digest
 p['scheduledAt']=db.run("SELECT to_char(clock_timestamp()+interval '3 minutes','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")
 db.run("INSERT INTO character_production.budgets(provider,period,cap_cents,reserved_cents,enabled) VALUES('heygen',"+db.quote(s['period'])+",2000,0,true) ON CONFLICT(provider,period) DO UPDATE SET cap_cents=2000,enabled=true")
 db.run("INSERT INTO character_production.planning_policies VALUES('"+planner.POL+"',1,true,'{\"evidenceRef\":\"synthetic:snapshot\"}',"+db.quote(s['period'])+",to_timestamp("+str(s['authorizationExpiresAt'])+"/1000.0),ARRAY['synthetic-persona'],ARRAY['synthetic-theme'],31,45,2000,'d61468fdf18c4b478f27857337ddd1ea')")
 e='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
 candidates=[dict(ordinal=0,slot=s,digest=d,draftId=p['draftId'],theme=p['theme'],scheduledAt=p['scheduledAt'])]
 db.run("INSERT INTO character_production.scheduler_enrollments SELECT '"+e+"',id,revision,'"+planner.ACT+"',to_jsonb(pol),"+q(candidates)+",repeat('d',64),'synthetic:scoped-snapshot',clock_timestamp()-interval '1 minute',expires_at,true FROM character_production.planning_policies pol WHERE id='"+planner.POL+"'; INSERT INTO character_production.scheduler_candidates VALUES('"+e+"',0,"+q(s)+","+db.quote(d)+",'"+p['draftId']+"','synthetic-theme',"+db.quote(p['scheduledAt'])+"); INSERT INTO character_production.scheduler_binding VALUES('cafe-character-planner','"+e+"',true)")
 call=lambda enrollment=e,ordinal=0,validation=None,text=snap:'public.character_production_scheduler_plan_bound('+','.join([db.quote(enrollment)+'::uuid',str(ordinal),q(p['validation'] if validation is None else validation),db.quote(text)])+')'
 empty="NOT EXISTS(SELECT 1 FROM character_production.binding_snapshots) AND NOT EXISTS(SELECT 1 FROM character_production.planning_records) AND NOT EXISTS(SELECT 1 FROM character_production.approved_slots WHERE key='bound-enrolled-original') AND NOT EXISTS(SELECT 1 FROM character_production.schedules WHERE key='bound-enrolled-original')"
 for expression in [call(enrollment='ffffffff-ffff-4fff-8fff-ffffffffffff'),call(ordinal=1),call(ordinal=-1),call(text=snap+' ')]:
  assert own('SELECT '+expression)==''
  db.check(empty,'wrong scope or snapshot cannot write')
 bad=copy.deepcopy(p['validation']);bad['slotDigest']='f'*64
 assert own('SELECT '+call(validation=bad))==''
 db.check(empty,'wrong validation cannot write')
 for mutation in ["UPDATE character_production.planning_policies SET enabled=false", "UPDATE character_production.scheduler_binding SET enabled=false", "UPDATE auth.users SET raw_app_meta_data='{}' WHERE id='"+planner.ACT+"'"]:
  db.run("BEGIN; "+mutation+"; SET ROLE character_production_owner; DO $$ BEGIN IF "+call()+" IS NOT NULL THEN RAISE EXCEPTION 'revoked scope accepted'; END IF; END $$; ROLLBACK;")
  db.check(empty,'revoked authority cannot write')
 own('BEGIN; SELECT '+call()+'; ROLLBACK;')
 db.check(empty,'scoped planner and binding roll back together')
 before=db.run("SELECT jsonb_agg(to_jsonb(b) ORDER BY provider,period) FROM character_production.budgets b")
 result=json.loads(own('SELECT '+call()));assert result['snapshotSha256']==digest and result['replayed'] is False and result['draftId']==p['draftId'] and result['key']==s['key'] and result['digest']==d
 repeated=json.loads(own('SELECT '+call()));assert repeated['replayed'] is True and repeated['snapshotSha256']==digest
 assert own('SELECT '+call(text=snap+' '))==''
 db.check("(SELECT count(*)=1 FROM character_production.binding_snapshots) AND (SELECT count(*)=1 FROM character_production.planning_records)",'exactly one immutable binding and plan')
 assert before==db.run("SELECT jsonb_agg(to_jsonb(b) ORDER BY provider,period) FROM character_production.budgets b"),'planning does not reserve or spend'
 for role in ['anon','authenticated','service_role','character_production_generator','character_production_output_broker']:
  db.check('NOT has_function_privilege('+db.quote(role)+",'public.character_production_scheduler_plan_bound(uuid,integer,jsonb,text)','EXECUTE')",'no scoped runtime grant')
 db.finish('scheduler-plan-bound')
if __name__=='__main__':
 original=db.run;db.run=verbatim_run
 try:suite()
 finally:db.run=original
