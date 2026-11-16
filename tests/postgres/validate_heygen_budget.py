#!/usr/bin/env python3
"""Disposable PG17 atomic Dallas budget guard contract, never live installation."""
import json,subprocess,concurrent.futures,time
import validate_ledger as db
import validate_qa_install as base
D='a'*64

def create(k,cost=35,duration=9,expiry=60000):
 db.run("INSERT INTO character_production.approved_slots(key,slot,digest,enabled) SELECT "+db.quote(k)+",jsonb_build_object('key',"+db.quote(k)+",'provider','heygen','model','avatar_iv','characterId','synthetic','script','Synthetic','period',character_production.calendar_period('heygen',clock_timestamp()),'periodCapCents',2000,'quoteCents',"+str(cost)+",'durationSeconds',"+str(duration)+",'authorizationId','synthetic','authorizationExpiresAt',floor(extract(epoch FROM clock_timestamp())*1000)+"+str(expiry)+",'providerBindingRevision',repeat('b',64)),repeat('a',64),true; INSERT INTO character_production.heygen_slot_evidence VALUES("+db.quote(k)+",repeat('a',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);")
def claim(k):return "(SELECT public.character_production_claim(slot,digest) FROM character_production.approved_slots WHERE key="+db.quote(k)+')'
def suite():
 base.suite()
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner;')
 db.run('SET ROLE character_production_owner; '+(db.ROOT/'docs/proposals/character-production-receipt-evidence.sql').read_text())
 sql=(db.ROOT/'docs/proposals/character-production-heygen-budget.sql').read_text();assert sql==subprocess.check_output(['python3','scripts/prepare-heygen-budget.py'],cwd=db.ROOT,text=True)
 before=base.snapshot();db.run('SET ROLE character_production_owner; '+sql.replace('COMMIT;','ROLLBACK;'));assert base.snapshot()==before
 db.run('SET ROLE character_production_owner; '+sql);db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner;')
 for at,expected in [('2026-01-01T05:59:59Z','2025-12'),('2026-01-01T06:00:00Z','2026-01'),('2026-07-01T04:59:59Z','2026-06'),('2026-07-01T05:00:00Z','2026-07'),('2026-03-08T08:00:00Z','2026-03'),('2026-11-01T07:00:00Z','2026-11')]:
  db.check('character_production.calendar_period(\'heygen\','+db.quote(at)+')='+db.quote(expected),'Dallas DST/month')
 db.check("character_production.calendar_period('other','2026-01-01T05:00Z')='2026-01'",'other provider UTC unchanged')
 # Exact synthetic original35 preserved while only its budget ceiling increases.
 original=db.run("SELECT to_jsonb(j) FROM character_production.jobs j WHERE key="+db.quote(base.KEY))
 period=db.run("SELECT character_production.calendar_period('heygen',clock_timestamp())")
 if period=='2026-11':db.run("UPDATE character_production.budgets SET cap_cents=2000 WHERE provider='heygen' AND period='2026-11';")
 else:db.run("INSERT INTO character_production.budgets VALUES('heygen',"+db.quote(period)+",2000,35,true,1);")
 db.run("INSERT INTO character_production.heygen_wallet_policy VALUES(true,'d61468fdf18c4b478f27857337ddd1ea',2000,true,now()+interval '1 hour'); INSERT INTO character_production.heygen_wallet_evidence VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d61468fdf18c4b478f27857337ddd1ea','USD','api_wallet',2442,false,true,'avatar_iv','photo',now(),now()+interval '24 hours',231,now(),now()+interval '60 seconds',repeat('e',64));")
 create('underquote',34);db.check(claim('underquote')+' IS NULL','ceil9seconds35c')
 create('stale',35)
 for mutation in ["UPDATE character_production.heygen_wallet_policy SET enabled=false", "UPDATE character_production.heygen_slot_evidence SET enabled=false WHERE slot_key='stale'", "UPDATE character_production.heygen_wallet_policy SET expires_at=now()-interval '1 second'", "UPDATE character_production.budgets SET cap_cents=2001 WHERE provider='heygen' AND period="+db.quote(period)]:
  db.run('BEGIN; '+mutation+'; DO $$ BEGIN IF '+claim('stale')+" IS NOT NULL THEN RAISE EXCEPTION 'invalid authorization spent'; END IF; END $$; ROLLBACK;")
 # Stale/future wallet, rate and insufficient balance are distinct fail-closed cases.
 for patch in ["jsonb_build_object('wallet_cents',0)","jsonb_build_object('wallet_cents',35)","jsonb_build_object('captured_at',now()-interval '61 seconds','expires_at',now()-interval '1 second')","jsonb_build_object('captured_at',now()+interval '1 second','expires_at',now()+interval '60 seconds')","jsonb_build_object('rate_captured_at',now()-interval '25 hours','rate_expires_at',now()-interval '1 hour')","jsonb_build_object('rate_cents_per_minute',1000)"]:
  db.run("BEGIN; INSERT INTO character_production.heygen_wallet_evidence SELECT (jsonb_populate_record(NULL::character_production.heygen_wallet_evidence,to_jsonb(e)||jsonb_build_object('id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')||"+patch+")).* FROM character_production.heygen_wallet_evidence e; UPDATE character_production.heygen_slot_evidence SET evidence_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' WHERE slot_key='stale'; DO $$ BEGIN IF "+claim('stale')+" IS NOT NULL THEN RAISE EXCEPTION 'bad wallet/rate evidence spent'; END IF; END $$; ROLLBACK;")
 # Prewrite needs fresh authority; retaining actual receipt after revocation remains permitted.
 db.run('BEGIN; SELECT '+claim('stale')+"; DO $$ DECLARE j character_production.jobs; BEGIN SELECT * INTO j FROM character_production.jobs WHERE key='stale'; IF NOT public.character_production_observe_receipt(j.key,j.token,j.digest,NULL) THEN RAISE EXCEPTION 'fresh prewrite denied'; END IF; UPDATE character_production.heygen_slot_evidence SET enabled=false WHERE slot_key=j.key; IF public.character_production_observe_receipt(j.key,j.token,j.digest,NULL) THEN RAISE EXCEPTION 'revoked prewrite allowed'; END IF; IF NOT public.character_production_observe_receipt(j.key,j.token,j.digest,'actual-original-task') THEN RAISE EXCEPTION 'late evidence lost'; END IF; END $$; ROLLBACK;")
 # 35 prior + two concurrent1000 requests => exactly one accepted (1035 total).
 create('race-one',1000);create('race-two',1000)
 def run(k):return db.run('SELECT '+claim(k)+';')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:r=list(pool.map(run,['race-one','race-two']))
 assert sum(bool(x) for x in r)==1,r
 winner='race-one' if r[0] else 'race-two'
 db.check(claim(winner)+' IS NULL','no duplicate reservation')
 db.run("UPDATE character_production.jobs SET state='unknown' WHERE key="+db.quote(winner))
 db.check(claim(winner)+' IS NULL','unknown cannot reclaim')
 db.check("(SELECT reserved_cents=1035 FROM character_production.budgets WHERE provider='heygen' AND period="+db.quote(period)+')','original35 counted')
 # Exhaust remaining headroom to exact2000; finalcent denied, no refund.
 create('remaining',965);db.check(claim('remaining')+' IS NOT NULL','exact cap');create('over',4,1);db.check(claim('over')+' IS NULL','hard2000')
 db.check("(SELECT reserved_cents=2000 FROM character_production.budgets WHERE provider='heygen' AND period="+db.quote(period)+')','atomic hard ceiling')
 assert db.run("SELECT to_jsonb(j) FROM character_production.jobs j WHERE key="+db.quote(base.KEY))==original
 # Evidence rows cannot mutate to rewrite wallet history; no runtime writes.
 p=subprocess.run(db.command(),input="UPDATE character_production.heygen_wallet_evidence SET wallet_cents=999999;",text=True,capture_output=True);assert p.returncode and 'immutable' in p.stderr
 for role in ['anon','authenticated','service_role','character_production_generator','character_production_output_broker']:
  for table in ['heygen_wallet_policy','heygen_wallet_evidence','heygen_slot_evidence']:
   db.check('NOT has_table_privilege('+db.quote(role)+",'character_production."+table+"','SELECT,INSERT,UPDATE,DELETE')",'no evidence writer grant')
 db.finish('heygen-budget')
if __name__=='__main__':suite()
