#!/usr/bin/env python3
"""Synthetic PostgreSQL 17 tests; never run against an existing/shared cluster."""
import json, os, pathlib, re, subprocess
ROOT=pathlib.Path(__file__).resolve().parents[2]
LOG=[]
def quote(value): return "'"+str(value).replace("'","''")+"'"
def command():
 if os.environ.get('PG_TEST_SERVER')=='1':
  if os.environ.get('PG_DISPOSABLE_TEST_CONFIRM')!='yes' or not os.environ.get('PGDATABASE','').startswith('character_ci_') or not (os.environ.get('PGHOST','').startswith('/') or os.environ.get('PGHOST') in ['127.0.0.1','localhost','::1']):
   raise SystemExit('Server mode requires explicit disposable local character_ci_ database.')
  return [os.environ.get('PSQL','psql'),'-X','-qAt','-v','ON_ERROR_STOP=1']
 binary,data=os.environ.get('PG_BIN'),os.environ.get('PG_DATA')
 if not binary or not data: raise SystemExit('Standalone mode requires explicit PG_BIN and PG_DATA for a stopped disposable cluster.')
 return [binary,'--single','-D',data,'postgres']
def run(sql):
 text=' '.join(re.sub(r'--[^\n]*','',sql).splitlines())+'\n'
 p=subprocess.run(command(),input=text,text=True,capture_output=True,timeout=30)
 result=p.stdout+p.stderr;LOG.append(result)
 if p.returncode or re.search(r'ERROR:|FATAL:|PANIC:',result): raise RuntimeError(result)
 return p.stdout.strip()
def check(expr,label):
 run('DO $$ BEGIN IF ('+expr+') IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '+quote(label)+'; END IF; END $$;')
def install(name):
 source=(ROOT/'docs/proposals'/name).read_text()
 run('SET ROLE ledger_owner; '+source.replace('COMMIT;','ROLLBACK;')+' RESET ROLE;')
 table='character_production.jobs' if name=='character-production-store.sql' else 'character_production.qa_targets'
 check('to_regclass('+quote(table)+') IS NULL','transactional rollback')
 run('SET ROLE ledger_owner; '+source+' RESET ROLE;')
def privileges():
 run("""DO $$ DECLARE r text; p record; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','ledger_worker'] LOOP
 IF has_schema_privilege(r,'character_production','USAGE') THEN RAISE EXCEPTION 'schema grant leak %',r; END IF;
 FOR p IN SELECT oid FROM pg_proc WHERE pronamespace='character_production'::regnamespace OR proname LIKE 'character_production_%' LOOP
 IF has_function_privilege(r,p.oid,'EXECUTE') THEN RAISE EXCEPTION 'function grant leak % %',r,p.oid; END IF; END LOOP;
 FOR p IN SELECT oid FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relkind='r' LOOP
 IF has_table_privilege(r,p.oid,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'table grant leak %',r; END IF; END LOOP;
 END LOOP; END $$;""")
def fixture(provider,keys,cap=100,cost=40,expiry='1 day'):
 run("INSERT INTO character_production.budgets(provider,period,cap_cents,enabled) VALUES("+quote(provider)+",to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM'),"+str(cap)+",true);")
 for key in keys:
  run("INSERT INTO character_production.approved_slots(key,slot,digest,enabled) SELECT "+quote(key)+",jsonb_build_object('key',"+quote(key)+",'provider',"+quote(provider)+",'model','test-model','characterId','test-character','script','Synthetic script','period',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM'),'periodCapCents',"+str(cap)+",'quoteCents',"+str(cost)+",'authorizationId','test-auth','authorizationExpiresAt',floor(extract(epoch FROM clock_timestamp()+interval "+quote(expiry)+")*1000)::bigint,'providerBindingRevision',repeat('b',64)),repeat('a',64),true;")
def claim(key): return '(SELECT public.character_production_claim(slot,digest) FROM character_production.approved_slots WHERE key='+quote(key)+')'
def finish(name):
 (ROOT/'evidence').mkdir(exist_ok=True)
 (ROOT/'evidence'/('postgres-'+name+'-validation.log')).write_text('\n'.join(LOG)+'\nPASS '+name+'\n')
 LOG.clear();print('PASS: '+name+' (serial PostgreSQL assertions)')
