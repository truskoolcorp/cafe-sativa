#!/usr/bin/env python3
"""Disposable PostgreSQL17 contract fixture, not production migrations or approval data."""
import concurrent.futures, hashlib, json, os, pathlib, subprocess, threading, uuid, time
ROOT=pathlib.Path(__file__).resolve().parents[2]
LOG=[]
def q(v): return "'"+str(v).replace("'","''")+"'"
def run(sql):
 p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'], input=sql,text=True,capture_output=True,timeout=40)
 LOG.append(p.stdout+p.stderr)
 if p.returncode: raise AssertionError(p.stderr)
 return p.stdout.strip()
def check(expr,label): run('DO $$ BEGIN IF ('+expr+') IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '+q(label)+'; END IF; END $$;')
def h(s): return hashlib.sha256(s.encode()).hexdigest()
def uid(s): return str(uuid.uuid5(uuid.NAMESPACE_DNS,'synthetic.metricool.'+s))
ADMIN=uid('admin')
def owner(sql): return run('SET ROLE metricool_owner; '+sql)
def fixture(name,dest=None,media=None,video_sha=None):
 p,d=uid('plan-'+name),uid('draft-'+name); sha=video_sha or h('video-'+name); digest=h('digest-'+name)
 path=f'character-promos/zaria/{d}/{sha}.mp4'
 snapshot={'version':1,'planId':p,'promoId':d,'characterId':'zaria','brandId':'7605217','userId':'4174093','network':'instagram','accountId':'cafesativainc','timezone':'America/Chicago','scheduledAt':'2099-01-01T18:00:00.000Z','videoSha256':sha,'videoPath':path,'contentApprovalDigest':h('content'),'caption':'Synthetic only','hashtags':[],'collaborators':[{'network':'instagram','handle':'dotproject2017','characterId':'zaria','evidenceRef':'synthetic'}]}
 owner(f"INSERT INTO public.cs_character_promo_drafts VALUES({q(d)},'zaria','metricool-brand:7605217','script_approved',{q(path)},now()-interval '2 minutes',now()-interval '2 minutes',now()-interval '2 minutes'); INSERT INTO public.cs_character_promo_delivery_plans VALUES({q(p)},{q(d)},'zaria','instagram','cafesativainc','ready_for_delivery','Synthetic only','2099-01-01T18:00:00Z'); INSERT INTO public.cs_character_promo_qa_checks(promo_id,video_sha256,check_name,result,reviewer_id,evidence,created_at) SELECT {q(d)},{q(sha)},n,'pass',{q(ADMIN)},'Synthetic reviewed evidence',now()-interval '1 minute' FROM unnest(ARRAY['mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety','third_party_watermark']) n; INSERT INTO cafe_metricool_private.approvals VALUES({q(p)},{q(json.dumps(snapshot))}::jsonb,{q(digest)},{q(dest or h('dest-'+name))},{q(media or h('media-'+name))},cafe_metricool_private.source_state({q(p)}),{q(ADMIN)},now(),now()+interval '1 hour',false);")
 return p,d,digest,snapshot,dest or h('dest-'+name),media or h('media-'+name)
def call(f): return f"public.cs_claim_cafe_metricool({q(f[0])},{q(f[2])},{q(f[4])},{q(f[5])})"
def refresh(f): return f"UPDATE cafe_metricool_private.approvals SET source_state=cafe_metricool_private.source_state({q(f[0])}) WHERE plan_id={q(f[0])};"
def deny_mutation(f,sql,label,refresh_source=False):
 owner('BEGIN; '+sql+(refresh(f) if refresh_source else '')+f" DO $$ BEGIN IF public.cs_preflight_cafe_metricool({q(f[0])},{q(f[2])}) OR {call(f)} IS NOT NULL THEN RAISE EXCEPTION {q(label)}; END IF; END $$; ROLLBACK;")
def denied_write(sql):
 p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input='SET ROLE metricool_owner; '+sql,text=True,capture_output=True,timeout=40)
 LOG.append(p.stdout+p.stderr)
 assert p.returncode and 'claimed source frozen' in p.stderr,p.stdout+p.stderr

def race_source(f,claim_first):
 name='metricool_fixture_'+('claim' if claim_first else 'mutation')
 mutate=f"UPDATE public.cs_character_promo_drafts SET status='changed' WHERE id={q(f[1])};"
 first=('SELECT '+call(f)+';') if claim_first else mutate
 with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
  future=pool.submit(owner,f"SET application_name={q(name)}; BEGIN; "+first+" SELECT pg_sleep(1.5); COMMIT;")
  for _ in range(100):
   if run(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name={q(name)} AND wait_event='PgSleep')")=='t':break
   time.sleep(.03)
  else:raise AssertionError('concurrency barrier not reached')
  if claim_first: denied_write(mutate)
  else: assert owner('SELECT '+call(f)+';')=='','mutation must invalidate waiting claim'
  future.result()

