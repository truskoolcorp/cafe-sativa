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
    p = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], input=statement,
                       text=True, capture_output=True, timeout=20)
    if p.returncode:
        raise RuntimeError(p.stderr.strip())
    return p.stdout.strip()

def file(path):
    sql(path.read_text())

def literal(value):
    return "'" + str(value).replace("'", "''") + "'"

def request_id():
    # Python < 3.14 has no uuid7(). Keep random 74 bits and fixed RFC version/variant.
    ms = int(time.time() * 1000)
    return str(uuid.UUID(int=(ms << 80) | (7 << 76) | (uuid.uuid4().int & ((1 << 76)-1) & ~(3 << 62)) | (2 << 62)))

def payload(rid, cid=None):
    return json.dumps(dict(version=2,issued_at=uuid.UUID(rid).int >> 80,
                          host='ginger',message='hello',conversation_id=cid,surface='web-chat',room_id=None))

def admit(session, rid=None):
    rid = rid or request_id()
    return json.loads(sql(f"SELECT public.concierge_admit_v1(NULL,{literal(session)},{literal(rid)}::uuid,{literal(payload(rid))}::jsonb,'anonymous');"))

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
                  charged_failures_approved='true',retention_seconds=86400,content_retention_seconds=3600,
                  replay_max_age_seconds=3600,max_future_skew_seconds=60)
    settings.update(overrides)
    sql('UPDATE concierge_private.policy SET '+','.join(k+'='+str(v) for k,v in settings.items())+';')

def as_role(statement, role, coordinated=False):
    # Explicit transaction coordination is test setup, not an installed auth guard.
    lock = 'SELECT pg_catalog.pg_advisory_xact_lock(1128351301,1);' if coordinated else ''
    return sql(f'BEGIN; SET LOCAL ROLE {role}; {lock} {statement} COMMIT;')

def member_admit(uid, rid, cid=None):
    return json.loads(as_role(
        f"SELECT public.concierge_admit_v1({literal(uid)}::uuid,NULL,{literal(rid)}::uuid,{literal(payload(rid,cid))}::jsonb,'explorer');",
        'service_role'))

def auth_delete(uid, coordinated=True):
    return as_role(f'DELETE FROM auth.users WHERE id={literal(uid)}::uuid;', 'supabase_auth_admin', coordinated)

def captured(call):
    try:
        return {'ok': call()}
    except RuntimeError as exc:
        return {'error': str(exc)}

def assert_fk_or_success(result):
    assert 'ok' in result or ('23503' in result.get('error', '') and 'foreign key constraint' in result['error']), result

def assert_auth_removed(uid, cid):
    assert sql(f'SELECT count(*) FROM auth.users WHERE id={literal(uid)}::uuid;') == '0'
    assert sql(f'SELECT count(*) FROM public.profiles WHERE id={literal(uid)}::uuid;') == '0'
    assert sql(f'SELECT count(*) FROM public.host_conversations WHERE id={literal(cid)}::uuid;') == '0'
    assert sql(f'SELECT count(*) FROM public.host_messages WHERE conversation_id={literal(cid)}::uuid;') == '0'
    assert sql(f"SELECT count(*) FROM concierge_private.requests WHERE requester={literal('u:'+uid)} AND (NOT redacted OR payload IS NOT NULL OR response IS NOT NULL OR fingerprint IS NOT NULL OR provider_receipt IS NOT NULL OR conversation_id IS NOT NULL);") == '0'
    assert sql(f'SELECT user_id IS NULL FROM public.orders WHERE id={literal(uid)}::uuid;') == 't'
    assert sql(f'SELECT updated_by IS NULL FROM public.room_state WHERE id={literal(uid)}::uuid;') == 't'

def seed_auth_conversation():
    uid, cid = str(uuid.uuid4()), str(uuid.uuid4())
    sql(f"SELECT test_fixture.seed_account({literal(uid)}::uuid); INSERT INTO public.host_conversations(id,user_id,host_agent,surface) VALUES({literal(cid)}::uuid,{literal(uid)}::uuid,'ginger','web-chat');")
    return uid, cid

