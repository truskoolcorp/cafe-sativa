#!/usr/bin/env python3
"""Disposable PG17 non-superuser budget installer, no live policy/evidence."""
import subprocess
import validate_ledger as db
import validate_qa_install as base
import validate_heygen_budget as budget

def suite():
 base.suite()
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner;')
 db.run('SET ROLE character_production_owner; '+(db.ROOT/'docs/proposals/character-production-receipt-evidence.sql').read_text())
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner;')
 source=(db.ROOT/'docs/proposals/character-production-heygen-budget-install.sql').read_text();assert source==subprocess.check_output(['python3','scripts/prepare-heygen-budget-install.py'],cwd=db.ROOT,text=True)
 sql=base.adapt(source);prefix='SET SESSION AUTHORIZATION provision_installer; '
 before=base.snapshot();db.run(prefix+sql.replace('\nCOMMIT;','\nROLLBACK;'));assert base.snapshot()==before
 for broken,label in [
  (sql.replace('\nCOMMIT;',"\nDO $$ BEGIN RAISE EXCEPTION 'injected abort'; END $$; COMMIT;"),'injected abort'),
  (sql.replace(" IF EXISTS(SELECT 1 FROM character_production.heygen_wallet_policy)"," UPDATE character_production.budgets SET reserved_cents=reserved_cents+1;\n IF EXISTS(SELECT 1 FROM character_production.heygen_wallet_policy)"),'Ledger data changed'),
 ]:
  p=subprocess.run(db.command(),input=prefix+broken,text=True,capture_output=True);assert p.returncode and label in p.stderr,p.stderr;assert base.snapshot()==before
 db.run('CREATE ROLE budget_unexpected NOLOGIN;')
 defaults=db.run("SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY oid),'[]'::jsonb) FROM pg_default_acl d")
 for kind,right in [('FUNCTIONS','EXECUTE'),('TABLES','SELECT')]:
  setup='ALTER DEFAULT PRIVILEGES FOR ROLE character_production_owner IN SCHEMA character_production GRANT '+right+' ON '+kind+' TO budget_unexpected; '
  p=subprocess.run(db.command(),input='BEGIN; '+setup+prefix+sql,text=True,capture_output=True)
  assert p.returncode and 'ACL mismatch' in p.stderr,p.stderr;assert base.snapshot()==before
  assert db.run("SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY oid),'[]'::jsonb) FROM pg_default_acl d")==defaults
 db.run(prefix+sql)
 db.check("NOT pg_has_role('provision_installer','character_production_owner','SET') AND NOT has_schema_privilege('character_production_owner','public','CREATE')",'no temporary privilege remains')
 db.check("(SELECT cap_cents=40 AND reserved_cents=35 FROM character_production.budgets WHERE provider='heygen' AND period='2026-11')",'original35/history and40cap untouched')
 for table in ['heygen_wallet_policy','heygen_wallet_evidence','heygen_slot_evidence']:
  db.check('(SELECT count(*)=0 FROM character_production.'+table+')','no activation rows')
  for role in ['anon','authenticated','service_role','character_production_generator','character_production_output_broker']:
   db.check('NOT has_table_privilege('+db.quote(role)+",'character_production."+table+"','SELECT,INSERT,UPDATE,DELETE')",'no evidence rights')
 # Current scope without a verified policy cannot spend even after a trusted
 # synthetic ceiling change; original production budgets are never edited here.
 period=db.run("SELECT character_production.calendar_period('heygen',clock_timestamp())")
 db.run("INSERT INTO character_production.budgets(provider,period,cap_cents,reserved_cents,enabled) VALUES('heygen',"+db.quote(period)+",2000,35,true) ON CONFLICT(provider,period) DO UPDATE SET cap_cents=2000;")
 db.run("INSERT INTO character_production.approved_slots(key,digest,slot,enabled) SELECT 'no-policy',repeat('a',64),jsonb_build_object('key','no-policy','provider','heygen','model','avatar_iv','period',"+db.quote(period)+",'periodCapCents',2000,'quoteCents',35,'durationSeconds',9,'authorizationExpiresAt',floor(extract(epoch FROM now()+interval '1 minute')*1000),'providerBindingRevision',repeat('b',64)),true;")
 db.check(budget.claim('no-policy')+' IS NULL','empty guard denies spend')
 db.check("character_production.calendar_period('heygen','2026-07-01T04:59:59Z')='2026-06'",'installed calendar Dallas')
 db.finish('heygen-budget-install')
if __name__=='__main__':suite()
