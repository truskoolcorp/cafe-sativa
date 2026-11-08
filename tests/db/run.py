#!/usr/bin/env python3
"""Disposable PostgreSQL integration harness, no provider/network beyond PGHOST.
Requires psql and explicit CAFÉ test opt-in. Never points at a hosted DB by default.
python3 tests/db/run.py --bootstrap
"""
import argparse
import concurrent.futures
import json
import os
import re
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

def migration_drift_checks():
    # A fresh isolated bootstrap must reject unexpected existing writer code/ACLs
    # atomically rather than partially installing Auth guards or overwriting it.
    signature='public.cs_record_gallery_payment(jsonb,uuid,uuid,integer)'
    variants=[
        ('body', "CREATE OR REPLACE FUNCTION public.cs_record_gallery_payment(receipt jsonb,product_uuid uuid,artist_uuid uuid,quantity integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN RETURN '{}'::jsonb; END $$;"),
        ('security',f'ALTER FUNCTION {signature} SECURITY INVOKER;'),
        ('permissions',f'GRANT EXECUTE ON FUNCTION {signature} TO authenticated;'),
        ('configuration',f'ALTER FUNCTION {signature} SET search_path=public;'),
        ('missing',f'DROP FUNCTION {signature};'),
    ]
    for label,change in variants:
        sql(change)
        result=captured(lambda: file(ROOT/'supabase/migrations/20261108090000_durable_concierge_admission.sql'))
        assert 'error' in result and '55000' in result['error'] and 'reviewed commerce writer missing or changed' in result['error'],(label,result)
        assert sql("SELECT to_regnamespace('concierge_private') IS NULL AND to_regprocedure('public.concierge_auth_statement_v1()') IS NULL;")=='t',label
        assert sql("SELECT count(*) FROM pg_trigger WHERE tgname IN ('concierge_auth_delete_statement','concierge_auth_identity_statement','concierge_lounge_update_statement');")=='0',label
        file(HERE/'commerce_functions.sql')
    print('PASS migration rejects body/security/permission/configuration/missing-writer drift atomically')


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
    settings=dict(max_retained_requests=10000,enabled='true', version="'synthetic-races'",global_inflight=100,global_admissions=10000,
                  global_window_seconds=86400,global_budget_microusd=1000000,max_request_cost_microusd=10,
                  max_prompt_bytes=48000,max_input_messages=61,max_output_tokens=512,max_reply_chars=16384,
                  lease_seconds=60,legacy_cutoff="clock_timestamp()-interval '1 second'",legacy_drained='true',
                  charged_failures_approved='true',retention_seconds=86400,content_retention_seconds=3600,
                  replay_max_age_seconds=3600,max_future_skew_seconds=60)
    settings.update(overrides)
    sql('UPDATE concierge_private.policy SET '+','.join(k+'='+str(v) for k,v in settings.items())+';')

def as_role(statement, role):
    # Exercise the installed entrypoint. Never hide missing guards behind a test lock.
    return sql(f'BEGIN; SET LOCAL ROLE {role}; {statement} COMMIT;')

def member_admit(uid, rid, cid=None):
    return json.loads(as_role(
        f"SELECT public.concierge_admit_v1({literal(uid)}::uuid,NULL,{literal(rid)}::uuid,{literal(payload(rid,cid))}::jsonb,'explorer');",
        'service_role'))

def auth_delete(uid):
    return as_role(f'DELETE FROM auth.users WHERE id={literal(uid)}::uuid;', 'supabase_auth_admin')

def captured(call):
    try:
        return {'ok': call()}
    except RuntimeError as exc:
        return {'error': str(exc)}

def assert_fk_or_success(result):
    assert 'ok' in result or ('23503' in result.get('error', '') and 'foreign key constraint' in result['error']), result

