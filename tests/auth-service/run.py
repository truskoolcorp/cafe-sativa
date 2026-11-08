#!/usr/bin/env python3
"""Actual official GoTrue HTTP acceptance, confined to a disposable CI database.

Auth rows are created, updated and deleted only through the real Auth API.
SQL supplies abbreviated public Café fixtures, exercises application RPCs, and
observes real database waits/results. It never substitutes for Auth deletion.
"""
import base64
import concurrent.futures
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import time
import urllib.error
import urllib.request
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
MIGRATION = ROOT / 'supabase/migrations/20261108090000_durable_concierge_admission.sql'
AUTH_URL = None  # Set only from verified, job-owned internal Docker metadata.
AUTH_VERSION = 'v2.197.0'
JWT_SECRET = b'synthetic-auth-ci-only-not-a-real-project-secret-2026'
PASSWORD = 'Synthetic-only-Password-42!'

# Reuse SQL utilities, not the synthetic Auth schema, SQL Auth seed/deletion
# helpers, or the direct-SQL suite. Importing this module does not execute it.
spec = importlib.util.spec_from_file_location('cafe_database_helpers', ROOT / 'tests/db/run.py')
db = importlib.util.module_from_spec(spec)
spec.loader.exec_module(db)
sql, literal, as_role = db.sql, db.literal, db.as_role
isolation_spec = importlib.util.spec_from_file_location('cafe_auth_isolation', HERE / 'isolation.py')
isolation = importlib.util.module_from_spec(isolation_spec)
isolation_spec.loader.exec_module(isolation)


def configure_environment():
    global AUTH_URL
    isolation.project_name()  # Validate opt-in before any Docker inspection.
    endpoints = isolation.discover_endpoints()
    # Never consume a repository .env, real credentials, libpq hostaddr/service,
    # an environment-supplied URL, a proxy, or a user's password file.
    for key in list(os.environ):
        if key.startswith('PG'):
            del os.environ[key]
    AUTH_URL = f"http://{endpoints['auth']}:9999"
    os.environ.update(PGHOST=endpoints['db'], PGPORT='5432', PGUSER='postgres',
                      PGPASSWORD='synthetic-postgres-ci-only',
                      PGDATABASE='cafe_auth_service_test', PGPASSFILE='/dev/null',
                      PGCONNECT_TIMEOUT='3', PGAPPNAME='cafe-auth-acceptance',
                      PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=3000 '
                                '-c idle_in_transaction_session_timeout=10000')


def b64(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode()


def admin_token():
    now = int(time.time())
    header = b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())
    claims = b64(json.dumps({'role': 'service_role', 'aud': 'authenticated',
                            'iss': 'cafe-isolated-ci', 'iat': now - 5,
                            'exp': now + 3600}).encode())
    unsigned = f'{header}.{claims}'
    return f'{unsigned}.{b64(hmac.new(JWT_SECRET, unsigned.encode(), hashlib.sha256).digest())}'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Auth acceptance does not follow redirects.')


def http(method, path, body=None, *, admin=False, token=None):
    if not re.fullmatch(r'/(?:health|signup|user|token\?grant_type=(?:password|refresh_token)|admin/users(?:/[0-9a-f-]{36})?)', path):
        raise ValueError('Only explicit local Auth acceptance endpoints are permitted.')
    if AUTH_URL is None:
        raise RuntimeError('Auth endpoint has not been verified against the disposable Docker project.')
    headers = {'Content-Type': 'application/json'}
    if admin or token:
        headers['Authorization'] = 'Bearer ' + (admin_token() if admin else token)
    req = urllib.request.Request(AUTH_URL + path, method=method, headers=headers,
                                 data=None if body is None else json.dumps(body).encode())
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(req, timeout=8) as response:
            return response.status, json.loads(response.read() or b'{}')
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b'{}')


def ok(result):
    status, data = result
    if status != 200:
        # Do not dump service responses, even from disposable synthetic accounts.
        raise AssertionError(f'Expected Auth HTTP 200, got {status}.')
    return data


