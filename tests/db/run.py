#!/usr/bin/env python3
"""Disposable PostgreSQL integration harness, no provider/network beyond PGHOST.
Requires psql and explicit CAFÉ test opt-in. Never points at a hosted DB by default.
python3 tests/db/run.py --bootstrap
"""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

def sql(statement):
    p = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=statement,
                       text=True, capture_output=True, timeout=20)
    if p.returncode:
        raise RuntimeError(p.stderr.strip())
    return p.stdout.strip()

def file(path):
    sql(path.read_text())

def literal(value):
    return "'" + str(value).replace("'", "''") + "'"

def payload():
    return json.dumps(dict(version=1,host='ginger',message='hello',conversation_id=None,surface='web-chat',room_id=None))

def admit(session, rid=None):
    rid = rid or str(uuid.uuid4())
    return json.loads(sql(f"SELECT public.concierge_admit_v1(NULL,{literal(session)},{literal(rid)}::uuid,{literal(payload())}::jsonb,'anonymous');"))

def finish(result, outcome='no_dispatch'):
    return json.loads(sql(f"SELECT public.concierge_finish_v1({literal(result['requester'])},{literal(result['request_id'])}::uuid,{literal(result['owner_token'])}::uuid,{literal(outcome)});"))

def race(calls):
    # Separate psql processes/connections. A held global lock ensures a queued race.
    blocker = subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    blocker.stdin.write("BEGIN; SELECT pg_advisory_xact_lock(1128351301,1); SELECT 'locked';\n")
    blocker.stdin.flush()
    while blocker.stdout.readline().strip() != 'locked':
        if blocker.poll() is not None:
            raise RuntimeError('race barrier failed')
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(calls)) as pool:
        futures = [pool.submit(call) for call in calls]
        queued=False
        try:
            deadline=time.monotonic()+1.4  # below the function's two-second lock timeout
            while time.monotonic()<deadline:
                waiting=int(sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=1128351301 AND objid=1 AND NOT granted;"))
                if waiting>=len(calls):
                    queued=True
                    break
                time.sleep(.02)
        finally:
            blocker.stdin.write('COMMIT;\n'); blocker.stdin.close(); blocker.wait(timeout=5)
        if not queued:
            raise AssertionError('Unable to queue every contender before lock timeout; no race pass claimed')
        return [future.result() for future in futures]

def configure(**overrides):
    settings=dict(enabled='true', version="'synthetic-races'",global_inflight=100,global_admissions=10000,
                  global_window_seconds=86400,global_budget_microusd=1000000,max_request_cost_microusd=10,
                  max_prompt_bytes=48000,max_input_messages=61,max_output_tokens=512,max_reply_chars=16384,
                  lease_seconds=60,legacy_cutoff="clock_timestamp()-interval '1 second'",legacy_drained='true',
                  charged_failures_approved='true',retention_seconds=86400)
    settings.update(overrides)
    sql('UPDATE concierge_private.policy SET '+','.join(k+'='+str(v) for k,v in settings.items())+';')

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--bootstrap',action='store_true'); args=parser.parse_args()
    if os.environ.get('CAFE_DISPOSABLE_DB') != '1':
        raise SystemExit('Set CAFE_DISPOSABLE_DB=1 only for an isolated disposable synthetic database.')
    host=os.environ.get('PGHOST','')
    if host not in ('','localhost','127.0.0.1','::1') and not (host.startswith('/') and ',' not in host and all(ord(c)>31 for c in host)):
        raise SystemExit('This harness only accepts a loopback host or local Unix socket directory.')
    # libpq hostaddr/service variables can override a validated PGHOST. Clear ALL
    # inherited PG* controls, retaining only this explicit synthetic contract.
    retained={k:os.environ[k] for k in ('PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD') if k in os.environ}
    for key in list(os.environ):
        if key.startswith('PG'): del os.environ[key]
    os.environ.update(retained)
    port=os.environ.get('PGPORT','5432')
    if not port.isdecimal() or not 1<=int(port)<=65535:
        raise SystemExit('PGPORT must be one numeric local test port.')
    os.environ['PGOPTIONS']='-c statement_timeout=10000 -c lock_timeout=3000'
    os.environ['PGCONNECT_TIMEOUT']='5'
    if not os.environ.get('PGDATABASE') or not os.environ.get('PGUSER'):
        raise SystemExit('Explicit PGDATABASE and PGUSER required.')
    if os.environ['PGDATABASE'] not in ('cafe_durable_test','concierge_isolated_test'):
        raise SystemExit('PGDATABASE must be cafe_durable_test or concierge_isolated_test (disposable fixtures only).')
    if args.bootstrap:
        file(HERE/'bootstrap.sql')
        file(ROOT/'supabase/migrations/20261108090000_durable_concierge_admission.sql')
    file(HERE/'durable_concierge.sql'); file(HERE/'roles.sql')
    configure()
    rid=str(uuid.uuid4())
    results=race([lambda: admit('race-duplicate',rid) for _ in range(8)])
    winners=[x for x in results if x.get('admitted')]
    assert len(winners)==1,results
    assert all(x.get('state')=='reserved' for x in results),results
    finish(winners[0])
    print('PASS duplicate ID race: exactly one capability')
    # Count nine genuine terminal charges, then race for anonymous last quota slot.
    for _ in range(9):
        a=admit('race-quota')
        sql(f"SELECT public.concierge_dispatch_v1({literal(a['requester'])},{literal(a['request_id'])}::uuid,{literal(a['owner_token'])}::uuid);")
        finish(a,'provider_terminal_failure')
    results=race([lambda: admit('race-quota') for _ in range(8)])
    winners=[x for x in results if x.get('admitted')]
    assert len(winners)==1 and sum(x.get('error')=='quota_exceeded' for x in results)==7,results
    finish(winners[0])
    print('PASS requester last-slot race')
    configure(global_inflight=1)
    results=race([lambda i=i: admit(f'race-global-{i}') for i in range(8)])
    winners=[x for x in results if x.get('admitted')]
    assert len(winners)==1 and sum(x.get('error')=='capacity_busy' for x in results)==7,results
    finish(winners[0]);print('PASS global inflight race')
    # Prior refunded reservations contribute no charge. Nine quota failures do.
    used=int(sql('SELECT count(*) FROM concierge_private.requests WHERE charged;'))
    configure(global_admissions=used+1)
    results=race([lambda i=i: admit(f'race-window-{i}') for i in range(8)])
    winners=[x for x in results if x.get('admitted')]
    assert len(winners)==1,results
    finish(winners[0]);print('PASS global rolling-window race')
    cost=int(sql('SELECT coalesce(sum(reserved_cost_microusd),0) FROM concierge_private.requests WHERE charged;'))
    configure(global_budget_microusd=cost+10)
    results=race([lambda i=i: admit(f'race-budget-{i}') for i in range(8)])
    winners=[x for x in results if x.get('admitted')]
    assert len(winners)==1,results
    finish(winners[0]);print('PASS global budget race')
    configure()
    # Simulated lost-ack retry after known success, not an actual network interruption.
    a=admit('lost-ack');b=admit('lost-ack',a['request_id'])
    assert b['admitted'] is False and 'owner_token' not in b
    finish(a)
    # Lock timeout must fail before creating any request, not hang/dispatch.
    blocker=subprocess.Popen(['psql','-X','-qAt'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    blocker.stdin.write("BEGIN; SELECT pg_advisory_xact_lock(1128351301,1); SELECT 'locked';\n");blocker.stdin.flush()
    while blocker.stdout.readline().strip()!='locked':
        if blocker.poll() is not None: raise RuntimeError('timeout barrier failed')
    try:
        try: admit('race-timeout'); raise AssertionError('expected lock timeout')
        except RuntimeError as exc: assert 'lock timeout' in str(exc),str(exc)
    finally:
        blocker.stdin.write('ROLLBACK;\n');blocker.stdin.close();blocker.wait(timeout=5)
    assert sql("SELECT count(*) FROM concierge_private.requests WHERE requester='s:race-timeout';")=='0'
    print('PASS lock timeout leaves no charge')
    a=admit('race-dispatch-complete')
    dispatch=f"SELECT public.concierge_dispatch_v1({literal(a['requester'])},{literal(a['request_id'])}::uuid,{literal(a['owner_token'])}::uuid);"
    results=race([lambda: json.loads(sql(dispatch)) for _ in range(4)])
    assert sum(x.get('dispatch_granted') is True for x in results)==1,results
    complete=f"SELECT public.concierge_complete_v1({literal(a['requester'])},{literal(a['request_id'])}::uuid,{literal(a['owner_token'])}::uuid,'hello','world',true);"
    results=race([lambda: json.loads(sql(complete)) for _ in range(8)])
    assert all(x.get('state')=='completed' for x in results),results
    assert all(x['response']==results[0]['response'] for x in results),results
    assert sql(f"SELECT count(*) FROM concierge_private.requests WHERE requester={literal(a['requester'])} AND request_id={literal(a['request_id'])}::uuid AND state='completed';")=='1'
    assert sql(f"SELECT count(*) FROM public.host_messages WHERE conversation_id={literal(a['conversation_id'])}::uuid;")=='2'
    print('PASS concurrent dispatch/completion: one dispatch and two messages')
    # A profile cascade versus fresh authenticated admission must not invert locks.
    uid=str(uuid.uuid4());cid=str(uuid.uuid4());rid=str(uuid.uuid4())
    sql(f"INSERT INTO public.profiles(id) VALUES({literal(uid)}::uuid); INSERT INTO public.host_conversations(id,user_id,host_agent,surface) VALUES({literal(cid)}::uuid,{literal(uid)}::uuid,'ginger','web-chat');")
    p=json.loads(payload());p['conversation_id']=cid
    statement=f"SELECT public.concierge_admit_v1({literal(uid)}::uuid,NULL,{literal(rid)}::uuid,{literal(json.dumps(p))}::jsonb,'explorer');"
    results=race([lambda: json.loads(sql(statement)),lambda: sql(f"DELETE FROM public.profiles WHERE id={literal(uid)}::uuid;")])
    admitted=results[0]
    assert admitted.get('admitted') is True or (admitted.get('error')=='conversation_unavailable' and admitted.get('admitted') is False),results
    if admitted.get('admitted'):
        assert sql(f"SELECT redacted FROM concierge_private.requests WHERE requester={literal(admitted['requester'])} AND request_id={literal(rid)}::uuid;")=='t'
        finish(admitted)
    assert sql(f"SELECT count(*) FROM public.host_conversations WHERE id={literal(cid)}::uuid;")=='0'
    print('PASS profile cascade/admission race')
    # Completion collision and all sequential transitions already exercised by SQL.
    print('PASS all sequential/role/concurrent durable concierge checks')

if __name__=='__main__': main()