def full_auth_races():
    configure()
    # Auth deletion is performed by its real modeled owner, never the service role.
    for explicit_conversation in (True, False):
        uid, cid = seed_auth_conversation()
        rid = request_id()
        results = race([
            lambda: captured(lambda: member_admit(uid, rid, cid if explicit_conversation else None)),
            lambda: auth_delete(uid),
        ])
        result = results[0]
        if 'error' in result:
            # With no explicit conversation, a deleted profile can fail the FK
            # during new conversation INSERT. This must roll back all admission work.
            assert not explicit_conversation, result
            assert_fk_or_success(result)
            assert sql(f'SELECT count(*) FROM concierge_private.requests WHERE request_id={literal(rid)}::uuid;') == '0'
        else:
            a = result['ok']
            assert a.get('admitted') is True or (a.get('error') == 'conversation_unavailable' and a.get('admitted') is False), a
            if a.get('admitted'):
                assert sql(f'SELECT redacted AND charged FROM concierge_private.requests WHERE request_id={literal(rid)}::uuid;') == 't'
                finish(a)
        assert_auth_removed(uid, cid)
    print('PASS coordinated full-auth deletion/admission races (explicit and new conversation)')

    uid, cid = seed_auth_conversation()
    rid = request_id(); a = member_admit(uid, rid, cid)
    assert a.get('admitted') is True, a
    dispatch = as_role(f"SELECT public.concierge_dispatch_v1({literal(a['requester'])},{literal(rid)}::uuid,{literal(a['owner_token'])}::uuid);", 'service_role')
    assert json.loads(dispatch).get('dispatch_granted') is True, dispatch
    complete = f"SELECT public.concierge_complete_v1({literal(a['requester'])},{literal(rid)}::uuid,{literal(a['owner_token'])}::uuid,'hello','synthetic reply',true);"
    results = race([lambda: json.loads(as_role(complete, 'service_role')), lambda: auth_delete(uid)])
    assert results[0].get('state') == 'completed' or results[0].get('error') == 'gone', results
    assert_auth_removed(uid, cid)
    assert sql(f'SELECT charged FROM concierge_private.requests WHERE request_id={literal(rid)}::uuid;') == 't'
    # This fixture made no provider call. Simulate documented terminal evidence;
    # deletion must never have automatically refunded an already dispatched turn.
    finish(a, 'provider_terminal_failure')
    print('PASS coordinated full-auth deletion/provider-completion race; no surviving cache')

    for mutation in ('voice_insert', 'message_edit', 'message_delete', 'conversation_end', 'profile_identity', 'profile_reference_insert', 'auth_reference_insert'):
        uid, cid = seed_auth_conversation()
        mid, extra = str(uuid.uuid4()), str(uuid.uuid4())
        sql(f"INSERT INTO public.host_messages(id,conversation_id,role,content) VALUES({literal(mid)}::uuid,{literal(cid)}::uuid,'user','synthetic previous message');")
        if mutation == 'voice_insert':
            statement = f"INSERT INTO public.host_messages(conversation_id,role,content) VALUES({literal(cid)}::uuid,'user','synthetic voice writer'); UPDATE public.host_conversations SET ended_at=clock_timestamp() WHERE id={literal(cid)}::uuid;"
        elif mutation == 'message_edit':
            statement = f"UPDATE public.host_messages SET content='synthetic edit' WHERE id={literal(mid)}::uuid;"
        elif mutation == 'message_delete':
            statement = f'DELETE FROM public.host_messages WHERE id={literal(mid)}::uuid;'
        elif mutation == 'conversation_end':
            statement = f'UPDATE public.host_conversations SET ended_at=clock_timestamp() WHERE id={literal(cid)}::uuid;'
        elif mutation == 'profile_identity':
            sql(f'INSERT INTO auth.users(id) VALUES({literal(extra)}::uuid); DELETE FROM public.profiles WHERE id={literal(extra)}::uuid;')
            statement = f'UPDATE public.profiles SET id={literal(extra)}::uuid WHERE id={literal(uid)}::uuid;'
        elif mutation == 'profile_reference_insert':
            statement = f'INSERT INTO public.memberships(id,user_id) VALUES({literal(extra)}::uuid,{literal(uid)}::uuid);'
        else:
            statement = f'INSERT INTO public.orders(id,user_id) VALUES({literal(extra)}::uuid,{literal(uid)}::uuid);'
        results = race([
            lambda: captured(lambda: as_role(statement, 'service_role', coordinated=True)),
            lambda: auth_delete(uid),
        ])
        assert_fk_or_success(results[0])
        assert_auth_removed(uid, cid)
        assert sql(f'SELECT count(*) FROM public.memberships WHERE user_id={literal(uid)}::uuid;') == '0'
        assert sql(f'SELECT count(*) FROM public.orders WHERE user_id={literal(uid)}::uuid;') == '0'
    print('PASS coordinated full-auth deletion against seven writer mutations; no orphaned rows')

    for operation in ('admission', 'completion'):
        uid, cid = seed_auth_conversation()
        blocker_id, rid = str(uuid.uuid4()), request_id()
        sql(f'INSERT INTO public.cs_episode_script_approvals(id,approved_by) VALUES({literal(blocker_id)}::uuid,{literal(uid)}::uuid);')
        if operation == 'admission':
            contender = lambda: member_admit(uid, rid, cid)
        else:
            a = member_admit(uid, rid, cid)
            complete = f"SELECT public.concierge_complete_v1({literal(a['requester'])},{literal(rid)}::uuid,{literal(a['owner_token'])}::uuid,'hello','synthetic completion survives blocked deletion',false);"
            contender = lambda: json.loads(as_role(complete, 'service_role'))
        results = race([contender, lambda: captured(lambda: auth_delete(uid))])
        assert 'error' in results[1], results
        assert_fk_or_success(results[1])
        if operation == 'admission':
            assert results[0].get('admitted') is True, results
        else:
            assert results[0].get('state') == 'completed', results
        assert sql(f'SELECT count(*) FROM auth.users WHERE id={literal(uid)}::uuid;') == '1'
        assert sql(f'SELECT count(*) FROM auth.sessions WHERE user_id={literal(uid)}::uuid;') == '1'
        assert sql(f'SELECT NOT redacted AND payload IS NOT NULL FROM concierge_private.requests WHERE request_id={literal(rid)}::uuid;') == 't'
        if operation == 'completion':
            assert sql(f'SELECT response IS NOT NULL FROM concierge_private.requests WHERE request_id={literal(rid)}::uuid;') == 't'
        else:
            finish(results[0])
        sql(f'DELETE FROM public.cs_episode_script_approvals WHERE id={literal(blocker_id)}::uuid;')
        auth_delete(uid)
        assert_auth_removed(uid, cid)
    print('PASS NO ACTION blocked full-auth deletion races roll back without losing admission/completion')
    uncoordinated_auth_lock_inversion()


