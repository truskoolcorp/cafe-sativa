#!/usr/bin/env python3
"""Disposable PG17 positive receipt contract. Synthetic attempts are fixture data,
not proof of provider publishing or an end-to-end submission. No network providers."""
import copy, hashlib, json, os
import validate_ledger as db
import validate_planner as planner
from validate_enrolled_reads_install import verbatim_run
import validate_planner_install as foundation
from validate_cafe_standing_publication import fail,SIG
q=db.quote
j=lambda v:q(json.dumps(v,separators=(',',':')))+'::jsonb'
D='99999999-9999-4999-8999-999999999999'
P=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']
T=['33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444']
# Exact existing standing-store setup; no publication-target proposal imported.
def setup():
 assert os.environ.get('PG_DISPOSABLE_TEST_CONFIRM')=='yes' and os.environ.get('PGHOST') in ['localhost','127.0.0.1','::1']
 foundation.suite() # genuine distinct-auth-owner admin + recurring QA/wallet/planner installers
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; '+(db.ROOT/'docs/proposals/character-production-scheduler-principal.sql').read_text())
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner;')
 # Replace ONLY disposable foundation's old minimal Café guard scaffolding with
 # the actual store and writer. This is not a production installer migration.
 db.run("DROP SCHEMA cafe_metricool_private CASCADE; CREATE ROLE cafe_metricool_owner NOLOGIN NOSUPERUSER NOINHERIT; GRANT CREATE ON DATABASE character_ci_provision TO cafe_metricool_owner; GRANT CREATE ON SCHEMA public TO cafe_metricool_owner; GRANT USAGE ON SCHEMA auth TO cafe_metricool_owner; GRANT REFERENCES(id) ON auth.users TO cafe_metricool_owner; GRANT EXECUTE ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) TO cafe_metricool_owner; ALTER TABLE public.cs_character_promo_delivery_plans ADD COLUMN caption text; ALTER TABLE public.cs_character_promo_qa_checks ADD COLUMN video_sha256 text,ADD COLUMN result text,ADD COLUMN reviewer_id uuid,ADD COLUMN evidence text,ADD COLUMN created_at timestamptz; GRANT UPDATE(id) ON public.cs_character_promo_drafts TO cafe_metricool_owner; GRANT SELECT,REFERENCES,TRIGGER ON public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks TO cafe_metricool_owner; CREATE POLICY standing_fixture_read_drafts ON public.cs_character_promo_drafts FOR SELECT TO cafe_metricool_owner USING(true); CREATE POLICY standing_fixture_read_plans ON public.cs_character_promo_delivery_plans FOR SELECT TO cafe_metricool_owner USING(true);")
 raw=(db.ROOT/'docs/proposals/cafe-metricool-store.sql').read_text()
 old="EXISTS(SELECT 1 FROM auth.users WHERE id=a.approved_by AND raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb)"
 assert raw.count(old)==1
 raw=raw.replace(old,'public.cs_cafe_metricool_is_admin(a.approved_by)')
 db.run('SET ROLE cafe_metricool_owner; '+raw)
 db.run('SET ROLE cafe_metricool_owner; '+(db.ROOT/'docs/proposals/cafe-metricool-authority-writer.sql').read_text())
 db.run("SET ROLE cafe_metricool_owner; DO $$ DECLARE s text; BEGIN SELECT pg_get_functiondef('cafe_metricool_private.authorized(uuid,text)'::regprocedure) INTO s; EXECUTE replace(s,'(e.video_sha256=s->>''videoSha256'' OR','(e.evidence->>''promoId''=d.id::text OR e.video_sha256=s->>''videoSha256'' OR'); END $$;")
 db.run('REVOKE USAGE ON SCHEMA auth FROM cafe_metricool_owner;')
 auth_before=foundation.auth_snapshot() # baseline after disposable store FK scaffolding
 source=(db.ROOT/'docs/proposals/cafe-standing-publication-authority.sql').read_text()
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner;')
 before=db.run("SELECT md5(prosrc) FROM pg_proc WHERE oid='cafe_metricool_private.authorized(uuid,text)'::regprocedure")
 assert before=='b851290417cceb49a25ab085e75f4765',before
 db.run(source.replace('\nCOMMIT;','\nROLLBACK;'))
 db.check("to_regclass('cafe_metricool_private.publication_scopes') IS NULL",'proposal rolls back')
 db.run(source)
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner,cafe_metricool_owner;')
 for role in ['anon','authenticated','service_role']:
  db.check('NOT has_function_privilege('+q(role)+','+q(SIG)+",'EXECUTE')",'no runtime grant in proposal')
  for table in ['publication_scopes','publication_binding','publication_authorities']:
   db.check('NOT has_table_privilege('+q(role)+','+q('cafe_metricool_private.'+table)+",'SELECT,INSERT,UPDATE,DELETE')",'no policy table access')
 db.check("NOT has_schema_privilege('cafe_metricool_owner','character_production','USAGE') AND NOT has_schema_privilege('cafe_metricool_owner','auth','USAGE')",'narrow bridge not raw access')
 # Synthetic scoped capability granted ONLY in disposable test; raw writer denied.
 db.run('GRANT EXECUTE ON FUNCTION '+SIG+' TO service_role; GRANT EXECUTE ON FUNCTION public.cs_claim_cafe_metricool(uuid,text,text,text),public.cs_preflight_cafe_metricool(uuid,text) TO service_role;')
 db.check("NOT has_function_privilege('service_role','public.cs_record_cafe_metricool_authority(uuid,jsonb,text,text,text,jsonb,uuid,timestamptz,timestamptz,jsonb)','EXECUTE')",'raw writer denied')


