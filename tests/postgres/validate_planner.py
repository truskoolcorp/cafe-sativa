#!/usr/bin/env python3
"""Disposable PG17 planner contract. Never a live installer or activation.
Calendar/admin dependencies are explicit test doubles; wallet/claim integration
remains a separate required integration test, not asserted by this suite.
"""
import concurrent.futures, copy, hashlib, json, subprocess, time
import validate_ledger as db
import validate_qa_recurring as base
POL='77777777-7777-4777-8777-777777777777'
ACT='88888888-8888-4888-8888-888888888888'
SIG='public.character_production_plan(jsonb,text,jsonb,uuid,bigint,uuid)'

def fixture(key='planner-race', cost=35):
 clock=json.loads(db.run("SELECT jsonb_build_object('period',to_char(now() AT TIME ZONE 'America/Chicago','YYYY-MM'),'scheduled',now()+interval '10 minutes','expiry',floor(extract(epoch FROM (date_trunc('month',now() AT TIME ZONE 'America/Chicago')+interval '1 month') AT TIME ZONE 'America/Chicago')*1000)::bigint,'observed',clock_timestamp())"))
 slot=dict(key=key,characterId='synthetic-persona',script='Synthetic private QA script',canonicalRevision='a'*64,voiceId='synthetic_voice',portraitSha256='b'*64,provider='heygen',model='avatar_iv',durationSeconds=8,authorizationId='synthetic-policy',authorizationExpiresAt=clock['expiry'],period=clock['period'],quoteCents=cost,periodCapCents=2000,providerBindingRevision='c'*64)
 digest=hashlib.sha256(json.dumps(list(slot.values()),ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
 plan=dict(version=1,draftId='99999999-9999-4999-8999-999999999999',scheduledAt=clock['scheduled'],theme='synthetic-theme',validation=dict(brand='cafe-sativa',accountId='d61468fdf18c4b478f27857337ddd1ea',slotDigest=digest,canonicalRevision='a'*64,providerBindingRevision='c'*64,theme='synthetic-theme',rightsApproved=True,sourceBound=True,evidenceRef='synthetic:ci-only',observedAt=clock['observed']))
 return slot,digest,plan

def call(s,d,p,actor=ACT):
 return 'public.character_production_plan('+','.join([db.quote(json.dumps(s))+'::jsonb',db.quote(d),db.quote(json.dumps(p))+'::jsonb',db.quote(POL)+'::uuid','1',db.quote(actor)+'::uuid'])+')'

def restricted(sql):return db.run('SET SESSION AUTHORIZATION character_production_owner; '+sql)
def denied(s,d,p,actor=ACT):restricted('DO $$ BEGIN IF '+call(s,d,p,actor)+" IS NOT NULL THEN RAISE EXCEPTION 'invalid plan accepted'; END IF; END $$;")
def suite():
 base.suite()
 db.check("current_setting('server_version_num')::integer BETWEEN 170000 AND 179999",'PG17')
 db.run("GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; CREATE FUNCTION character_production.calendar_period(text,timestamptz) RETURNS text LANGUAGE sql STABLE STRICT SET search_path=pg_catalog AS $$ SELECT to_char($2 AT TIME ZONE CASE WHEN $1='heygen' THEN 'America/Chicago' ELSE 'UTC' END,'YYYY-MM') $$;")
 # Boolean source-owner shim exposes no source rows or membership table.
 db.run("SET SESSION AUTHORIZATION provision_installer; CREATE FUNCTION public.cs_cafe_metricool_is_admin(uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT $1='"+ACT+"'::uuid $$; REVOKE ALL ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) TO character_production_owner;")
 sql=(db.ROOT/'docs/proposals/character-production-planner.sql').read_text()
 restricted(sql.replace('COMMIT;','ROLLBACK;'))
 db.check("to_regclass('character_production.planning_records') IS NULL",'planner DDL rolls back')
 restricted(sql)
 policy_read=(db.ROOT/'docs/proposals/character-production-planner-policy-read.sql').read_text()
 restricted(policy_read.replace('COMMIT;','ROLLBACK;'))
 db.check("to_regprocedure('public.character_production_planning_policy(uuid)') IS NULL",'policy reader DDL rollback')
 restricted(policy_read)
 db.run('GRANT EXECUTE ON FUNCTION public.character_production_planned_draft(uuid,jsonb,text,text) TO provision_installer; SET SESSION AUTHORIZATION provision_installer; '+(db.ROOT/'docs/proposals/character-production-planner-draft-helper.sql').read_text()+ ' GRANT EXECUTE ON FUNCTION public.character_production_new_blank_draft(uuid,jsonb,text,text) TO character_production_owner;')
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner; REVOKE ALL ON FUNCTION character_production.calendar_period(text,timestamptz) FROM PUBLIC;')
 db.check("(SELECT NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname='character_production_owner')",'non-superuser function owner')
 for r in ['anon','authenticated','service_role','character_production_generator','character_production_output_broker']:
  db.check('NOT has_function_privilege('+db.quote(r)+','+db.quote(SIG)+",'EXECUTE')",'no runtime execute')
  db.check('NOT has_function_privilege('+db.quote(r)+",'public.character_production_planning_policy(uuid)','EXECUTE')",'no runtime policy read')
  read_proc=subprocess.run(db.command(),input='SET SESSION AUTHORIZATION '+r+"; SELECT public.character_production_planning_policy(NULL);",text=True,capture_output=True)
  assert read_proc.returncode and 'permission denied' in read_proc.stderr,read_proc.stderr
  db.check('NOT has_table_privilege('+db.quote(r)+",'character_production.planning_records','SELECT,INSERT,UPDATE,DELETE')",'no provenance access')
  proc=subprocess.run(db.command(),input='SET SESSION AUTHORIZATION '+r+'; SELECT public.character_production_plan(NULL,NULL,NULL,NULL,NULL,NULL);',text=True,capture_output=True)
  assert proc.returncode and 'permission denied' in proc.stderr,proc.stderr
 db.run("INSERT INTO character_production.budgets(provider,period,cap_cents,reserved_cents,enabled) VALUES('heygen',to_char(now() AT TIME ZONE 'America/Chicago','YYYY-MM'),2000,35,true) ON CONFLICT(provider,period) DO UPDATE SET cap_cents=2000; INSERT INTO character_production.planning_policies VALUES('"+POL+"',1,true,'{\"synthetic\":true}',to_char(now() AT TIME ZONE 'America/Chicago','YYYY-MM'),(date_trunc('month',now() AT TIME ZONE 'America/Chicago')+interval '1 month') AT TIME ZONE 'America/Chicago',ARRAY['synthetic-persona'],ARRAY['synthetic-theme'],31,45,2000,'d61468fdf18c4b478f27857337ddd1ea');")
 # Missing approval reference returns no policy, never a synthetic authority.
 reader="public.character_production_planning_policy('"+POL+"'::uuid)"
 restricted('DO $$ BEGIN IF '+reader+" IS NOT NULL THEN RAISE EXCEPTION 'missing owner reference accepted'; END IF; END $$;")
 restricted("BEGIN; UPDATE character_production.planning_policies SET revision=2,owner_evidence='{\"evidenceRef\":\"synthetic:ci-approved-reference\",\"privateField\":\"must-not-leak\"}' WHERE id='"+POL+"'; DO $$ DECLARE r jsonb:="+reader+"; BEGIN IF r->'policy'->>'id'<> '"+POL+"' OR r->'policy'->>'revision'<>'2' OR r->'policy'->>'ownerEvidenceRef'<>'synthetic:ci-approved-reference' OR r->'policy'->>'capCents'<>'2000' OR r->'policy'->>'accountId'<>'d61468fdf18c4b478f27857337ddd1ea' OR r->'policy'->'characters'<> '[\"synthetic-persona\"]'::jsonb OR r->'policy'->'themes'<> '[\"synthetic-theme\"]'::jsonb OR (r->>'observedAt')::bigint>extract(epoch FROM clock_timestamp())*1000 OR (r->>'observedAt')::bigint<extract(epoch FROM clock_timestamp()-interval '5 seconds')*1000 OR r::text LIKE '%must-not-leak%' OR (SELECT count(*) FROM jsonb_object_keys(r))<>2 OR (SELECT count(*) FROM jsonb_object_keys(r->'policy'))<>9 THEN RAISE EXCEPTION 'policy projection mismatch'; END IF; END $$; ROLLBACK;")
 restricted("DO $$ BEGIN IF public.character_production_planning_policy('00000000-0000-4000-8000-000000000000') IS NOT NULL THEN RAISE EXCEPTION 'unknown policy exposed'; END IF; END $$;")
 for mutation in ["enabled=false", "expires_at=clock_timestamp()-interval '1 second'", "owner_evidence='{\"evidenceRef\":\"   \"}'", "owner_evidence='{\"evidenceRef\":123}'"]:
  restricted("BEGIN; UPDATE character_production.planning_policies SET revision=2,owner_evidence='{\"evidenceRef\":\"synthetic:approved\"}' WHERE id='"+POL+"'; UPDATE character_production.planning_policies SET revision=3,"+mutation+" WHERE id='"+POL+"'; DO $$ BEGIN IF "+reader+" IS NOT NULL THEN RAISE EXCEPTION 'invalid policy readable'; END IF; END $$; ROLLBACK;")
 s,d,p=fixture()
 for field,value in [('rightsApproved',False),('sourceBound',False),('accountId','wrong'),('slotDigest','f'*64),('observedAt','2000-01-01T00:00:00Z')]:
  bad=copy.deepcopy(p);bad['validation'][field]=value;denied(s,d,bad)
 denied(s,'f'*64,p);denied(s,d,p,'00000000-0000-4000-8000-000000000000')
 before=db.run("SELECT jsonb_build_object('jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY key) FROM character_production.jobs j),'budget',(SELECT jsonb_agg(to_jsonb(b) ORDER BY provider,period) FROM character_production.budgets b))")
 # Rollback after all helper writes must restore every planner-created row.
 restricted('BEGIN; SELECT '+call(s,d,p)+'; ROLLBACK;')
 db.check("NOT EXISTS(SELECT 1 FROM character_production.planning_records)",'atomic rollback')
 db.check("NOT EXISTS(SELECT 1 FROM public.cs_character_promo_drafts WHERE id='"+p['draftId']+"')",'blank draft rollback')
 # Source helper failure must roll back slots/schedule/provenance atomically.
 broken=copy.deepcopy(p);broken['draftId']='11111111-1111-4111-8111-111111111111'
 failure=subprocess.run(db.command(),input='SET SESSION AUTHORIZATION character_production_owner; SELECT '+call(s,d,broken)+';',text=True,capture_output=True)
 assert failure.returncode and 'duplicate key' in failure.stderr,failure.stderr
 db.check("NOT EXISTS(SELECT 1 FROM character_production.planning_records) AND NOT EXISTS(SELECT 1 FROM character_production.approved_slots WHERE key='planner-race')",'helper failure rolls back whole plan')
 oversized,od,op=fixture('over-cap',2001);denied(oversized,od,op)
 # Three independent connections contend on the policy row; only one creation.
 leader=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 leader.stdin.write("SET application_name='planner_race'; BEGIN; SET SESSION AUTHORIZATION character_production_owner; SELECT id FROM character_production.planning_policies WHERE id='"+POL+"' FOR UPDATE; SELECT pg_sleep(2); SELECT "+call(s,d,p)+"; COMMIT;\n");leader.stdin.close()
 for _ in range(80):
  if db.run("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='planner_race' AND wait_event='PgSleep')")=='t':break
  time.sleep(.05)
 else:raise AssertionError('race barrier absent')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(lambda _:json.loads(restricted('SELECT '+call(s,d,p)+';')),range(2)))
 leader.wait(timeout=15);err=leader.stderr.read();assert leader.returncode==0,err
 assert all(r['replayed'] is True for r in results),results
 db.check("(SELECT count(*)=1 FROM character_production.planning_records)",'one plan')
 db.check("(SELECT count(*)=1 FROM character_production.qa_slot_bindings WHERE slot_key='planner-race')",'one binding')
 db.check("(SELECT status='draft' AND video_asset_path IS NULL AND publication_approved_at IS NULL AND voice_approved_at IS NULL AND video_qa_approved_at IS NULL FROM public.cs_character_promo_drafts WHERE id='"+p['draftId']+"')",'no media or approval')
 after=db.run("SELECT jsonb_build_object('jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY key) FROM character_production.jobs j),'budget',(SELECT jsonb_agg(to_jsonb(b) ORDER BY provider,period) FROM character_production.budgets b))")
 assert before==after,'planning must not create jobs or reserve/spend credits'
 s2,d2,p2=fixture('same-day-other');p2['draftId']='99999999-9999-4999-8999-999999999998';denied(s2,d2,p2)
 restricted("UPDATE character_production.planning_policies SET enabled=false,revision=2 WHERE id='"+POL+"';")
 denied(s,d,p)
 restricted('DO $$ BEGIN IF '+reader+" IS NOT NULL THEN RAISE EXCEPTION 'revoked policy exposed'; END IF; END $$;")
 db.check("NOT EXISTS(SELECT 1 FROM character_production.approved_slots WHERE key='planner-race' AND enabled) AND NOT EXISTS(SELECT 1 FROM character_production.schedules WHERE key='planner-race' AND enabled)",'revocation')
 db.finish('planner')
if __name__=='__main__':suite()
