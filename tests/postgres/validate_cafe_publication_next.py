#!/usr/bin/env python3
"""Disposable selector contract on real first-delivery setup. Any provider attempt
or receipt below is synthetic fixture data, not an end-to-end publication claim."""
import json
import validate_ledger as db
from validate_enrolled_reads_install import verbatim_run
from validate_cafe_first_delivery import main as first_delivery
from validate_cafe_standing_publication import S,q,j

def main():
 first_delivery()
 for name in ['cafe-publication-reconciliation.sql','cafe-publication-next.sql']:
  source=(db.ROOT/'docs/proposals'/name).read_text()
  db.run('GRANT CREATE ON SCHEMA public TO cafe_metricool_owner; SET ROLE cafe_metricool_owner; '+source.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run('REVOKE CREATE ON SCHEMA public FROM cafe_metricool_owner')
 for role in ['anon','authenticated','service_role','character_production_owner']:
  db.check('NOT has_function_privilege('+q(role)+",'public.cs_cafe_publication_next()','EXECUTE')",'selector has no runtime or cross-owner grant')
 read=lambda:db.run('SET ROLE cafe_metricool_owner; SELECT public.cs_cafe_publication_next()')
 plans=json.loads(db.run("SELECT jsonb_agg(to_jsonb(p) ORDER BY network) FROM public.cs_character_promo_delivery_plans p JOIN cafe_metricool_private.initial_editorial e ON e.promo_id=p.promo_id"))
 draft=plans[0]['promo_id'];ids=[p['id'] for p in plans]
 expected={'phase':'authority','draftId':draft}
 assert json.loads(read())==expected
 # Current nine-check QA and scope, not a status label, determine authority work.
 for mutation in ["UPDATE cafe_metricool_private.publication_binding SET enabled=false", "UPDATE public.cs_character_promo_drafts SET publication_approved_at=NULL WHERE id="+q(draft), "DELETE FROM public.cs_character_promo_qa_checks WHERE check_name='third_party_watermark'"]:
  db.run("BEGIN; "+mutation+"; SET ROLE cafe_metricool_owner; DO $$ BEGIN IF public.cs_cafe_publication_next() IS NOT NULL THEN RAISE EXCEPTION 'revoked/unreviewed selector'; END IF; END $$; ROLLBACK;")
 # Synthetic approvals, no trusted semantic review or provider invocation claimed.
 for n,p in enumerate(plans):
  snapshot=dict(brandId='7605217',network=p['network'],accountId=p['account_id'],scheduledAt=p['scheduled_at'])
  db.run("INSERT INTO cafe_metricool_private.approvals VALUES("+q(p['id'])+','+j(snapshot)+",repeat('a',64),"+q(str(n+1)*64)+','+q(str(n+3)*64)+",'{}',(SELECT actor_id FROM cafe_metricool_private.publication_scopes WHERE id='"+S+"'),clock_timestamp(),clock_timestamp()+interval '5 minutes',false); INSERT INTO cafe_metricool_private.publication_authorities VALUES("+q(p['id'])+",'"+S+"',repeat('a',64))")
 chosen=json.loads(read());assert chosen=={'phase':'dispatch','planId':ids[0]}
 assert json.loads(read())==chosen,'read-only next never consumes a lease'
 # Prepare past schedules before attempts; real claimed-source freeze stays intact.
 past=db.run("SELECT to_char(clock_timestamp()-interval '1 minute','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")
 db.run('UPDATE public.cs_character_promo_delivery_plans SET scheduled_at='+q(past)+' WHERE promo_id='+q(draft))
 # Only test attempts via explicit synthetic fixture insertion, not simulated HTTP.
 token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 db.run("INSERT INTO cafe_metricool_private.attempts(plan_id,digest,destination_time_key,media_destination_key,token,state) VALUES("+q(ids[0])+",repeat('a',64),repeat('1',64),repeat('3',64),'"+token+"','submission_unknown')")
 assert json.loads(read())=={'phase':'held','reason':'original_submission_unknown'}
 db.run("UPDATE cafe_metricool_private.attempts SET state='scheduled',provider_id='fixture-provider',provider_uuid='fixture-uuid',receipt='{}' WHERE plan_id="+q(ids[0]))
 assert json.loads(read())=={'phase':'reconcile','planId':ids[0]}
 db.run("BEGIN; UPDATE cafe_metricool_private.publication_binding SET enabled=false; SET ROLE cafe_metricool_owner; DO $$ BEGIN IF public.cs_cafe_publication_next()->>'phase' IS DISTINCT FROM 'reconcile' THEN RAISE EXCEPTION 'original receipt read incorrectly revoked'; END IF; END $$; ROLLBACK;")
 # Malformed original context is not promoted to a positive candidate.
 db.run("BEGIN; UPDATE cafe_metricool_private.attempts SET provider_id=NULL,provider_uuid=NULL WHERE plan_id="+q(ids[0])+"; SET ROLE cafe_metricool_owner; DO $$ BEGIN IF public.cs_cafe_publication_next()->>'phase'='reconcile' THEN RAISE EXCEPTION 'missing original provider ID selected'; END IF; END $$; ROLLBACK;")
 # No mutation: selector must preserve the original attempt and receipt absence.
 db.check("(SELECT state='scheduled' AND token='"+token+"' FROM cafe_metricool_private.attempts WHERE plan_id="+q(ids[0])+") AND NOT EXISTS(SELECT 1 FROM cafe_metricool_private.publication_receipts)",'selector neither retries nor fabricates receipt')
 db.finish('cafe-publication-next')
if __name__=='__main__':
 original=db.run;db.run=verbatim_run
 try:main()
 finally:db.run=original