def uncoordinated_auth_lock_inversion():
    # Negative regression: direct Auth deletion already owns auth.users before its
    # profile cascade waits for global. A global-first orders FK writer then waits
    # for that auth tuple. Without a coordinated deletion entry point a bounded
    # deadlock/lock-timeout is EXPECTED, not proof that arbitrary callers are safe.
    uid, cid = seed_auth_conversation()
    rid = request_id(); a = member_admit(uid, rid, cid)
    as_role(f"SELECT public.concierge_complete_v1({literal(a['requester'])},{literal(rid)}::uuid,{literal(a['owner_token'])}::uuid,'hello','negative-race rollback cache',false);", 'service_role')
    before = sql(f'SELECT to_jsonb(r) FROM concierge_private.requests r WHERE request_id={literal(rid)}::uuid;')
    marker = str(uuid.uuid4())
    writer = subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],
                              stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    writer.stdin.write("BEGIN; SET LOCAL ROLE service_role; SELECT pg_advisory_xact_lock(1128351301,1); SELECT 'writer-locked';\n")
    writer.stdin.flush()
    while writer.stdout.readline().strip() != 'writer-locked':
        if writer.poll() is not None:
            raise RuntimeError('uncoordinated race writer barrier failed')
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        deletion = pool.submit(lambda: captured(lambda: auth_delete(uid, coordinated=False)))
        queued = False
        try:
            deadline = time.monotonic() + 1.4
            while time.monotonic() < deadline:
                waiting = int(sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=1128351301 AND objid=1 AND NOT granted;"))
                if waiting == 1:
                    queued = True
                    break
                time.sleep(.02)
            if not queued:
                raise AssertionError('auth deletion never reached global-lock wait; no negative-race pass claimed')
            # Marker write must never commit, whichever statement is chosen victim.
            writer.stdin.write(f"INSERT INTO public.orders(id,user_id) VALUES({literal(marker)}::uuid,{literal(uid)}::uuid); ROLLBACK;\n")
            writer.stdin.close()
            writer.wait(timeout=8)
            writer_error = writer.stderr.read()
            deleted = deletion.result(timeout=8)
        finally:
            if writer.poll() is None:
                writer.stdin.write('ROLLBACK;\n'); writer.stdin.close(); writer.wait(timeout=8)
        errors = [writer_error, deleted.get('error','')]
        assert any('40P01' in e or '55P03' in e for e in errors), (errors, deleted)
        assert sql(f'SELECT count(*) FROM public.orders WHERE id={literal(marker)}::uuid;') == '0'
        # Failed deletion retains its complete graph; successful retry/deletion
        # must have removed everything, never leave half-redacted private content.
        present = sql(f'SELECT count(*) FROM auth.users WHERE id={literal(uid)}::uuid;') == '1'
        if present:
            assert sql(f'SELECT to_jsonb(r) FROM concierge_private.requests r WHERE request_id={literal(rid)}::uuid;') == before
            assert sql(f'SELECT count(*) FROM auth.sessions WHERE user_id={literal(uid)}::uuid;') == '1'
            assert sql(f'SELECT count(*) FROM public.host_conversations WHERE id={literal(cid)}::uuid;') == '1'
            auth_delete(uid)
        assert_auth_removed(uid, cid)
    print('PASS negative raw-auth-deletion lock inversion: bounded failure and atomic rollback; coordinated entry point still required')

def lifecycle_races():
    # First mint a historical synthetic key under an explicitly wider test policy,
    # before advancing the irreversible rejection watermark. Never refresh the key.
    configure(replay_max_age_seconds=1000000)
    old = request_id()
    old = str(uuid.UUID(int=((int(time.time()*1000)-4*86400000) << 80) | (uuid.UUID(old).int & ((1 << 80)-1))))
    a = admit('race-prune-replay', old)
    assert a.get('admitted') is True, a
    sql(f"SELECT public.concierge_complete_v1({literal(a['requester'])},{literal(old)}::uuid,{literal(a['owner_token'])}::uuid,'hello','old synthetic response',false);")
    sql(f"UPDATE concierge_private.requests SET admitted_at=clock_timestamp()-interval '4 days',lease_until=clock_timestamp()-interval '4 days'+interval '60 seconds',finished_at=clock_timestamp()-interval '3 days',content_expires_at=clock_timestamp()-interval '3 days' WHERE request_id={literal(old)}::uuid;")
    configure()
    results = race([
        lambda: json.loads(sql('SELECT concierge_private.maintain_v1(1000);')),
        lambda: admit('race-prune-replay', old),
    ])
    assert results[1].get('admitted') is not True and results[1].get('error') in ('gone','request_expired'), results
    assert sql(f'SELECT count(*) FROM concierge_private.requests WHERE request_id={literal(old)}::uuid;') == '0'
    assert sql(f"SELECT count(*) FROM public.host_messages WHERE conversation_id={literal(a['conversation_id'])}::uuid;") == '2'
    configure(replay_max_age_seconds=1000000)
    b = admit('race-prune-replay', old)
    assert b.get('error') == 'request_expired' and b.get('terminal') is True, b
    assert sql(f'SELECT count(*) FROM concierge_private.requests WHERE request_id={literal(old)}::uuid;') == '0'
    print('PASS cleanup/same-ID replay race: pruned key never readmitted, including after policy expansion')

    configure()
    for contender in ('completion','terminal_failure','new_admission'):
        session = 'race-cleanup-'+contender
        a = admit(session); rid = a['request_id']
        assert a.get('admitted') is True, a
        dispatch = f"SELECT public.concierge_dispatch_v1({literal(a['requester'])},{literal(rid)}::uuid,{literal(a['owner_token'])}::uuid);"
        assert json.loads(sql(dispatch)).get('dispatch_granted') is True
        sql(f"UPDATE concierge_private.requests SET content_expires_at=clock_timestamp()-interval '1 second' WHERE request_id={literal(rid)}::uuid;")
        if contender == 'completion':
            statement = f"SELECT public.concierge_complete_v1({literal(a['requester'])},{literal(rid)}::uuid,{literal(a['owner_token'])}::uuid,'hello','must not recreate expired cache',true);"
            call = lambda: json.loads(as_role(statement, 'service_role'))
        elif contender == 'terminal_failure':
            call = lambda: finish(a,'provider_terminal_failure')
        else:
            call = lambda: admit(session)
        results = race([lambda: json.loads(sql('SELECT concierge_private.maintain_v1(1000);')), call])
        if contender == 'completion':
            assert results[1].get('error') == 'gone', results
        elif contender == 'terminal_failure':
            assert results[1].get('state') == 'failed', results
        else:
            assert results[1].get('error') == 'capacity_busy', results
        assert sql(f'SELECT charged AND redacted AND payload IS NULL AND response IS NULL AND provider_receipt IS NULL FROM concierge_private.requests WHERE request_id={literal(rid)}::uuid;') == 't'
        assert sql(f"SELECT count(*) FROM public.host_messages WHERE conversation_id={literal(a['conversation_id'])}::uuid;") == '0'
        if contender != 'terminal_failure':
            assert sql(f"SELECT state='uncertain' AND quarantined_at IS NOT NULL AND owner_token IS NOT NULL FROM concierge_private.requests WHERE request_id={literal(rid)}::uuid;") == 't'
            finish(a,'provider_terminal_failure')
        sql('SELECT concierge_private.maintain_v1(1000);')
        assert sql(f"SELECT state='failed' AND charged AND owner_token IS NULL FROM concierge_private.requests WHERE request_id={literal(rid)}::uuid;") == 't'
    print('PASS cleanup/completion, terminal-evidence and new-admission races: no content resurrection or unknown refund')


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
        if sql("SELECT current_user;") != 'postgres':
            raise SystemExit('Bootstrap requires the disposable postgres fixture owner.')
        if sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%';") != '0':
            raise SystemExit('Bootstrap requires an empty disposable database.')
        file(HERE/'bootstrap.sql')
        file(ROOT/'supabase/migrations/20261108090000_durable_concierge_admission.sql')
    for fixture in ('durable_concierge.sql','roles.sql','full_auth_deletion.sql','durable_lifecycle.sql'):
        file(HERE/fixture)
    configure()
    rid=request_id()
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
    uid=str(uuid.uuid4());cid=str(uuid.uuid4());rid=request_id()
    sql(f"INSERT INTO auth.users(id) VALUES({literal(uid)}::uuid); INSERT INTO public.host_conversations(id,user_id,host_agent,surface) VALUES({literal(cid)}::uuid,{literal(uid)}::uuid,'ginger','web-chat');")
    p=json.loads(payload(rid,cid))
    statement=f"SELECT public.concierge_admit_v1({literal(uid)}::uuid,NULL,{literal(rid)}::uuid,{literal(json.dumps(p))}::jsonb,'explorer');"
    results=race([lambda: json.loads(sql(statement)),lambda: sql(f"DELETE FROM public.profiles WHERE id={literal(uid)}::uuid;")])
    admitted=results[0]
    assert admitted.get('admitted') is True or (admitted.get('error')=='conversation_unavailable' and admitted.get('admitted') is False),results
    if admitted.get('admitted'):
        assert sql(f"SELECT redacted FROM concierge_private.requests WHERE requester={literal(admitted['requester'])} AND request_id={literal(rid)}::uuid;")=='t'
        finish(admitted)
    assert sql(f"SELECT count(*) FROM public.host_conversations WHERE id={literal(cid)}::uuid;")=='0'
    print('PASS profile cascade/admission race')
    full_auth_races()
    lifecycle_races()
    # Completion collision and all sequential transitions already exercised by SQL.
    print('PASS all sequential/role/concurrent durable concierge checks')

if __name__=='__main__': main()
