"""Additional disposable PG17 discovery/revoke/claim contract. No live installer."""
import copy, datetime, hashlib, json, subprocess, time
import validate_enrolled_queues as base
import validate_ledger as db
import validate_planner as planner

def suite():
 base.suite()
 old='44444444-4444-4444-8444-444444444444';enrolled='66666666-6666-4666-8666-666666666666'
 row=json.loads(db.run("SELECT jsonb_build_object('slot',slot,'digest',digest,'scheduled',scheduled_at) FROM character_production.scheduler_candidates WHERE enrollment_id='"+old+"' AND ordinal=0"))
 slot=row['slot'];slot['key']='revocation-claim';slot['provider']='synthetic-revocation'
 slot['period']=db.run("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM')")
 # Synthetic non-HeyGen exercises actual claim locking independent of wallet
 # entitlement; this test does not claim proof of HeyGen wallet accounting.
 digest=hashlib.sha256(json.dumps([slot[k] for k in ['key','characterId','script','canonicalRevision','voiceId','portraitSha256','provider','model','durationSeconds','authorizationId','authorizationExpiresAt','period','quoteCents','periodCapCents','providerBindingRevision']],separators=(',',':')).encode()).hexdigest()
 when=datetime.datetime.fromisoformat(row['scheduled']).isoformat(timespec='milliseconds').replace('+00:00','Z')
 candidate=dict(ordinal=0,slot=slot,digest=digest,draftId='77777777-7777-4777-8777-777777777779',theme='synthetic-theme',scheduledAt=when)
 q=lambda x:db.quote(json.dumps(x))+'::jsonb'
 db.run("INSERT INTO character_production.scheduler_enrollments SELECT '"+enrolled+"',policy_id,policy_revision,actor_id,policy_snapshot,"+q([candidate])+",repeat('e',64),'synthetic:revocation-interleave',approved_at,expires_at,true FROM character_production.scheduler_enrollments WHERE id='"+old+"'")
 db.run("INSERT INTO character_production.scheduler_candidates VALUES('"+enrolled+"',0,"+q(slot)+","+db.quote(digest)+",'"+candidate['draftId']+"','synthetic-theme',"+db.quote(when)+"); UPDATE character_production.scheduler_binding SET enrollment_id='"+enrolled+"',enabled=true")
 db.run("INSERT INTO character_production.budgets(provider,period,cap_cents,reserved_cents,enabled) VALUES('synthetic-revocation',"+db.quote(slot['period'])+",2000,0,true); INSERT INTO character_production.approved_slots(key,slot,digest,enabled) VALUES('revocation-claim',"+q(slot)+","+db.quote(digest)+",true); INSERT INTO character_production.schedules VALUES('revocation-claim',"+db.quote(digest)+","+db.quote(when)+",to_timestamp("+str(slot['authorizationExpiresAt'])+"/1000.0),true)")
 due="public.character_production_scheduler_due('"+enrolled+"','synthetic-revocation','avatar_iv',1)"
 claim="public.character_production_claim("+q(slot)+","+db.quote(digest)+")"
 assert json.loads(db.run("SET ROLE service_role; SELECT "+due))['rows'][0]['slot']['key']=='revocation-claim'
 db.run("BEGIN; DO $$ BEGIN IF "+claim+" IS NULL THEN RAISE EXCEPTION 'positive claim control failed'; END IF; END $$; ROLLBACK")
 # Admin removal is not operational slot revocation: scoped discovery denies,
 # but a previously cached authorized slot still passes raw claim until explicit
 # enrollment/slot revocation. Demonstrate only in rolled-back transaction.
 db.run("BEGIN; UPDATE auth.users SET raw_app_meta_data='{}' WHERE id='"+planner.ACT+"'; DO $$ BEGIN IF "+due+" IS NOT NULL THEN RAISE EXCEPTION 'admin removal discovery accepted'; END IF; IF "+claim+" IS NULL THEN RAISE EXCEPTION 'expected documented raw-claim separation'; END IF; END $$; ROLLBACK")
 leader=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 waiter=None
 try:
  leader.stdin.write("SET application_name='queue_revoker'; BEGIN; UPDATE character_production.scheduler_binding SET enabled=false; SELECT 1;\n");leader.stdin.flush()
  # Deterministic barrier: revoker is idle in its uncommitted transaction after
  # trigger has disabled approved slot. Then prove claim waits for row lock.
  for _ in range(150):
   if db.run("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='queue_revoker' AND state='idle in transaction')")=='t':break
   time.sleep(.02)
  else:raise AssertionError('revoker barrier missing')
  waiter=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  waiter.stdin.write("SET application_name='queue_claim_waiter'; DO $$ BEGIN IF "+claim+" IS NOT NULL THEN RAISE EXCEPTION 'claim crossed committed revoke'; END IF; END $$;\n");waiter.stdin.close()
  for _ in range(150):
   if db.run("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='queue_claim_waiter' AND wait_event_type='Lock')")=='t':break
   time.sleep(.02)
  else:raise AssertionError('claim did not wait for revoke')
  leader.stdin.write('COMMIT;\n');leader.stdin.close()
  leader.wait(timeout=15);waiter.wait(timeout=15)
  assert leader.returncode==0,leader.stderr.read()
  assert waiter.returncode==0,waiter.stderr.read()
 finally:
  for p in [leader,waiter]:
   if p and p.poll() is None:p.kill();p.wait()
 db.check("NOT EXISTS(SELECT 1 FROM character_production.jobs WHERE key='revocation-claim')",'no post-revoke job')
 db.check("(SELECT reserved_cents=0 FROM character_production.budgets WHERE provider='synthetic-revocation')",'no reservation after revoke')
 db.finish('enrolled-queue-revocation')
if __name__=='__main__':suite()