def suite():
 check("current_setting('server_version_num')::integer BETWEEN 170000 AND 179999",'PostgreSQL 17 required')
 check("to_regnamespace('character_production') IS NULL",'fresh cluster required')
 run("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE ledger_worker NOLOGIN; CREATE ROLE ledger_owner NOLOGIN;")
 run("ALTER DEFAULT PRIVILEGES FOR ROLE ledger_owner GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES FOR ROLE ledger_owner GRANT ALL ON TABLES TO anon,authenticated,service_role; DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO ledger_owner',current_database()); END $$; GRANT CREATE ON SCHEMA public TO ledger_owner;")
 install('character-production-store.sql');privileges();fixture('serial',['first','second','third'])
 check("(SELECT public.character_production_claim(slot||'{\"model\":\"tampered\"}',digest) FROM character_production.approved_slots WHERE key='first') IS NULL",'tampered slot denied')
 check(claim('first')+' IS NOT NULL','valid claim');check(claim('first')+' IS NULL','same key denied')
 check("(SELECT j.slot=a.slot FROM character_production.jobs j JOIN character_production.approved_slots a USING(key) WHERE key='first')",'immutable slot stored')
 check("NOT public.character_production_submitted('first','wrong',repeat('a',64),'task-1')",'wrong token denied')
 check("(SELECT public.character_production_submitted(key,token,digest,'task-1') FROM character_production.jobs WHERE key='first')",'valid submission')
 job="(public.character_production_pending('serial','test-model',5)->0)"
 check('NOT public.character_production_output('+job+"||jsonb_build_object('providerBindingRevision',repeat('c',64)),repeat('d',64),100)",'wrong provider binding denied')
 check('public.character_production_output('+job+",repeat('d',64),100)",'output accepted')
 run("DO $$ DECLARE j jsonb; BEGIN SELECT jsonb_build_object('key',key,'token',token,'digest',digest,'taskId',task,'provider',provider,'model',model,'providerBindingRevision',provider_binding_revision) INTO j FROM character_production.jobs WHERE key='first'; IF NOT public.character_production_output(j,repeat('d',64),100) OR public.character_production_output(j,repeat('e',64),100) OR public.character_production_output(j,repeat('d',64),101) THEN RAISE EXCEPTION 'output CAS failed'; END IF; END $$;")
 check(claim('second')+' IS NOT NULL','second claim')
 run("DO $$ BEGIN BEGIN PERFORM public.character_production_submitted(key,token,digest,'task-1') FROM character_production.jobs WHERE key='second'; RAISE EXCEPTION 'duplicate task accepted'; EXCEPTION WHEN unique_violation THEN NULL; END; END $$; SELECT public.character_production_unknown(key,token,digest) FROM character_production.jobs WHERE key='second';")
 check(claim('third')+' IS NULL','shared budget cap');check("(SELECT reserved_cents=80 FROM character_production.budgets WHERE provider='serial')",'no unknown refund')
 fixture('expired',['expired'],expiry='-1 second');check(claim('expired')+' IS NULL','expired claim denied')
 fixture('month',['month']);run("INSERT INTO character_production.budgets(provider,period,cap_cents,enabled) VALUES('month','2000-01',100,true); UPDATE character_production.approved_slots SET slot=slot||'{\"period\":\"2000-01\"}' WHERE key='month';")
 check(claim('month')+' IS NULL','wrong UTC month denied')
 fixture('binding',['binding']);run("UPDATE character_production.approved_slots SET slot=slot-'providerBindingRevision' WHERE key='binding';");check(claim('binding')+' IS NULL','missing binding denied')
 run("DO $$ DECLARE old_revision text; BEGIN old_revision:=public.character_production_authorization('third','test-auth')->>'revision'; UPDATE character_production.approved_slots SET enabled=false WHERE key='third'; IF (public.character_production_authorization('third','test-auth')->>'enabled')::boolean THEN RAISE EXCEPTION 'revocation ignored'; END IF; UPDATE character_production.approved_slots SET enabled=true WHERE key='third'; IF old_revision=public.character_production_authorization('third','test-auth')->>'revision' THEN RAISE EXCEPTION 'restore revision unchanged'; END IF; END $$;")
 check("NOT EXISTS(SELECT 1 FROM character_production.jobs WHERE state NOT IN ('pending_qa','unknown'))",'no approval or publication state')
 fixture('failed',['failed']);check(claim('failed')+' IS NOT NULL','failed fixture claim')
 run("SELECT public.character_production_submitted(key,token,digest,'failed-task') FROM character_production.jobs WHERE key='failed'; SELECT public.character_production_failed(public.character_production_pending('failed','test-model',5)->0);")
 check("(SELECT state='failed' FROM character_production.jobs WHERE key='failed')",'failed transition')
 check("(SELECT reserved_cents=40 FROM character_production.budgets WHERE provider='failed')",'no failed refund')
 check(claim('failed')+' IS NULL','failed key remains spent')
 finish('ledger')
if __name__=='__main__': suite()