def concurrent_claims(fs):
 barrier=threading.Barrier(len(fs))
 def one(f):
  barrier.wait();return owner('BEGIN; SELECT '+call(f)+"; SELECT pg_sleep(0.3); COMMIT;").strip()
 with concurrent.futures.ThreadPoolExecutor(max_workers=len(fs)) as pool: values=list(pool.map(one,fs))
 assert sum(bool(v) for v in values)==1,values
 check('(SELECT count(*) FROM cafe_metricool_private.attempts WHERE plan_id IN ('+','.join(q(f[0]) for f in fs)+'))=1','atomic reservations, no partial losers')
def suite():
 assert os.environ.get('PG_DISPOSABLE_TEST_CONFIRM')=='yes'
 assert os.environ.get('PGHOST') in ['127.0.0.1','localhost','::1']
 assert os.environ.get('PGDATABASE')=='character_ci_metricool'
 check("current_setting('server_version_num')::int BETWEEN 170000 AND 179999",'PG17 only')
 check("to_regnamespace('cafe_metricool_private') IS NULL AND to_regnamespace('auth') IS NULL",'fresh fixture only')
 run("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE metricool_owner NOLOGIN NOSUPERUSER; GRANT CREATE ON DATABASE character_ci_metricool TO metricool_owner; GRANT CREATE ON SCHEMA public TO metricool_owner;")
 owner("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb); CREATE TABLE public.cs_character_promo_drafts(id uuid PRIMARY KEY,character_id text,actual_social_account text,status text,video_asset_path text,voice_approved_at timestamptz,video_qa_approved_at timestamptz,publication_approved_at timestamptz); CREATE TABLE public.cs_character_promo_delivery_plans(id uuid PRIMARY KEY,promo_id uuid REFERENCES public.cs_character_promo_drafts,character_id text,network text,account_id text,status text,caption text,scheduled_at timestamptz); CREATE TABLE public.cs_character_promo_qa_checks(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,promo_id uuid,video_sha256 text,check_name text,result text,reviewer_id uuid,evidence text,created_at timestamptz);")
 owner(f"INSERT INTO auth.users VALUES({q(ADMIN)},'{{\"cafe_sativa_admin\":true}}');")
 sql=(ROOT/'docs/proposals/cafe-metricool-store.sql').read_text()
 owner(sql.replace('COMMIT;','ROLLBACK;'))
 check("to_regnamespace('cafe_metricool_private') IS NULL",'DDL rollback')
 owner(sql)
 for role in ['anon','authenticated','service_role']:
  check(f"NOT has_schema_privilege({q(role)},'cafe_metricool_private','USAGE')",'private schema inaccessible')
  check(f"NOT EXISTS(SELECT 1 FROM pg_proc WHERE (pronamespace='cafe_metricool_private'::regnamespace OR proname LIKE '%cafe_metricool') AND has_function_privilege({q(role)},oid,'EXECUTE'))",'no RPC grants')
  check(f"NOT EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='cafe_metricool_private'::regnamespace AND relkind='r' AND has_table_privilege({q(role)},oid,'SELECT,INSERT,UPDATE,DELETE'))",'no private table grants')
 check("(SELECT count(*)=22 FROM cafe_metricool_private.external_receipts)",'observed negative receipts seeded')
 known=fixture('known',video_sha='5907971bbcfa87654aeb6c0be53acf3e1546f2f8e64e95be3fb97e0f54afe43f')
 check(f"NOT public.cs_preflight_cafe_metricool({q(known[0])},{q(known[2])}) AND {call(known)} IS NULL",'known exact external media suppressed')
 cross=fixture('cross-brand')
 owner(f"INSERT INTO cafe_metricool_private.external_receipts VALUES('synthetic-other','5373515','instagram','cafesativainc',{q(cross[3]['videoSha256'])},'2099-01-01T18:00:00Z','{{}}');")
 check(f"public.cs_preflight_cafe_metricool({q(cross[0])},{q(cross[2])})",'different brand never suppresses')
 deny_mutation(cross,"UPDATE cafe_metricool_private.external_receipts SET brand_id='7605217' WHERE provider_id='synthetic-other';",'same brand external blocked')
 f=fixture('negative')
 check(f"public.cs_preflight_cafe_metricool({q(f[0])},{q(f[2])})",'valid authority')
 deny_mutation(f,f"UPDATE cafe_metricool_private.approvals SET revoked=true WHERE plan_id={q(f[0])};",'revocation')
 deny_mutation(f,f"UPDATE auth.users SET raw_app_meta_data='{{}}' WHERE id={q(ADMIN)};",'admin revoked')
 deny_mutation(f,f"UPDATE cafe_metricool_private.approvals SET expires_at=now()-interval '1 second' WHERE plan_id={q(f[0])};",'expired')
 deny_mutation(f,f"UPDATE public.cs_character_promo_delivery_plans SET caption='changed' WHERE id={q(f[0])};",'source mismatch')
 for mutate,label in [("DELETE FROM public.cs_character_promo_qa_checks WHERE check_name='third_party_watermark'",'missing watermark'),("UPDATE public.cs_character_promo_qa_checks SET result='fail' WHERE check_name='rights'",'failed QA'),("UPDATE public.cs_character_promo_qa_checks SET evidence='' WHERE check_name='lip_sync'",'empty evidence'),("UPDATE public.cs_character_promo_qa_checks SET reviewer_id=NULL WHERE check_name='canonical_likeness'",'unattributed QA')]:
  deny_mutation(f,mutate+' AND promo_id='+q(f[1])+';',label,True)
 deny_mutation(f,f"UPDATE cafe_metricool_private.approvals SET snapshot=snapshot-'characterId' WHERE plan_id={q(f[0])};",'missing character binding')
 deny_mutation(f,f"UPDATE public.cs_character_promo_drafts SET publication_approved_at=NULL WHERE id={q(f[1])};",'publication unapproved',True)
 deny_mutation(f,f"INSERT INTO public.cs_character_promo_qa_checks(promo_id,video_sha256,check_name,result,reviewer_id,evidence,created_at) SELECT promo_id,video_sha256,check_name,result,reviewer_id,evidence,created_at FROM public.cs_character_promo_qa_checks WHERE promo_id={q(f[1])} AND check_name='rights';",'duplicate QA',True)
 owner(f"BEGIN ISOLATION LEVEL SERIALIZABLE; DO $$ BEGIN IF {call(f)} IS NOT NULL THEN RAISE EXCEPTION 'unsupported isolation'; END IF; END $$; ROLLBACK;")
 owner(f"BEGIN; SELECT {call(f)}; ROLLBACK;")
 check(f"NOT EXISTS(SELECT 1 FROM cafe_metricool_private.attempts WHERE plan_id={q(f[0])})",'claim rollback has no reservations')
 check(f"{call(f).replace(q(f[2]),q(h('wrong')))} IS NULL",'wrong digest')
 check(f"{call(f).replace(q(f[4]),q(h('wrong')))} IS NULL",'wrong reservation')
 concurrent_claims([fixture('time'+str(i),dest=h('shared-time')) for i in range(3)])
 concurrent_claims([fixture('media'+str(i),media=h('shared-media')) for i in range(3)])
 same=fixture('same');concurrent_claims([same,same,same])
 for sql in [f"UPDATE public.cs_character_promo_drafts SET status='changed' WHERE id={q(same[1])};",f"UPDATE public.cs_character_promo_delivery_plans SET caption='changed' WHERE id={q(same[0])};",f"DELETE FROM public.cs_character_promo_qa_checks WHERE promo_id={q(same[1])};"]: denied_write(sql)
 race_source(fixture('claim-first'),True)
 race_source(fixture('mutation-first'),False)
 for state in ['unknown','scheduled']:
  z=fixture(state); token=owner('SELECT '+call(z)+';'); assert token
  identity=f"public.cs_identity_cafe_metricool({q(z[0])},{q(token)},'provider-1','uuid-1')"
  check(identity,'identity persists');check(identity,'identity idempotent')
  check('NOT '+identity.replace("'provider-1'","'different'"),'identity immutable')
  receipt={'providerId':'provider-1','providerUuid':'uuid-1','digest':z[2],'brandId':'7605217','network':'instagram','accountId':'cafesativainc','scheduledAt':z[3]['scheduledAt'],'state':'scheduled','publicationConfirmed':False,'collaborators':[{'handle':'dotproject2017','state':'invitation_requested','acceptanceConfirmed':False}]}
  finish=f"public.cs_finish_cafe_metricool({q(z[0])},{q(token)},'scheduled',{q(json.dumps(receipt))}::jsonb)"
  unknown=f"public.cs_finish_cafe_metricool({q(z[0])},{q(token)},'submission_unknown',NULL)"
  check('NOT '+finish.replace(q(token),q(uid('wrong-token'))),'wrong token')
  check('NOT '+finish.replace('"publicationConfirmed": false','"publicationConfirmed": true'),'publication claim forbidden')
  if state=='unknown':
   check(unknown,'unknown persisted');check(unknown,'unknown idempotent');check('NOT '+finish,'unknown cannot upgrade');check(call(z)+' IS NULL','unknown cannot reclaim')
  else:
   check(finish,'scheduled saved');check(finish,'scheduled idempotent');check('NOT '+unknown,'scheduled cannot downgrade')
   check('NOT '+finish.replace('"acceptanceConfirmed": false','"acceptanceConfirmed": true'),'acceptance claim forbidden')
  check(f"(SELECT provider_id='provider-1' AND provider_uuid='uuid-1' FROM cafe_metricool_private.attempts WHERE plan_id={q(z[0])})",'identity preserved')
 LOG.append('PASS: Metricool PG17 synthetic authority, atomic concurrency and receipt tests')
 print(LOG[-1])
if __name__=='__main__':
 try: suite()
 finally:
  (ROOT/'evidence').mkdir(exist_ok=True);(ROOT/'evidence/postgres-cafe-metricool-validation.log').write_text('\n'.join(LOG))
