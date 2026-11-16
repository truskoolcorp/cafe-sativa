"""Disposable PG17 only: real planner/selection chain, no live credentials."""
import copy,hashlib,json,subprocess,time
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
 snap=json.dumps({'version':1,'account':{'model':'avatar_iv'},'image':{'characterId':s['characterId'],'canonicalRevision':s['canonicalRevision'],'portraitSha256':s['portraitSha256'],'audio':{'voiceId':s['voiceId'],'scriptSha256':hashlib.sha256(s['script'].encode()).hexdigest()}},'speech':{'fixture':'SQL-only; TS binding tests validate full media proof'}},separators=(',',':'))
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
 db.run("UPDATE character_production.scheduler_binding SET enabled=false")
 assert read(collect['selectionToken'])==''
 db.finish('binding-snapshot')
if __name__=='__main__':
 original=db.run;db.run=verbatim_run
 try:suite()
 finally:db.run=original