def assert_lounge_moderator_denied(result):
    # The UPDATE snapshot can still see staff=true after waiting, while its
    # volatile row guard sees the committed profile deletion and denies ownership.
    # Accept only either exact permission denial, never a lock failure or a SQL
    # error whose CONTEXT happens to mention one of these messages.
    errors = re.findall(r'^ERROR:\s+([0-9A-Z]{5}): ([^\r\n]+)$', result.get('error', ''), re.MULTILINE)
    assert len(errors) == 1 and errors[0][0] == '42501' and errors[0][1] in (
        'Message unavailable or not owned', 'Message ownership required'), result

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
    print('PASS raw full-auth deletion/admission races (explicit and new conversation)')

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
    print('PASS raw full-auth deletion/provider-completion race; no surviving cache')

    for mutation in ('voice_insert', 'message_edit', 'message_delete', 'conversation_end', 'profile_identity'):
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
        results = race([
            lambda: captured(lambda: as_role(statement, 'service_role')),
            lambda: auth_delete(uid),
        ])
        assert_fk_or_success(results[0])
        assert_auth_removed(uid, cid)
        assert sql(f'SELECT count(*) FROM public.memberships WHERE user_id={literal(uid)}::uuid;') == '0'
        assert sql(f'SELECT count(*) FROM public.orders WHERE user_id={literal(uid)}::uuid;') == '0'
    print('PASS raw full-auth deletion against five guarded writer mutations; no orphaned rows')

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
    raw_auth_before_tuple_lock()
    single_statement_writer_orders()


def raw_auth_before_tuple_lock():
    # Regression for the former inversion: a REAL admission entrypoint holds
    # global; raw DELETE must wait before locking auth.users, so that same real
    # transaction can still acquire an auth FK reference. No test lock is added.
    uid, cid = seed_auth_conversation()
    rid, marker = request_id(), str(uuid.uuid4())
    writer = subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],
                              stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    writer.stdin.write(f"BEGIN; SET LOCAL ROLE service_role; SELECT public.concierge_admit_v1({literal(uid)}::uuid,NULL,{literal(rid)}::uuid,{literal(payload(rid,cid))}::jsonb,'explorer'); SELECT 'writer-admitted';\n")
    writer.stdin.flush()
    while writer.stdout.readline().strip() != 'writer-admitted':
        if writer.poll() is not None:
            raise RuntimeError('raw-auth ordering admission barrier failed')
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        deletion = pool.submit(lambda: captured(lambda: auth_delete(uid)))
        try:
            deadline = time.monotonic() + 1.4
            while time.monotonic() < deadline:
                waiting = int(sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=1128351301 AND objid=1 AND NOT granted;"))
                if waiting == 1:
                    break
                time.sleep(.02)
            else:
                raise AssertionError('raw auth deletion never reached global-lock wait')
            writer.stdin.write(f"INSERT INTO public.orders(id,user_id) VALUES({literal(marker)}::uuid,{literal(uid)}::uuid); COMMIT;\n")
            writer.stdin.close()
            writer.wait(timeout=8)
            writer_error = writer.stderr.read()
            deleted = deletion.result(timeout=8)
        finally:
            if writer.poll() is None:
                writer.stdin.write('ROLLBACK;\n'); writer.stdin.close(); writer.wait(timeout=8)
        assert writer.returncode == 0, writer_error
        assert 'ok' in deleted, deleted
        assert sql(f'SELECT user_id IS NULL FROM public.orders WHERE id={literal(marker)}::uuid;') == 't'
        assert sql(f'SELECT redacted AND charged FROM concierge_private.requests WHERE request_id={literal(rid)}::uuid;') == 't'
        assert_auth_removed(uid, cid)
    print('PASS raw auth DELETE waits before auth tuple: real admission then auth-FK insert commits without inversion')


def overlap_after_statement(statement, role, contender):
    # Hold an ordinary entrypoint transaction after its first statement. The
    # contender must be observed waiting on THIS backend, not merely scheduled.
    # This adds no advisory or row lock beyond the statement under test.
    first = subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],
                             stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    first.stdin.write(f"BEGIN; SET LOCAL ROLE {role}; {statement} SELECT 'backend:'||pg_backend_pid();\n")
    first.stdin.flush()
    while True:
        line = first.stdout.readline().strip()
        if line.startswith('backend:'):
            pid = int(line.split(':')[1]); break
        if first.poll() is not None:
            raise RuntimeError('writer statement failed: '+first.stderr.read())
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(contender)
        try:
            deadline=time.monotonic()+1.4
            while time.monotonic()<deadline:
                blocked=int(sql(f'SELECT count(*) FROM pg_stat_activity WHERE {pid}=ANY(pg_blocking_pids(pid));'))
                if blocked:
                    break
                time.sleep(.02)
            else:
                raise AssertionError('contender did not wait on the first real writer transaction')
        finally:
            first.stdin.write('COMMIT;\n'); first.stdin.close(); first.wait(timeout=8)
        assert first.returncode == 0, first.stderr.read()
        return future.result(timeout=8)