def main():
 setup()
 source=(db.ROOT/'docs/proposals/cafe-publication-reconciliation.sql').read_text()
 db.run('GRANT CREATE ON SCHEMA public TO cafe_metricool_owner; SET ROLE cafe_metricool_owner; '+source)
 db.check("to_regclass('cafe_metricool_private.publication_receipts') IS NULL",'proposal rolls back')
 db.run('SET ROLE cafe_metricool_owner; '+source.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run('REVOKE CREATE ON SCHEMA public FROM cafe_metricool_owner')
 sigs=['public.cs_cafe_publication_attempt(uuid)','public.cs_record_cafe_publication_receipt(uuid,uuid,text,jsonb,text)','public.cs_cafe_publication_terminal(uuid)']
 for role in ['anon','authenticated','service_role','character_production_owner']:
  for sig in sigs:db.check('NOT has_function_privilege('+q(role)+','+q(sig)+",'EXECUTE')",'no runtime or cross-owner grant')
  db.check('NOT has_table_privilege('+q(role)+",'cafe_metricool_private.publication_receipts','SELECT,INSERT,UPDATE,DELETE')",'no receipt table exposure')
 own=lambda s:db.run('SET ROLE cafe_metricool_owner; SELECT '+s)
 terminal=lambda:own('public.cs_cafe_publication_terminal('+q(D)+')')
 assert terminal()=='f'
 db.run("INSERT INTO public.cs_character_promo_drafts(id,character_id,spoken_script,status,updated_at) VALUES('"+D+"','synthetic-persona','Fixture only','script_approved',clock_timestamp())")
 schedule=db.run("SELECT to_char(clock_timestamp()-interval '1 minute','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")
 for n,(network,account) in enumerate([('facebook','105363501666032'),('instagram','cafesativainc')]):
  db.run("INSERT INTO public.cs_character_promo_delivery_plans(id,promo_id,character_id,network,account_id,scheduled_at,status,caption) VALUES("+q(P[n])+','+q(D)+",'synthetic-persona',"+q(network)+','+q(account)+','+q(schedule)+",'ready_for_delivery','Fixture')")
  snapshot=dict(brandId='7605217',network=network,accountId=account,scheduledAt=schedule)
  db.run("INSERT INTO cafe_metricool_private.approvals VALUES("+q(P[n])+','+j(snapshot)+",repeat('a',64),"+q(str(n+1)*64)+','+q(str(n+3)*64)+",'{}','"+planner.ACT+"',clock_timestamp(),clock_timestamp()+interval '1 hour',false)")
  db.run("INSERT INTO cafe_metricool_private.attempts(plan_id,digest,destination_time_key,media_destination_key,token,state,provider_id,provider_uuid,receipt) VALUES("+q(P[n])+",repeat('a',64),"+q(str(n+1)*64)+','+q(str(n+3)*64)+','+q(T[n])+",'scheduled',"+q('synthetic-post-'+str(n))+','+q('synthetic-uuid-'+str(n))+",'{}')")
 assert terminal()=='f','scheduled is not published'
 local_date=db.run('SELECT to_char('+q(schedule)+"::timestamptz AT TIME ZONE 'America/Chicago','YYYY-MM-DD\"T\"HH24:MI:SS')")
 def observation(n):
  a=json.loads(own('public.cs_cafe_publication_attempt('+q(P[n])+')'))
  url='https://www.facebook.com/reel/123456' if n==0 else 'https://www.instagram.com/reel/SyntheticReceipt/'
  dest='123456' if n==0 else url
  e=dict(status='PUBLISHED',postId=a['providerId'],postUuid=a['providerUuid'],network=a['network'],destinationId=dest,publicUrl=url,brand='[7605217,4174093,"America/Chicago","105363501666032","cafesativainc"]',creatorUserId=4174093,publicationDate=dict(dateTime=local_date,timezone='America/Chicago'))
  r=dict(a,version=1,brandId='7605217',destinationId=dest,publicUrl=url,observedAt=db.run("SELECT clock_timestamp()"))
  return r,e
 def call(n,r,e,token=None,digest='a'*64):
  text=json.dumps(e,separators=(',',':'));r=copy.deepcopy(r);r['evidenceSha256']=hashlib.sha256(text.encode()).hexdigest()
  return 'public.cs_record_cafe_publication_receipt('+','.join([q(P[n]),q(token or T[n]),q(digest),j(r),q(text)])+')'
 r,e=observation(0)
 negatives=[]
 for value in [None,'']:
  rr=copy.deepcopy(r);ee=copy.deepcopy(e);rr['publicUrl']=value;ee['publicUrl']=value;negatives.append(call(0,rr,ee))
 rr=copy.deepcopy(r);ee=copy.deepcopy(e);del rr['publicUrl'];del ee['publicUrl'];negatives.append(call(0,rr,ee))
 ee=copy.deepcopy(e);ee['postId']='wrong';negatives.append(call(0,r,ee))
 ee=copy.deepcopy(e);ee['status']='SCHEDULED';negatives.append(call(0,r,ee))
 negatives += [call(0,r,e,token=T[1]),call(0,r,e,digest='b'*64)]
 for expr in negatives:
  assert own(expr)=='f'
 db.check('NOT EXISTS(SELECT 1 FROM cafe_metricool_private.publication_receipts)','bad evidence cannot insert')
 db.run("BEGIN; UPDATE cafe_metricool_private.attempts SET state='submission_unknown',receipt=NULL WHERE plan_id="+q(P[0])+"; SET ROLE cafe_metricool_owner; DO $$ BEGIN IF "+call(0,r,e)+" THEN RAISE EXCEPTION 'unknown attempt accepted'; END IF; END $$; ROLLBACK;")
 db.run('BEGIN; SET ROLE cafe_metricool_owner; SELECT '+call(0,r,e)+'; ROLLBACK;')
 db.check('NOT EXISTS(SELECT 1 FROM cafe_metricool_private.publication_receipts)','receipt rolls back')
 assert own(call(0,r,e))=='t';assert own(call(0,r,e))=='t'
 assert terminal()=='f','one platform cannot complete pair'
 rr=copy.deepcopy(r);rr['destinationId']='999';assert own(call(0,rr,e))=='f'
 r1,e1=observation(1);assert own(call(1,r1,e1))=='t';assert terminal()=='t'
 fail("SET ROLE cafe_metricool_owner; UPDATE cafe_metricool_private.publication_receipts SET digest=repeat('f',64);",'immutable')
 db.run("BEGIN; INSERT INTO public.cs_character_promo_delivery_plans(id,promo_id,character_id,network,account_id,scheduled_at,status,caption) VALUES('55555555-5555-4555-8555-555555555555',"+q(D)+",'synthetic-persona','facebook','105363501666032',"+q(schedule)+",'ready_for_delivery','Extra unattempted'); SET ROLE cafe_metricool_owner; DO $$ BEGIN IF public.cs_cafe_publication_terminal("+q(D)+") THEN RAISE EXCEPTION 'extra unattempted plan hidden'; END IF; END $$; ROLLBACK;")
 assert own("public.cs_cafe_publication_terminal('5094636c-be48-4ac3-ae7b-80acfb729c13')")=='f','legacy external introduction cannot supply positive app receipt'
 db.finish('publication-reconciliation')
if __name__=='__main__':
 original=db.run;db.run=verbatim_run
 try:main()
 finally:db.run=original