def api_failure(result, *, expected_code):
    # The default API version exposes an FK violation as HTTP 500/code 23503.
    # Lock timeout is not a public Postgres error and remains unexpected_failure.
    # Require each scenario's exact code, not any error or either code everywhere.
    allowed = ('23503', 'unexpected_failure')
    if expected_code not in allowed:
        raise ValueError('Unsupported expected Auth failure code.')
    status, data = result
    code = data.get('error_code', data.get('code')) if isinstance(data, dict) else None
    safe_code = code if code in allowed else 'other_or_missing'
    safe_status = status if type(status) is int and 100 <= status <= 599 else 'invalid'
    assert status == 500 and code == expected_code, (
        f'Expected Auth HTTP 500 {expected_code}; got HTTP {safe_status} {safe_code}.')


def delete_user(uid, *, soft=False):
    return http('DELETE', f'/admin/users/{uuid.UUID(uid)}',
                {'should_soft_delete': soft}, admin=True)


def new_user():
    email = f'cafe-{uuid.uuid4()}@example.invalid'
    created = ok(http('POST', '/admin/users',
                      {'email': email, 'password': PASSWORD, 'email_confirm': True}, admin=True))
    uid = str(uuid.UUID(created['id']))
    session = ok(http('POST', '/token?grant_type=password', {'email': email, 'password': PASSWORD}))
    assert session['user']['id'] == uid and session.get('refresh_token')
    assert sql(f'SELECT email={literal(email)} FROM public.profiles WHERE id={literal(uid)}::uuid;') == 't'
    assert int(sql(f'SELECT count(*) FROM auth.sessions WHERE user_id={literal(uid)}::uuid;')) >= 1
    assert int(sql(f'SELECT count(*) FROM auth.identities WHERE user_id={literal(uid)}::uuid;')) >= 1
    return uid, session


def seed_conversation():
    uid, session = new_user()
    cid = str(uuid.uuid4())
    sql(f"INSERT INTO public.host_conversations(id,user_id,host_agent,surface) "
        f"VALUES({literal(cid)}::uuid,{literal(uid)}::uuid,'ginger','web-chat'); "
        f"INSERT INTO public.host_messages(conversation_id,role,content) "
        f"VALUES({literal(cid)}::uuid,'user','synthetic previous message'); "
        f"INSERT INTO public.orders(id,user_id) VALUES({literal(uid)}::uuid,{literal(uid)}::uuid); "
        f"INSERT INTO public.room_state(id,updated_by) VALUES({literal(uid)}::uuid,{literal(uid)}::uuid);")
    return uid, cid, session


def admit_sql(uid, rid, cid):
    return (f'SELECT public.concierge_admit_v1({literal(uid)}::uuid,NULL,{literal(rid)}::uuid,'
            f"{literal(db.payload(rid, cid))}::jsonb,'explorer');")


def complete_sql(a):
    return (f"SELECT public.concierge_complete_v1({literal(a['requester'])},"
            f"{literal(a['request_id'])}::uuid,{literal(a['owner_token'])}::uuid,"
            "'hello','synthetic reply without a provider',true);")


def dispatch(a):
    result = json.loads(as_role(
        f"SELECT public.concierge_dispatch_v1({literal(a['requester'])},"
        f"{literal(a['request_id'])}::uuid,{literal(a['owner_token'])}::uuid);", 'service_role'))
    assert result.get('dispatch_granted') is True