def single_statement_writer_orders():
    # PostgREST membership/commerce statements do not themselves call concierge.
    # Test both FK-key-share-first and delete-first ordering, without pretending
    # these entrypoints take the global lock or altering their transaction shape.
    for mutation in ('membership_insert', 'membership_update', 'order_insert', 'order_update'):
        for deletion_first in (False, True):
            uid, cid = seed_auth_conversation()
            extra=str(uuid.uuid4())
            if mutation == 'membership_insert':
                sql(f'DELETE FROM public.memberships WHERE user_id={literal(uid)}::uuid;')
                statement=f'INSERT INTO public.memberships(id,user_id) VALUES({literal(extra)}::uuid,{literal(uid)}::uuid) ON CONFLICT(user_id) DO NOTHING;'
            elif mutation == 'membership_update':
                statement=f"UPDATE public.memberships SET tier='vip',status='active' WHERE id={literal(uid)}::uuid;"
            elif mutation == 'order_insert':
                statement=f'INSERT INTO public.orders(id,user_id) VALUES({literal(extra)}::uuid,{literal(uid)}::uuid);'
            else:
                statement=f'UPDATE public.orders SET updated_at=clock_timestamp() WHERE id={literal(uid)}::uuid;'
            delete=f'DELETE FROM auth.users WHERE id={literal(uid)}::uuid;'
            if deletion_first:
                result=overlap_after_statement(delete,'supabase_auth_admin',
                    lambda: captured(lambda: as_role(statement,'service_role')))
                assert_fk_or_success(result)
            else:
                result=overlap_after_statement(statement,'service_role',lambda: captured(lambda: auth_delete(uid)))
                assert 'ok' in result,result
            assert_auth_removed(uid,cid)
            assert sql(f'SELECT count(*) FROM public.memberships WHERE user_id={literal(uid)}::uuid;') == '0'
            assert sql(f'SELECT count(*) FROM public.orders WHERE user_id={literal(uid)}::uuid;') == '0'
    print('PASS direct membership/order writes in both transaction orders against raw auth deletion')


