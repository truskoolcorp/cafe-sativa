"""Disposable PG17 only. Genuine chained foundation, synthetic candidate rows.
No provider/network calls. No production installer or runtime grant is included.
"""
import concurrent.futures, copy, datetime, hashlib, json, subprocess
import validate_ledger as db
import validate_planner as planner
import validate_planner_install as foundation


def suite():
 foundation.suite()
 db.check("current_setting('server_version_num')::integer BETWEEN 170000 AND 179999", 'PG17 only')
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; '+(db.ROOT/'docs/proposals/character-production-scheduler-principal.sql').read_text())
 source=(db.ROOT/'docs/proposals/character-production-recurring-selection.sql').read_text()
 # An unfamiliar role in inherited defaults must fail closed, not silently
 # gain wrapper/ledger access. The failing proposal transaction rolls back.
 db.run('CREATE ROLE unexpected_recurring_default NOLOGIN; ALTER DEFAULT PRIVILEGES FOR ROLE character_production_owner GRANT EXECUTE ON FUNCTIONS TO unexpected_recurring_default; ALTER DEFAULT PRIVILEGES FOR ROLE character_production_owner GRANT SELECT ON TABLES TO unexpected_recurring_default;')
 rejected=subprocess.run(db.command(),input='SET ROLE character_production_owner; '+source,text=True,capture_output=True)
 assert rejected.returncode and 'exact owner-only ACL required' in rejected.stderr, rejected.stderr
 db.check("to_regclass('character_production.recurring_selections') IS NULL", 'unexpected default grant rolled back')
 db.run('ALTER DEFAULT PRIVILEGES FOR ROLE character_production_owner REVOKE EXECUTE ON FUNCTIONS FROM unexpected_recurring_default; ALTER DEFAULT PRIVILEGES FOR ROLE character_production_owner REVOKE SELECT ON TABLES FROM unexpected_recurring_default; DROP ROLE unexpected_recurring_default;')
 before_auth=foundation.auth_snapshot()
 role_snapshot=lambda:db.run("SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_roles r),(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m))")
 before_roles=role_snapshot()
 db.run('SET ROLE character_production_owner; '+source)
 db.check("to_regclass('character_production.recurring_selections') IS NULL", 'rollback leaves no selection table')
 assert source.rstrip().endswith('ROLLBACK;')
 # Only this fresh, disposable fixture converts the source rehearsal to commit.
 db.run('SET ROLE character_production_owner; '+source.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner')
 assert foundation.auth_snapshot()==before_auth, 'auth source and defaults unchanged'
 assert role_snapshot()==before_roles, 'no roles/memberships changed'
 signatures=['character_production_recurring_next(uuid)', 'character_production_recurring_selected(uuid,uuid)', 'character_production_recurring_finish(uuid,uuid,text)']
 for role in ['anon','authenticated','service_role','character_production_generator','character_production_output_broker']:
  db.check('NOT has_table_privilege('+db.quote(role)+",'character_production.recurring_selections','SELECT,INSERT,UPDATE,DELETE')",'no selection-table grants')
  db.check('NOT has_function_privilege('+db.quote(role)+",'character_production.recurring_eligible(uuid)','EXECUTE')",'no helper access')
  for sig in signatures:
   db.check('NOT has_function_privilege('+db.quote(role)+','+db.quote('public.'+sig)+",'EXECUTE')",'no runtime wrapper grant')
 # Test-only isolated execute grants. Not part of proposal or deployment.
 db.run('GRANT EXECUTE ON FUNCTION '+','.join('public.'+s for s in signatures)+' TO service_role')
 e='cccccccc-cccc-4ccc-8ccc-cccccccccccc'; p=planner.POL
 q=lambda x:db.quote(json.dumps(x))+'::jsonb'
 slot,digest,plan=planner.fixture('fair-selection')
 at=datetime.datetime.now(datetime.timezone.utc)
 when=(at-datetime.timedelta(seconds=10)).isoformat(timespec='milliseconds').replace('+00:00','Z')
 candidates=[]
 for i,key in enumerate(['collect-original','qa-held-head','qa-next','generate-once']):
  s=copy.deepcopy(slot);s['key']=key
  digest=hashlib.sha256(json.dumps(list(s.values()),separators=(',',':')).encode()).hexdigest()
  candidates.append(dict(ordinal=i,slot=s,digest=digest,draftId='dddddddd-dddd-4ddd-8ddd-'+str(i).zfill(12),theme='synthetic-theme',scheduledAt=when))
 db.run("INSERT INTO character_production.budgets(provider,period,cap_cents,reserved_cents,enabled) VALUES('heygen',"+db.quote(slot['period'])+",2000,0,true) ON CONFLICT(provider,period) DO UPDATE SET cap_cents=2000,enabled=true")
 db.run("INSERT INTO character_production.planning_policies VALUES('"+p+"',1,true,'{\"evidenceRef\":\"synthetic:fair-only\"}',"+db.quote(slot['period'])+",to_timestamp("+str(slot['authorizationExpiresAt'])+"/1000.0),ARRAY['synthetic-persona'],ARRAY['synthetic-theme'],31,45,2000,'d61468fdf18c4b478f27857337ddd1ea')")
 db.run("INSERT INTO character_production.scheduler_enrollments SELECT '"+e+"',id,revision,'"+planner.ACT+"',to_jsonb(p),"+q(candidates)+",repeat('d',64),'synthetic:fair-only',clock_timestamp()-interval '1 minute',expires_at,true FROM character_production.planning_policies p WHERE id='"+p+"'")
 for c in candidates:
  s=c['slot'];key=s['key']
  db.run("INSERT INTO character_production.scheduler_candidates VALUES('"+e+"',"+str(c['ordinal'])+","+q(s)+","+db.quote(c['digest'])+",'"+c['draftId']+"','synthetic-theme',"+db.quote(when)+"); INSERT INTO character_production.approved_slots(key,slot,digest,enabled) VALUES("+db.quote(key)+","+q(s)+","+db.quote(c['digest'])+",true); INSERT INTO character_production.schedules VALUES("+db.quote(key)+","+db.quote(c['digest'])+","+db.quote(when)+",to_timestamp("+str(s['authorizationExpiresAt'])+"/1000.0),true)")
  if c['ordinal']<3:
   db.run("INSERT INTO character_production.jobs(key,slot,digest,provider,model,period,provider_binding_revision,cost,state,task) VALUES("+db.quote(key)+","+q(s)+","+db.quote(c['digest'])+",'heygen','avatar_iv',"+db.quote(s['period'])+","+db.quote(s['providerBindingRevision'])+",1,'submitted',"+db.quote('task-'+key)+")")
  if c['ordinal'] in (1,2):
   db.run("INSERT INTO public.cs_character_promo_drafts(id,character_id,promo_key,specialty,title,spoken_script,visual_brief,duration_seconds) VALUES('"+c['draftId']+"','synthetic-persona',"+db.quote('qa-'+key)+",'QA','Synthetic',"+db.quote(s['script'])+",'Synthetic',8); INSERT INTO character_production.qa_slot_bindings SELECT a.key,a.digest,a.slot,d.id,d.updated_at,true FROM character_production.approved_slots a,public.cs_character_promo_drafts d WHERE a.key="+db.quote(key)+" AND d.id='"+c['draftId']+"'; UPDATE character_production.jobs SET state='pending_qa',sha=repeat('b',64),bytes=64,bucket='character-production-private',object_path=digest||'/'||repeat('b',64)||'.mp4' WHERE key="+db.quote(key))
 rpc=lambda expr:db.run('SET ROLE service_role; SELECT '+expr)
 nxt="public.character_production_recurring_next('"+e+"')"
 assert rpc(nxt)=='', 'unbound enrollment cannot select'
 db.run("INSERT INTO character_production.scheduler_binding VALUES('cafe-character-planner','"+e+"',true)")
 snapshot=lambda:db.run("SELECT jsonb_build_object('jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY key) FROM character_production.jobs j),'budgets',(SELECT jsonb_agg(to_jsonb(b) ORDER BY provider,period) FROM character_production.budgets b))")
 before=snapshot()
 first=json.loads(rpc(nxt));assert first['phase']=='collect' and first['ordinal']==0
 # Three independent connections see committed selection claims, not an
 # in-process counter. Uncertain original polling blocks new generation, but
 # unrelated private QA continues and cannot be selected twice.
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  results=list(pool.map(lambda _:rpc(nxt),range(3)))
 selected=[json.loads(r) for r in results if r]
 assert sorted(r['ordinal'] for r in selected)==[1,2],selected
 rows={r['ordinal']:r for r in selected}
 assert len({r['selectionToken'] for r in [first]+selected})==3
 current=lambda r:"public.character_production_recurring_selected('"+e+"','"+r['selectionToken']+"')"
 finish=lambda r,outcome:"public.character_production_recurring_finish('"+e+"','"+r['selectionToken']+"',"+db.quote(outcome)+")"
 assert json.loads(rpc(current(rows[2])))['key']=='qa-next'
 for expression in [nxt,current(first),finish(first,'settled')]:
  db.run("BEGIN ISOLATION LEVEL REPEATABLE READ; SET ROLE service_role; DO $$ BEGIN IF "+expression+" IS NOT NULL THEN RAISE EXCEPTION 'repeatable-read selection accepted'; END IF; END $$; ROLLBACK")
 assert rpc("public.character_production_recurring_selected('"+e+"','00000000-0000-4000-8000-000000000000')")==''
 assert rpc(finish(rows[1],'held'))=='held'
 assert rpc(finish(rows[1],'settled'))=='', 'completed token cannot be reused'
 assert rpc(current(rows[1]))=='', 'held token cannot dispatch'
 assert rpc(finish(first,'settled'))=='ready'
 db.check("(SELECT next_check_at>clock_timestamp()+interval '50 seconds' FROM character_production.recurring_selections WHERE ordinal=0)", 'bounded original polling backoff')
 assert rpc(nxt)=='', 'backoff and in-flight state persist across connections'
 # Old timestamps do NOT expire or reclaim uncertain selections. Only the
 # isolated fixture owner moves the known settled collector deadline for test.
 db.run("UPDATE character_production.recurring_selections SET last_selected_at=clock_timestamp()-interval '1 year' WHERE ordinal=2; UPDATE character_production.recurring_selections SET next_check_at=clock_timestamp()-interval '1 second' WHERE ordinal=0")
 second=json.loads(rpc(nxt));assert second['ordinal']==0 and second['selectionToken']!=first['selectionToken']
 assert rpc(finish(first,'settled'))=='', 'stale collector token cannot finish successor'
 assert rpc(finish(second,'held'))=='held'
 assert rpc(nxt)=='', 'held collector never reclaims even while source still pending'
 assert snapshot()==before, 'selection and finish never mutate paid jobs/budgets'
 # A trusted source fixture transition ends the original task. Selector does
 # not perform it. Generation is now possible for the exact approved candidate.
 db.run("UPDATE character_production.jobs SET state='failed' WHERE key='collect-original'")
 before=snapshot()
 gen=json.loads(rpc(nxt));assert gen['phase']=='generate' and gen['key']=='generate-once'
 assert gen['payload']['slot']==candidates[3]['slot'] and gen['digest']==candidates[3]['digest']
 assert rpc(finish(gen,'settled'))=='held', 'absence of job receipt cannot imply generation completed'
 assert rpc(nxt)=='', 'generation selection is never reset/replayed'
 assert snapshot()==before
 # The actual QA ingestion receipt determines done; caller claim alone does not.
 c=candidates[2]
 db.run("INSERT INTO character_production.qa_targets SELECT b.slot_key,b.digest,b.promo_id,b.expected_updated_at,true FROM character_production.qa_slot_bindings b WHERE b.slot_key='qa-next'; INSERT INTO character_production.qa_ingestion_receipts SELECT j.key,j.digest,b.promo_id,b.expected_updated_at,b.expected_updated_at,j.sha,j.bytes,'cafe-sativa-content','synthetic/qa-next.mp4',clock_timestamp() FROM character_production.jobs j JOIN character_production.qa_slot_bindings b ON b.slot_key=j.key WHERE j.key='qa-next'")
 assert rpc(finish(rows[2],'settled'))=='done'
 assert rpc(current(rows[2]))==''
 # All operations deny after the actual enrollment is revoked. No implicit
 # recovery, reset or new enrollment is created by this proposal.
 db.run("UPDATE character_production.scheduler_binding SET enabled=false WHERE enrollment_id='"+e+"'")
 assert rpc(nxt)=='' and rpc(current(first))=='' and rpc(finish(first,'held'))==''
 db.finish('recurring-selection')

if __name__=='__main__':suite()
