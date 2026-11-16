"""Disposable PG17 scoped QA discovery; no provider or real media."""
import json
import validate_enrolled_queues as base
import validate_ledger as db
def suite():
 base.suite()
 source=(db.ROOT/'docs/proposals/character-production-enrolled-qa.sql').read_text()
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; '+source)
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner')
 sig='public.character_production_scheduler_qa_ready(uuid,integer)'
 for role in ['anon','authenticated','service_role','character_production_generator','character_production_output_broker']:
  db.check('NOT has_function_privilege('+db.quote(role)+','+db.quote(sig)+",'EXECUTE')",'no proposal grant')
 db.run('GRANT EXECUTE ON FUNCTION '+sig+' TO service_role')
 old='44444444-4444-4444-8444-444444444444';new='66666666-6666-4666-8666-666666666667'
 candidates=json.loads(db.run("SELECT candidate_snapshot FROM character_production.scheduler_enrollments WHERE id='"+old+"'"))
 for c in candidates:c['draftId']='bbbbbbbb-bbbb-4bbb-8bbb-'+str(c['ordinal']).zfill(12)
 snapshot=db.quote(json.dumps(candidates))+'::jsonb'
 db.run("INSERT INTO character_production.scheduler_enrollments SELECT '"+new+"',policy_id,policy_revision,actor_id,policy_snapshot,"+snapshot+",manifest_sha256,owner_evidence_ref,approved_at,expires_at,true FROM character_production.scheduler_enrollments WHERE id='"+old+"'")
 for c in candidates:
  db.run("INSERT INTO character_production.scheduler_candidates VALUES('"+new+"',"+str(c['ordinal'])+","+db.quote(json.dumps(c['slot']))+"::jsonb,"+db.quote(c['digest'])+",'"+c['draftId']+"',"+db.quote(c['theme'])+","+db.quote(c['scheduledAt'])+")")
 owned_pid=next(c['draftId'] for c in candidates if c['slot']['key']=='owned-pending')
 db.run("UPDATE character_production.scheduler_binding SET enrollment_id='"+new+"',enabled=true; UPDATE character_production.approved_slots SET enabled=true WHERE key IN ('owned-due','owned-pending')")
 for i,key in enumerate(['foreign-'+str(n) for n in range(10)]+['owned-pending']):
  pid=owned_pid if key=='owned-pending' else 'aaaaaaaa-aaaa-4aaa-8aaa-'+str(i).zfill(12)
  db.run("INSERT INTO public.cs_character_promo_drafts(id,character_id,promo_key,specialty,title,spoken_script,visual_brief,duration_seconds) SELECT '"+pid+"',slot->>'characterId',"+db.quote('qa-'+key)+",'QA','Synthetic',slot->>'script','Synthetic',8 FROM character_production.approved_slots WHERE key="+db.quote(key)+"; INSERT INTO character_production.qa_slot_bindings SELECT a.key,a.digest,a.slot,d.id,d.updated_at,true FROM character_production.approved_slots a,public.cs_character_promo_drafts d WHERE a.key="+db.quote(key)+" AND d.id='"+pid+"'; UPDATE character_production.jobs SET state='pending_qa',sha=repeat('b',64),bytes=64,bucket='character-production-private',object_path=digest||'/'||repeat('b',64)||'.mp4' WHERE key="+db.quote(key))
 before=db.run("SELECT jsonb_build_array((SELECT count(*) FROM character_production.qa_targets),(SELECT count(*) FROM character_production.qa_ingestion_receipts))")
 rpc="public.character_production_scheduler_qa_ready('"+new+"',1)"
 result=json.loads(db.run('SET ROLE service_role; SELECT '+rpc))
 assert [x['key'] for x in result]==['owned-pending']
 db.run("BEGIN; INSERT INTO public.cs_character_promo_delivery_plans(promo_id,character_id,network,scheduled_at) VALUES('"+owned_pid+"','synthetic-persona','test-planned',now()); SET ROLE service_role; DO $$ BEGIN IF "+rpc+" IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'planned draft selected'; END IF; END $$; ROLLBACK")
 # A same-slot binding redirected to another draft is not the enrolled target.
 db.run("BEGIN; DELETE FROM character_production.qa_slot_bindings WHERE slot_key='foreign-0'; UPDATE character_production.qa_slot_bindings SET promo_id='aaaaaaaa-aaaa-4aaa-8aaa-000000000000',expected_updated_at=(SELECT updated_at FROM public.cs_character_promo_drafts WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-000000000000') WHERE slot_key='owned-pending'; SET ROLE service_role; DO $$ BEGIN IF "+rpc+"<>'[]'::jsonb THEN RAISE EXCEPTION 'foreign draft selected'; END IF; END $$; ROLLBACK")
 db.run("BEGIN; UPDATE character_production.qa_slot_bindings SET enabled=false WHERE slot_key='owned-pending'; SET ROLE service_role; DO $$ BEGIN IF "+rpc+"<>'[]'::jsonb THEN RAISE EXCEPTION 'disabled QA binding selected'; END IF; END $$; ROLLBACK")
 db.run("UPDATE character_production.scheduler_binding SET enabled=false")
 assert db.run('SET ROLE service_role; SELECT '+rpc)==''
 assert db.run("SELECT jsonb_build_array((SELECT count(*) FROM character_production.qa_targets),(SELECT count(*) FROM character_production.qa_ingestion_receipts))")==before,'read never materializes/ingests/approves'
 db.finish('enrolled-qa')
if __name__=='__main__':suite()
