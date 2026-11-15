"""Disposable PG17 only. Real chained schema/principal; synthetic rows only."""
import copy, datetime, hashlib, json
import validate_ledger as db
import validate_planner as planner
import validate_planner_install as foundation

def suite():
 foundation.suite()
 db.check("current_setting('server_version_num')::integer BETWEEN 170000 AND 179999",'PG17 only')
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; '+(db.ROOT/'docs/proposals/character-production-scheduler-principal.sql').read_text())
 proposal=(db.ROOT/'docs/proposals/character-production-enrolled-queues.sql').read_text()
 db.run('SET ROLE character_production_owner; '+proposal.replace('COMMIT;','ROLLBACK;'))
 db.check("to_regprocedure('public.character_production_scheduler_due(uuid,text,text,integer)') IS NULL",'proposal rollback')
 db.run('SET ROLE character_production_owner; '+proposal)
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner')
 for fn in ['due','pending']:
  sig='public.character_production_scheduler_'+fn+'(uuid,text,text,integer)'
  for role in ['anon','authenticated','service_role','character_production_generator','character_production_output_broker']:
   db.check('NOT has_function_privilege('+db.quote(role)+','+db.quote(sig)+",'EXECUTE')",'no proposal grants')
  # Synthetic isolated test grant, never part of proposal.
  db.run('GRANT EXECUTE ON FUNCTION '+sig+' TO service_role')
 slot,digest,plan=planner.fixture('owned-due')
 at=datetime.datetime.now(datetime.timezone.utc)
 when=(at-datetime.timedelta(seconds=10)).isoformat(timespec='milliseconds').replace('+00:00','Z')
 e='44444444-4444-4444-8444-444444444444';p=planner.POL
 q=lambda x:db.quote(json.dumps(x))+'::jsonb'
 slots=[]
 for key in ['owned-due','owned-pending']:
  s=copy.deepcopy(slot);s['key']=key
  digest=hashlib.sha256(json.dumps(list(s.values()),separators=(',',':')).encode()).hexdigest()
  slots.append((s,digest))
 candidates=[dict(ordinal=i,slot=s,digest=d,draftId=('55555555-5555-4555-8555-55555555555'+str(i)),theme='synthetic-theme',scheduledAt=when) for i,(s,d) in enumerate(slots)]
 db.run("INSERT INTO character_production.budgets(provider,period,cap_cents,reserved_cents,enabled) VALUES('heygen',"+db.quote(slot['period'])+",2000,0,true) ON CONFLICT(provider,period) DO UPDATE SET cap_cents=2000,enabled=true")
 db.run("INSERT INTO character_production.planning_policies VALUES('"+p+"',1,true,'{\"evidenceRef\":\"synthetic:queue-only\"}',"+db.quote(slot['period'])+",to_timestamp("+str(slot['authorizationExpiresAt'])+"/1000.0),ARRAY['synthetic-persona'],ARRAY['synthetic-theme'],31,45,2000,'d61468fdf18c4b478f27857337ddd1ea')")
 db.run("INSERT INTO character_production.scheduler_enrollments SELECT '"+e+"',id,revision,'"+planner.ACT+"',to_jsonb(p),"+q(candidates)+",repeat('d',64),'synthetic:queue-only',clock_timestamp()-interval '1 minute',expires_at,true FROM character_production.planning_policies p WHERE id='"+p+"'")
 for c in candidates:
  db.run("INSERT INTO character_production.scheduler_candidates VALUES('"+e+"',"+str(c['ordinal'])+","+q(c['slot'])+","+db.quote(c['digest'])+",'"+c['draftId']+"','synthetic-theme',"+db.quote(when)+")")
 db.run("INSERT INTO character_production.scheduler_binding VALUES('cafe-character-planner','"+e+"',true)")
 def row(s,d,pending=False,foreign=False):
  key=s['key'];scheduled="clock_timestamp()-interval '30 seconds'" if foreign else db.quote(when)+'::timestamptz'
  db.run("INSERT INTO character_production.approved_slots(key,slot,digest,enabled) VALUES("+db.quote(key)+","+q(s)+","+db.quote(d)+",true); INSERT INTO character_production.schedules VALUES("+db.quote(key)+","+db.quote(d)+","+scheduled+",to_timestamp("+str(s['authorizationExpiresAt'])+"/1000.0),true)")
  if pending:
   db.run("INSERT INTO character_production.jobs(key,slot,digest,provider,model,period,provider_binding_revision,cost,state,task,created_at) VALUES("+db.quote(key)+","+q(s)+","+db.quote(d)+",'heygen','avatar_iv',"+db.quote(s['period'])+","+db.quote(s['providerBindingRevision'])+",1,'submitted',"+db.quote('task-'+key)+"," + ("clock_timestamp()-interval '1 hour'" if foreign else 'clock_timestamp()')+")")
 for i in range(40):
  s=copy.deepcopy(slot);s['key']='foreign-'+str(i);row(s,'f'*64,i<10,True)
 for i,(s,d) in enumerate(slots):row(s,d,i==1)
 snapshot=lambda:db.run("SELECT md5(coalesce(jsonb_agg(to_jsonb(j) ORDER BY key)::text,'')) FROM character_production.jobs j WHERE key LIKE 'foreign-%'")
 before=snapshot()
 rpc=lambda fn,limit=1:db.run("SET ROLE service_role; SELECT public.character_production_scheduler_"+fn+"('"+e+"','heygen','avatar_iv',"+str(limit)+")")
 assert json.loads(rpc('due'))['rows'][0]['slot']['key']=='owned-due'
 assert json.loads(rpc('pending'))[0]['key']=='owned-pending'
 assert rpc('pending',6)=='' and rpc('due',26)==''
 # Current principal detects policy revision changes. Rolled back, no authority repair.
 db.run("BEGIN; UPDATE character_production.planning_policies SET revision=revision+1 WHERE id='"+p+"'; SET ROLE service_role; DO $$ BEGIN IF public.character_production_scheduler_due('"+e+"','heygen','avatar_iv',1) IS NOT NULL THEN RAISE EXCEPTION 'revoked policy accepted'; END IF; END $$; ROLLBACK;")
 db.run("UPDATE character_production.scheduler_binding SET enabled=false WHERE enrollment_id='"+e+"'")
 assert rpc('due')=='' and rpc('pending')==''
 assert snapshot()==before,'foreign jobs untouched'
 db.finish('enrolled-queues')
if __name__=='__main__':suite()
