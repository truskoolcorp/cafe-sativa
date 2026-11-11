#!/usr/bin/env python3
"""Exact captured guard, synthetic dependencies. Run after ledger and QA suites."""
from validate_ledger import ROOT,run,check,quote,finish
from validate_qa_bridge import qa_fixture,promo,commit

def suite():
 run('''SET ROLE ledger_owner;
 CREATE SCHEMA cs_promo_private;
 CREATE TABLE public.cs_character_promo_delivery_plans(id uuid PRIMARY KEY,promo_id uuid,status text);
 CREATE TABLE cs_promo_private.gates(plan_id uuid,generation_id uuid,gate text,confirmed_at timestamptz,draft_applied boolean DEFAULT false,plan_applied boolean DEFAULT false,invalidated boolean DEFAULT false);
 CREATE TABLE cs_promo_private.attempts(plan_id uuid);
 CREATE TABLE cs_promo_private.approvals(plan_id uuid,invalidated boolean DEFAULT false);
 CREATE TABLE cs_promo_private.review_heads(generation_id uuid);
 CREATE TABLE cs_promo_private.review_versions(plan_id uuid,invalidated boolean DEFAULT false);
 '''+(ROOT/'tests/fixtures/character-production-draft-guard.sql').read_text()+''';
 CREATE TRIGGER cs_promo_draft_guard BEFORE DELETE OR UPDATE ON public.cs_character_promo_drafts FOR EACH ROW EXECUTE FUNCTION cs_promo_private.guard_source(); RESET ROLE;''')
 for n,key in [(3,'guard-success'),(4,'guard-frozen')]:
  qa_fixture(key,n)
  run('INSERT INTO public.cs_character_promo_delivery_plans VALUES('+quote(promo(n))+','+quote(promo(n))+",'draft'); INSERT INTO cs_promo_private.approvals(plan_id) VALUES("+quote(promo(n))+'); INSERT INTO cs_promo_private.review_versions(plan_id) VALUES('+quote(promo(n))+'); INSERT INTO cs_promo_private.gates(plan_id,generation_id,gate,confirmed_at) VALUES('+quote(promo(n))+','+quote(promo(n))+",'video',clock_timestamp());")
 run('INSERT INTO cs_promo_private.attempts VALUES('+quote(promo(4))+');')
 run("BEGIN ISOLATION LEVEL REPEATABLE READ; DO $$ BEGIN BEGIN UPDATE public.cs_character_promo_drafts SET video_asset_path='must-not-commit' WHERE id="+quote(promo(3))+"; RAISE EXCEPTION 'wrong isolation allowed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM!='Promo mutations require READ COMMITTED' THEN RAISE; END IF; END; END $$; COMMIT;")
 run("DO $$ DECLARE m jsonb:=public.character_production_qa_prepare('guard-success',repeat('a',64)); BEGIN IF NOT "+commit(key="'guard-success'")+" THEN RAISE EXCEPTION 'guard commit failed'; END IF; END $$;")
 for table in ['approvals','review_versions','gates']:
  check('NOT EXISTS(SELECT 1 FROM cs_promo_private.'+table+' WHERE plan_id='+quote(promo(3))+' AND NOT invalidated)','invalidation '+table)
 check('NOT EXISTS(SELECT 1 FROM cs_promo_private.gates WHERE plan_id='+quote(promo(3))+' AND (draft_applied OR plan_applied))','no gates applied')
 check('NOT EXISTS(SELECT 1 FROM public.cs_character_promo_drafts WHERE id='+quote(promo(3))+" AND (status!='draft' OR voice_approved_at IS NOT NULL OR video_qa_approved_at IS NOT NULL OR publication_approved_at IS NOT NULL))",'no approval granted')
 run("DO $$ DECLARE m jsonb:=public.character_production_qa_prepare('guard-frozen',repeat('a',64)); BEGIN IF m IS NULL THEN RAISE EXCEPTION 'fixture manifest absent'; END IF; BEGIN PERFORM "+commit(key="'guard-frozen'")+"; RAISE EXCEPTION 'frozen commit accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM!='Claimed promo is frozen; manual reconciliation required' THEN RAISE; END IF; END; IF EXISTS(SELECT 1 FROM character_production.qa_ingestion_receipts WHERE job_key='guard-frozen') OR EXISTS(SELECT 1 FROM public.cs_character_promo_drafts WHERE id="+quote(promo(4))+" AND (video_asset_path IS NOT NULL OR updated_at IS DISTINCT FROM (m->>'expectedUpdatedAt')::timestamptz)) THEN RAISE EXCEPTION 'frozen commit not atomic'; END IF; END $$;")
 for table in ['approvals','review_versions','gates']:
  check('NOT EXISTS(SELECT 1 FROM cs_promo_private.'+table+' WHERE plan_id='+quote(promo(4))+' AND invalidated)','no frozen changes '+table)
 finish('qa-trigger')
if __name__=='__main__': suite()