def commerce_auth_races():
    configure()
    for self_artist in (False, True):
        uid,cid=seed_auth_conversation()
        seller=uid if self_artist else seed_auth_conversation()[0]
        sql(f"UPDATE public.products SET stock_count=2,kind='physical' WHERE id={literal(seller)}::uuid;")
        session='synthetic-gallery-'+str(uuid.uuid4())
        receipt=json.dumps(dict(session_id=session,payment_status='paid',user_id=uid,
            email='fixture@example.invalid',subtotal_cents=1200,total_cents=1200,currency='usd',application_fee_cents=120))
        call=f"SELECT public.cs_record_gallery_payment({literal(receipt)}::jsonb,{literal(seller)}::uuid,{literal(seller)}::uuid,1);"
        results=race([lambda: captured(lambda: json.loads(as_role(call,'service_role'))),
                      lambda: captured(lambda: auth_delete(uid))])
        if 'ok' in results[0]:
            order=results[0]['ok'];assert order.get('created') is True,results
            assert sql(f'SELECT stock_count FROM public.products WHERE id={literal(seller)}::uuid;') == '1'
            assert sql(f"SELECT count(*) FROM public.order_items WHERE order_id={literal(order['id'])}::uuid;") == '1'
            if self_artist:
                assert 'error' in results[1] and '23503' in results[1]['error'],results
                assert sql(f'SELECT count(*) FROM auth.users WHERE id={literal(uid)}::uuid;') == '1'
                # Documented restrictive commerce FK, not a coordination failure.
                sql(f"DELETE FROM public.order_items WHERE order_id={literal(order['id'])}::uuid;")
                auth_delete(uid)
            else:
                assert 'ok' in results[1],results
                assert sql(f"SELECT user_id IS NULL FROM public.orders WHERE id={literal(order['id'])}::uuid;") == 't'
        else:
            error=results[0]['error']
            assert ('23503' in error or (self_artist and 'Product or artist mismatch' in error)),results
            assert 'ok' in results[1],results
            assert sql(f'SELECT count(*) FROM public.orders WHERE stripe_checkout_session_id={literal(session)};') == '0'
        assert_auth_removed(uid,cid)
    print('PASS actual gallery payment RPC/raw auth deletion: buyer SET NULL, artist RESTRICT, atomic receipt/inventory')

    for paid in (False, True):
        uid,cid=seed_auth_conversation()
        sql(f'DELETE FROM public.tickets WHERE user_id={literal(uid)}::uuid; UPDATE public.events SET ticket_price_cents={500 if paid else 0} WHERE id={literal(uid)}::uuid;')
        call=f'SELECT public.cs_reserve_ticket({literal(uid)}::uuid,{literal(uid)}::uuid);'
        results=race([lambda: captured(lambda: json.loads(as_role(call,'service_role'))),
                      lambda: captured(lambda: auth_delete(uid))])
        if 'ok' in results[0] and paid:
            assert results[0]['ok'].get('reservation_id'),results
            assert 'error' in results[1] and '23503' in results[1]['error'],results
            sql(f'DELETE FROM public.cs_ticket_reservations WHERE user_id={literal(uid)}::uuid;')
            auth_delete(uid)
        else:
            assert_fk_or_success(results[0]);assert 'ok' in results[1],results
        assert_auth_removed(uid,cid)
    print('PASS actual ticket reservation RPC/raw auth deletion: free cascade and paid reservation NO ACTION')

    uid,cid=seed_auth_conversation()
    sql(f'DELETE FROM public.tickets WHERE user_id={literal(uid)}::uuid;')
    reserved=json.loads(as_role(f'SELECT public.cs_reserve_ticket({literal(uid)}::uuid,{literal(uid)}::uuid);','service_role'))
    hold=reserved['reservation_id']
    receipt=json.dumps(dict(site='cafe-sativa',payment_status='paid',currency='usd',user_id=uid,
        event_id=uid,amount_cents=500,session_id='synthetic-ticket-'+hold,payment_intent_id='synthetic-intent-'+hold))
    call=f'SELECT public.cs_record_ticket_payment({literal(hold)}::uuid,{literal(receipt)}::jsonb);'
    results=race([lambda: json.loads(as_role(call,'service_role')),lambda: captured(lambda: auth_delete(uid))])
    assert results[0].get('created') is True and results[0].get('state')=='fulfilled',results
    assert 'error' in results[1] and '23503' in results[1]['error'],results
    replay=json.loads(as_role(call,'service_role'))
    assert replay.get('created') is False and replay.get('ticket_id')==results[0]['ticket_id'],replay
    assert sql(f'SELECT count(*) FROM auth.sessions WHERE user_id={literal(uid)}::uuid;') == '1'
    sql(f'DELETE FROM public.cs_ticket_reservations WHERE user_id={literal(uid)}::uuid;')
    auth_delete(uid);assert_auth_removed(uid,cid)
    print('PASS actual ticket payment RPC/raw auth deletion: blocked deletion, fulfillment and duplicate receipt unchanged')