class Session:
    """Bounded interactive psql connection; no sockets/processes at import time."""
    def __init__(self):
        self.process = subprocess.Popen(
            ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.pending = b''

    def send(self, statement):
        self.process.stdin.write((statement + '\n').encode())
        self.process.stdin.flush()

    def query(self, statement, timeout=8):
        marker = 'fixture-' + uuid.uuid4().hex
        self.send(statement + f" SELECT '{marker}';")
        deadline, lines = time.monotonic() + timeout, []
        with selectors.DefaultSelector() as selector:
            selector.register(self.process.stdout, selectors.EVENT_READ)
            while time.monotonic() < deadline:
                while b'\n' in self.pending:
                    line, self.pending = self.pending.split(b'\n', 1)
                    text = line.decode().strip()
                    if text == marker:
                        return lines
                    if text:
                        lines.append(text)
                if not selector.select(max(0, deadline - time.monotonic())):
                    break
                chunk = os.read(self.process.stdout.fileno(), 65536)
                if not chunk:
                    raise RuntimeError('psql session failed: ' + self.process.stderr.read().decode())
                self.pending += chunk
        raise TimeoutError('Timed out awaiting the psql fixture barrier.')

    def close(self):
        if self.process.poll() is None:
            try:
                self.send('ROLLBACK;')
                self.process.stdin.close()
                self.process.wait(timeout=3)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                self.process.kill()
                self.process.wait(timeout=3)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            if not stream.closed:
                stream.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def waits():
    # Identify the actual Auth database connection, not merely a scheduled HTTP
    # future or a SQL replacement. The non-Auth contender connects as postgres
    # and SET LOCAL ROLE service_role inside its own transaction.
    return json.loads(sql("SELECT coalesce(json_agg(json_build_object('pid',a.pid,'role',a.usename,"
                          "'query',a.query)), '[]'::json) FROM pg_locks l "
                          "JOIN pg_stat_activity a ON a.pid=l.pid "
                          "WHERE l.locktype='advisory' AND l.classid=1128351301 AND l.objid=1 "
                          "AND l.objsubid=2 AND NOT l.granted;"))


def wait_for(count, *, auth=False, deadline=None):
    deadline = deadline or time.monotonic() + 1.4
    while time.monotonic() < deadline:
        rows = waits()
        auth_rows = [row for row in rows if row['role'] == 'supabase_auth_admin']
        if len(rows) >= count and (not auth or len(auth_rows) == 1):
            if auth:
                assert re.search(r'\bdelete\s+from\s+(?:"?auth"?\.)?"?users"?',
                                 auth_rows[0]['query'], re.I), auth_rows
            return rows
        time.sleep(.01)
    raise AssertionError('Expected real advisory-lock wait was not observed; no race pass claimed.')


def race_with_delete(uid, operation, *, delete_first):
    """Queue both real operations, in both chosen orders, before release."""
    with Session() as barrier, concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        barrier.query('BEGIN; SELECT pg_advisory_xact_lock(1128351301,1);')
        deadline = time.monotonic() + 1.4
        calls = [lambda: delete_user(uid), operation] if delete_first else [operation, lambda: delete_user(uid)]
        futures = []
        try:
            futures.append(pool.submit(calls[0]))
            wait_for(1, auth=delete_first, deadline=deadline)
            futures.append(pool.submit(calls[1]))
            wait_for(2, auth=True, deadline=deadline)
        finally:
            barrier.query('COMMIT;')
        results = [future.result(timeout=8) for future in futures]
    return (results[1], results[0]) if delete_first else (results[0], results[1])


def writer_then_delete(uid, statement, *, role='service_role', tail=''):
    """Hold only a real writer's own locks while actual HTTP DELETE waits."""
    with Session() as writer, concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        lines = writer.query(f'BEGIN; SET LOCAL ROLE {role}; {statement}')
        deletion = pool.submit(lambda: delete_user(uid))
        try:
            wait_for(1, auth=True)
            writer.query(tail + ' COMMIT;')
        finally:
            # Release before waiting for the future, including on an assertion.
            if writer.process.poll() is None:
                writer.query('ROLLBACK;')
        result = deletion.result(timeout=8)
    return lines, result


def deletion_audits(uid):
    return sql("SELECT count(*) FROM auth.audit_log_entries "
               f"WHERE payload->>'action'='user_deleted' AND payload->'traits'->>'user_id'={literal(uid)};")


def snapshot(uid, cid):
    # Compare complete synthetic rows before/after failure, including sessions,
    # refresh tokens and the audit log. Nothing sensitive is printed or persisted.
    queries = {
        'user': f'auth.users WHERE id={literal(uid)}::uuid',
        'identities': f'auth.identities WHERE user_id={literal(uid)}::uuid',
        'sessions': f'auth.sessions WHERE user_id={literal(uid)}::uuid',
        'refresh': f'auth.refresh_tokens WHERE user_id={literal(uid)}',
        'profile': f'public.profiles WHERE id={literal(uid)}::uuid',
        'conversation': f'public.host_conversations WHERE id={literal(cid)}::uuid',
        'messages': f'public.host_messages WHERE conversation_id={literal(cid)}::uuid',
        'orders': f'public.orders WHERE id={literal(uid)}::uuid',
        'room_state': f'public.room_state WHERE id={literal(uid)}::uuid',
        'ledger': f"concierge_private.requests WHERE requester={literal('u:' + uid)}",
    }
    result = {key: sql('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'
                       f"'[]'::jsonb) FROM (SELECT * FROM {query}) t;") for key, query in queries.items()}
    result['deletion_audit'] = deletion_audits(uid)
    return result


def removed(uid, cid, session):
    for table, condition in (
        ('auth.users', f'id={literal(uid)}::uuid'),
        ('auth.identities', f'user_id={literal(uid)}::uuid'),
        ('auth.sessions', f'user_id={literal(uid)}::uuid'),
        ('auth.refresh_tokens', f'user_id={literal(uid)}'),
        ('public.profiles', f'id={literal(uid)}::uuid'),
        ('public.host_conversations', f'id={literal(cid)}::uuid'),
        ('public.host_conversations', f'user_id={literal(uid)}::uuid'),
        ('public.host_messages', f'conversation_id={literal(cid)}::uuid'),
    ):
        assert sql(f'SELECT count(*) FROM {table} WHERE {condition};') == '0', table
    assert sql(f'SELECT user_id IS NULL FROM public.orders WHERE id={literal(uid)}::uuid;') == 't'
    assert sql(f'SELECT updated_by IS NULL FROM public.room_state WHERE id={literal(uid)}::uuid;') == 't'
    assert sql("SELECT count(*) FROM concierge_private.requests "
               f"WHERE requester={literal('u:' + uid)} AND (NOT redacted OR payload IS NOT NULL "
               'OR response IS NOT NULL OR fingerprint IS NOT NULL OR provider_receipt IS NOT NULL '
               'OR conversation_id IS NOT NULL);') == '0'
    assert int(deletion_audits(uid)) >= 1
    assert http('GET', f'/admin/users/{uid}', admin=True)[0] == 404
    status, _ = http('POST', '/token?grant_type=refresh_token', {'refresh_token': session['refresh_token']})
    assert status in (400, 401, 403), f'Deleted account still refreshes: {status}'


def while_locked(call):
    # One short barrier per actual HTTP operation. Check the holder still owns
    # the transaction lock afterward; API success alone is insufficient evidence.
    with Session() as holder:
        holder.query('BEGIN; SELECT pg_advisory_xact_lock(1128351301,1);')
        result = call()
        owned = holder.query("SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() "
                             "AND locktype='advisory' AND classid=1128351301 AND objid=1 "
                             "AND objsubid=2 AND granted;")
        assert owned == ['1'], 'Normal Auth operation completed without an intact test barrier.'
        holder.query('COMMIT;')
        return result


def lifecycle_without_lock():
    # An accidental global-lock dependency produces the installed two-second
    # timeout, not a pass after releasing the barrier.
    email = f'signup-{uuid.uuid4()}@example.invalid'
    signup = ok(while_locked(lambda: http('POST', '/signup', {'email': email, 'password': PASSWORD})))
    uid = signup['user']['id']
    assert signup.get('access_token') and signup.get('refresh_token')
    signed_in = ok(while_locked(lambda: http('POST', '/token?grant_type=password',
                                            {'email': email, 'password': PASSWORD})))
    refreshed = ok(while_locked(lambda: http('POST', '/token?grant_type=refresh_token',
                                            {'refresh_token': signed_in['refresh_token']})))
    assert refreshed['user']['id'] == uid
    updated = ok(while_locked(lambda: http('PUT', '/user', {'data': {'display_name': 'Synthetic member'}},
                                          token=refreshed['access_token'])))
    assert updated['user_metadata']['display_name'] == 'Synthetic member'
    assert sql(f'SELECT email={literal(email)} FROM public.profiles WHERE id={literal(uid)}::uuid;') == 't'
    ok(while_locked(lambda: delete_user(uid, soft=True)))
    assert sql(f'SELECT deleted_at IS NOT NULL FROM auth.users WHERE id={literal(uid)}::uuid;') == 't'
    assert sql(f'SELECT count(*) FROM auth.sessions WHERE user_id={literal(uid)}::uuid;') == '0'
    assert sql(f'SELECT count(*) FROM public.profiles WHERE id={literal(uid)}::uuid;') == '1'
    ok(delete_user(uid))
    print('PASS actual signup/password sign-in/refresh/metadata/soft-delete API paths bypass the global lock')


def admission_and_completion_races():
    for delete_first in (False, True):
        for explicit in (False, True):
            uid, cid, session = seed_conversation()
            if not explicit:
                # Prevent implicit reuse of the seeded conversation. This case
                # must reach the actual new-conversation INSERT if admission wins.
                as_role(f'UPDATE public.host_conversations SET ended_at=clock_timestamp() '
                        f'WHERE id={literal(cid)}::uuid;', 'service_role')
            rid = db.request_id()
            operation = lambda: db.captured(lambda: db.member_admit(uid, rid, cid if explicit else None))
            result, deletion = race_with_delete(uid, operation, delete_first=delete_first)
            ok(deletion)
            if delete_first:
                if explicit:
                    assert result['ok'].get('error') == 'conversation_unavailable'
                else:
                    assert '23503' in result.get('error', ''), result
                assert sql(f'SELECT count(*) FROM concierge_private.requests WHERE request_id={literal(rid)}::uuid;') == '0'
            else:
                assert result['ok'].get('admitted') is True, result
                if not explicit:
                    assert result['ok']['conversation_id'] != cid
                assert sql(f'SELECT redacted AND charged FROM concierge_private.requests WHERE request_id={literal(rid)}::uuid;') == 't'
                db.finish(result['ok'])
            removed(uid, cid, session)
    print('PASS actual Auth DELETE versus explicit/new-conversation admission in both lock orders')

    for delete_first in (False, True):
        uid, cid, session = seed_conversation()
        a = db.member_admit(uid, db.request_id(), cid)
        assert a.get('admitted') is True
        dispatch(a)
        result, deletion = race_with_delete(uid, lambda: json.loads(as_role(complete_sql(a), 'service_role')),
                                            delete_first=delete_first)
        ok(deletion)
        assert (result.get('error') == 'gone') if delete_first else (result.get('state') == 'completed'), result
        assert sql(f"SELECT redacted AND charged FROM concierge_private.requests WHERE request_id={literal(a['request_id'])}::uuid;") == 't'
        removed(uid, cid, session)
        db.finish(a, 'provider_terminal_failure')
    print('PASS actual Auth DELETE versus dispatched completion in both lock orders; no retained content or refund')


def before_tuple_lock():
    uid, cid, session = seed_conversation()
    rid, marker = db.request_id(), str(uuid.uuid4())
    lines, deletion = writer_then_delete(
        uid, admit_sql(uid, rid, cid),
        tail=f'INSERT INTO public.orders(id,user_id) VALUES({literal(marker)}::uuid,{literal(uid)}::uuid);')
    assert json.loads(lines[0]).get('admitted') is True
    ok(deletion)
    assert sql(f'SELECT user_id IS NULL FROM public.orders WHERE id={literal(marker)}::uuid;') == 't'
    assert sql(f'SELECT redacted AND charged FROM concierge_private.requests WHERE request_id={literal(rid)}::uuid;') == 't'
    removed(uid, cid, session)
    db.finish(json.loads(lines[0]))
    print('PASS actual Auth DELETE waits before the auth tuple; real admission plus Auth FK insert commits')


def rollback_and_timeout():
    uid, cid, session = seed_conversation()
    a = db.member_admit(uid, db.request_id(), cid)
    dispatch(a)
    assert json.loads(as_role(complete_sql(a), 'service_role')).get('state') == 'completed'
    blocker = str(uuid.uuid4())
    sql(f'INSERT INTO public.cs_episode_script_approvals(id,approved_by) VALUES({literal(blocker)}::uuid,{literal(uid)}::uuid);')
    before = snapshot(uid, cid)
    api_failure(delete_user(uid), expected_code='23503')
    assert snapshot(uid, cid) == before, 'FK-blocked HTTP deletion did not roll back every observed row/audit'
    ok(http('GET', f'/admin/users/{uid}', admin=True))
    # Removing only the synthetic public blocker lets the same actual API finish.
    sql(f'DELETE FROM public.cs_episode_script_approvals WHERE id={literal(blocker)}::uuid;')
    ok(delete_user(uid))
    removed(uid, cid, session)
    print('PASS actual Auth FK-blocked HTTP deletion rolls back audit, Auth, public cascades and completed ledger')

    uid, cid, session = seed_conversation()
    a = db.member_admit(uid, db.request_id(), cid)
    before = snapshot(uid, cid)
    with Session() as holder, concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        holder.query('BEGIN; SELECT pg_advisory_xact_lock(1128351301,1);')
        future = pool.submit(lambda: delete_user(uid))
        try:
            wait_for(1, auth=True)
            api_failure(future.result(timeout=6), expected_code='unexpected_failure')
            assert snapshot(uid, cid) == before, 'Timed-out HTTP deletion changed durable state/audit'
        finally:
            holder.query('COMMIT;')
    ok(delete_user(uid))
    removed(uid, cid, session)
    db.finish(a)
    print('PASS actual Auth lock-timeout HTTP failure is atomic and retry succeeds after release')


def commerce_and_lounge():
    # Every first transaction below executes the existing production RPC body
    # plus only its installed candidate lock. No helper lock is added.
    for self_artist in (False, True):
        uid, cid, session = seed_conversation()
        seller = uid if self_artist else new_user()[0]
        sql(f'INSERT INTO public.artists(id,user_id) VALUES({literal(seller)}::uuid,{literal(seller)}::uuid); '
            f'INSERT INTO public.products(id,artist_id,stock_count) VALUES({literal(seller)}::uuid,{literal(seller)}::uuid,2);')
        receipt = json.dumps(dict(session_id='synthetic-gallery-' + str(uuid.uuid4()), payment_status='paid',
                                 user_id=uid, email='fixture@example.invalid', subtotal_cents=1200,
                                 total_cents=1200, currency='usd', application_fee_cents=120))
        statement = (f'SELECT public.cs_record_gallery_payment({literal(receipt)}::jsonb,'
                     f'{literal(seller)}::uuid,{literal(seller)}::uuid,1);')
        lines, deletion = writer_then_delete(uid, statement)
        order = json.loads(lines[0])
        assert order.get('created') is True
        assert sql(f'SELECT stock_count FROM public.products WHERE id={literal(seller)}::uuid;') == '1'
        replay = json.loads(as_role(statement, 'service_role'))
        assert replay == {'id': order['id'], 'created': False}, replay
        assert sql(f'SELECT stock_count FROM public.products WHERE id={literal(seller)}::uuid;') == '1'
        if self_artist:
            api_failure(deletion, expected_code='23503')
            assert deletion_audits(uid) == '0'
            assert sql(f'SELECT count(*) FROM auth.sessions WHERE user_id={literal(uid)}::uuid;') == '1'
            sql(f"DELETE FROM public.order_items WHERE order_id={literal(order['id'])}::uuid;")
            ok(delete_user(uid))
        else:
            ok(deletion)
            assert sql(f"SELECT user_id IS NULL FROM public.orders WHERE id={literal(order['id'])}::uuid;") == 't'
        removed(uid, cid, session)
    print('PASS actual gallery RPC versus Auth HTTP deletion: buyer SET NULL, artist RESTRICT and idempotency')

    for paid in (False, True):
        uid, cid, session = seed_conversation()
        sql(f'INSERT INTO public.events(id,ticket_price_cents) VALUES({literal(uid)}::uuid,{500 if paid else 0});')
        statement = f'SELECT public.cs_reserve_ticket({literal(uid)}::uuid,{literal(uid)}::uuid);'
        lines, deletion = writer_then_delete(uid, statement)
        hold = json.loads(lines[0])
        if paid:
            assert hold.get('reservation_id')
            api_failure(deletion, expected_code='23503')
            assert deletion_audits(uid) == '0'
            receipt = json.dumps(dict(site='cafe-sativa', payment_status='paid', currency='usd', user_id=uid,
                                     event_id=uid, amount_cents=500, session_id='synthetic-ticket-' + uid,
                                     payment_intent_id='synthetic-intent-' + uid))
            pay = f"SELECT public.cs_record_ticket_payment({literal(hold['reservation_id'])}::uuid,{literal(receipt)}::jsonb);"
            lines, deletion = writer_then_delete(uid, pay)
            ticket = json.loads(lines[0])
            assert ticket.get('created') is True and ticket.get('state') == 'fulfilled'
            api_failure(deletion, expected_code='23503')
            assert deletion_audits(uid) == '0'
            replay = json.loads(as_role(pay, 'service_role'))
            assert replay.get('created') is False and replay.get('ticket_id') == ticket['ticket_id']
            sql(f'DELETE FROM public.cs_ticket_reservations WHERE user_id={literal(uid)}::uuid;')
            ok(delete_user(uid))
        else:
            assert hold.get('granted') is True and hold.get('ticket_id')
            ok(deletion)
        removed(uid, cid, session)
    print('PASS actual ticket reservation/payment RPCs versus Auth HTTP deletion: cascade, NO ACTION and idempotency')

    for moderator in (False, True):
        uid, cid, session = seed_conversation()
        author = new_user()[0] if moderator else uid
        mid = str(uuid.uuid4())
        sql(f'INSERT INTO public.lounge_rooms(id) VALUES({literal(mid)}::uuid); '
            f'SET request.jwt.claim.sub={literal(author)}; '
            f'INSERT INTO public.lounge_messages(id,room_id,user_id) VALUES({literal(mid)}::uuid,{literal(mid)}::uuid,{literal(author)}::uuid);')
        statement = f'SET LOCAL request.jwt.claim.sub={literal(uid)}; SELECT public.soft_delete_lounge_message({literal(mid)}::uuid);'
        if moderator:
            denied = db.captured(lambda: as_role(statement, 'authenticated'))
            assert '42501' in denied.get('error', ''), denied
            assert sql(f'SELECT deleted_at IS NULL FROM public.lounge_messages WHERE id={literal(mid)}::uuid;') == 't'
            sql(f'UPDATE public.profiles SET is_staff=true WHERE id={literal(uid)}::uuid;')
        lines, deletion = writer_then_delete(uid, statement, role='authenticated')
        assert lines[-1] == mid
        if moderator:
            api_failure(deletion, expected_code='23503')
            assert deletion_audits(uid) == '0'
            assert sql(f'SELECT deleted_by={literal(uid)}::uuid FROM public.lounge_messages WHERE id={literal(mid)}::uuid;') == 't'
            sql(f'DELETE FROM public.lounge_messages WHERE id={literal(mid)}::uuid;')
            ok(delete_user(uid))
        else:
            ok(deletion)
        removed(uid, cid, session)
    print('PASS actual authenticated Lounge RPC versus Auth HTTP deletion: author cascade, moderator blocker, nonowner denial')


def bootstrap():
    assert sql('SELECT current_database();') == 'cafe_auth_service_test'
    assert sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();") == 'cafe-disposable-auth-service-v1'
    assert sql('SELECT current_user;') == 'postgres'
    assert sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public';") == '0'
    assert sql('SELECT count(*) FROM auth.users;') == '0'
    assert int(sql('SELECT count(*) FROM auth.schema_migrations;')) > 20
    assert sql("SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='auth.users'::regclass;") == 'supabase_auth_admin'
    assert sql("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='supabase_auth_admin';") == 'f'
    for path in (HERE / 'public-bootstrap.sql', ROOT / 'tests/db/commerce_bootstrap.sql',
                 ROOT / 'tests/db/commerce_functions.sql', MIGRATION):
        sql(path.read_text())
    assert sql("SELECT has_schema_privilege('supabase_auth_admin','concierge_private','USAGE') "
               "OR has_table_privilege('supabase_auth_admin','public.profiles','INSERT') "
               "OR has_function_privilege('supabase_auth_admin','concierge_private.lock_v1()','EXECUTE') "
               "OR has_function_privilege('supabase_auth_admin','public.concierge_auth_statement_v1()','EXECUTE');") == 'f'
    assert sql("SELECT has_table_privilege('service_role','auth.users','DELETE');") == 'f'
    # Explicit synthetic ceiling, never a production/default capacity decision.
    db.configure(max_retained_requests=10000)


def main():
    configure_environment()
    deadline = time.monotonic() + 90
    while True:
        try:
            health = ok(http('GET', '/health'))
            break
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(.5)
    assert health.get('version') == AUTH_VERSION, 'Auth health version differs from the pinned acceptance target.'
    bootstrap()
    print('Service acceptance identity: ' + json.dumps({
        'auth_version': health['version'], 'postgres': sql('SHOW server_version;'),
        'candidate_sha256': hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),
        'auth_migration_count': int(sql('SELECT count(*) FROM auth.schema_migrations;')),
        'auth_migration_latest': sql('SELECT max(version) FROM auth.schema_migrations;'),
        'auth_migrations_sha256': hashlib.sha256(sql('SELECT version FROM auth.schema_migrations ORDER BY version;').encode()).hexdigest(),
    }, sort_keys=True))
    lifecycle_without_lock()
    admission_and_completion_races()
    before_tuple_lock()
    rollback_and_timeout()
    commerce_and_lounge()
    print('PASS isolated official GoTrue v2.197.0 Auth HTTP acceptance; hosted Supabase parity is not claimed')


if __name__ == '__main__':
    main()