def lounge_auth_race():
    uid,cid=seed_auth_conversation()
    call=f"SET LOCAL request.jwt.claim.sub={literal(uid)}; SELECT public.soft_delete_lounge_message({literal(uid)}::uuid);"
    results=race([lambda: captured(lambda: as_role(call,'authenticated')),lambda: auth_delete(uid)])
    if 'error' in results[0]:
        assert '42501' in results[0]['error'] and 'Message unavailable or not owned' in results[0]['error'],results
    assert_auth_removed(uid,cid)
    print('PASS actual authenticated Lounge author soft-delete RPC/raw auth deletion')

    uid,cid=seed_auth_conversation()
    other,other_cid=seed_auth_conversation()
    call=f"SET LOCAL request.jwt.claim.sub={literal(uid)}; SELECT public.soft_delete_lounge_message({literal(other)}::uuid);"
    denied=captured(lambda: as_role(call,'authenticated'))
    assert 'error' in denied and '42501' in denied['error'] and 'Message unavailable or not owned' in denied['error'],denied
    assert sql(f'SELECT deleted_at IS NULL AND deleted_by IS NULL FROM public.lounge_messages WHERE id={literal(other)}::uuid;')=='t'
    sql(f'UPDATE public.profiles SET is_staff=true WHERE id={literal(uid)}::uuid;')
    results=race([lambda: captured(lambda: as_role(call,'authenticated')),lambda: captured(lambda: auth_delete(uid))])
    if 'ok' in results[0]:
        assert 'error' in results[1] and '23503' in results[1]['error'] and 'lounge_messages_deleted_by_fkey' in results[1]['error'],results
        assert sql(f'SELECT deleted_at IS NOT NULL AND deleted_by={literal(uid)}::uuid FROM public.lounge_messages WHERE id={literal(other)}::uuid;')=='t'
        assert sql(f'SELECT count(*) FROM auth.sessions WHERE user_id={literal(uid)}::uuid;')=='1'
        sql(f'DELETE FROM public.lounge_messages WHERE id={literal(other)}::uuid;')
        auth_delete(uid)
    else:
        assert_lounge_moderator_denied(results[0])
        assert 'ok' in results[1],results
        assert sql(f'SELECT deleted_at IS NULL AND deleted_by IS NULL FROM public.lounge_messages WHERE id={literal(other)}::uuid;')=='t'
    assert_auth_removed(uid,cid)
    auth_delete(other);assert_auth_removed(other,other_cid)
    print('PASS actual Lounge moderator/NO ACTION race and denied nonowner; no authorization bypass')


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
    os.environ['PGOPTIONS']='-c statement_timeout=10000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=10000'
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
        file(HERE/'commerce_bootstrap.sql')
        file(HERE/'commerce_functions.sql')
        migration_drift_checks()
        import combined_install_checks
        combined_install_checks.verify(sql, (ROOT/'supabase/migrations/20261108090000_durable_concierge_admission.sql').read_text())
        file(ROOT/'supabase/migrations/20261108090000_durable_concierge_admission.sql')
    for fixture in ('combined_install.sql','retained_backlog.sql','retained_backlog_extra.sql','cleanup_privacy.sql','cleanup_sweep.sql','isolation_contract.sql'):
        file(HERE/fixture)
    # Explicit disposable-fixture ceiling; never alter the migration default.
    sql('UPDATE concierge_private.policy SET max_retained_requests=10000;')
    for fixture in ('auth_integration.sql','durable_concierge.sql','roles.sql','full_auth_deletion.sql','durable_lifecycle.sql'):
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
    commerce_auth_races()
    lounge_auth_race()
    lifecycle_races()
    import combined_races
    combined_races.run(__import__(__name__))
    # Completion collision and all sequential transitions already exercised by SQL.
    print('PASS all sequential/role/concurrent durable concierge checks')

if __name__=='__main__': main()
