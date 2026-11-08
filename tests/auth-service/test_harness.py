"""Offline tests only: no database, subprocess service, socket or Auth request."""
import ast
import base64
import hashlib
import hmac
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import unittest
from unittest.mock import patch
import urllib.error

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('cafe_auth_acceptance', HERE / 'run.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def decode(part):
    return base64.urlsafe_b64decode(part + '=' * (-len(part) % 4))


class HarnessTests(unittest.TestCase):
    def test_runtime_requires_explicit_hosted_ci(self):
        for env in ({}, {'CAFE_DISPOSABLE_AUTH': '1'},
                    {'CAFE_DISPOSABLE_AUTH': '1', 'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'self-hosted'}):
            with self.subTest(env=env), patch.dict(os.environ, env, clear=True):
                with self.assertRaises(SystemExit):
                    runner.configure_environment()

    def test_libpq_environment_is_replaced_not_inherited(self):
        with patch.dict(os.environ, {
            'CAFE_DISPOSABLE_AUTH': '1', 'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
            'PGHOST': 'live.invalid', 'PGHOSTADDR': '192.0.2.1', 'PGSERVICE': 'live',
            'PGSERVICEFILE': '/tmp/untrusted.conf', 'PGPASSWORD': 'not-a-real-password',
        }, clear=True):
            runner.configure_environment()
            self.assertEqual(os.environ['PGHOST'], '127.0.0.1')
            self.assertEqual(os.environ['PGPORT'], '55432')
            self.assertEqual(os.environ['PGDATABASE'], 'cafe_auth_service_test')
            self.assertEqual(os.environ['PGPASSWORD'], 'synthetic-postgres-ci-only')
            self.assertEqual(os.environ['PGPASSFILE'], '/dev/null')
            self.assertNotIn('PGHOSTADDR', os.environ)
            self.assertNotIn('PGSERVICE', os.environ)
            self.assertNotIn('PGSERVICEFILE', os.environ)

    def test_locally_generated_admin_token_uses_only_synthetic_secret(self):
        with patch.object(runner.time, 'time', return_value=1800000000):
            token = runner.admin_token()
        header, body, signature = token.split('.')
        self.assertEqual(json.loads(decode(header)), {'alg': 'HS256', 'typ': 'JWT'})
        claims = json.loads(decode(body))
        self.assertEqual(claims['role'], 'service_role')
        self.assertEqual(claims['exp'], 1800003600)
        self.assertEqual(claims['iat'], 1799999995)
        self.assertEqual(decode(signature), hmac.new(runner.JWT_SECRET, f'{header}.{body}'.encode(), hashlib.sha256).digest())

    def test_unapproved_urls_paths_are_rejected_before_io(self):
        for path in ('https://live.invalid/admin/users', '//live.invalid', '/invite', '/recover',
                     '/admin/users/not-a-uuid', '/health#other', '/health?redirect=https://live.invalid'):
            with self.subTest(path=path), patch.object(runner.urllib.request, 'build_opener') as build:
                with self.assertRaises(ValueError):
                    runner.http('GET', path)
                build.assert_not_called()

    def test_http_has_fixed_local_origin_and_no_proxy(self):
        with patch.object(runner.urllib.request, 'build_opener') as build:
            response = build.return_value.open.return_value.__enter__.return_value
            response.status = 200
            response.read.return_value = b'{"version":"v2.197.0"}'
            self.assertEqual(runner.http('GET', '/health'), (200, {'version': 'v2.197.0'}))
            request = build.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, 'http://127.0.0.1:59999/health')
            self.assertEqual(build.call_args.args[0].proxies, {})
            self.assertIsInstance(build.call_args.args[1], runner.NoRedirect)
            self.assertEqual(build.return_value.open.call_args.kwargs['timeout'], 8)

    def test_redirect_is_rejected(self):
        with self.assertRaises(RuntimeError):
            runner.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://live.invalid')

    def test_delete_is_the_actual_admin_http_endpoint(self):
        uid = '11111111-1111-4111-8111-111111111111'
        with patch.object(runner, 'http', return_value=(200, {})) as http:
            runner.delete_user(uid)
            http.assert_called_once_with('DELETE', '/admin/users/' + uid, {'should_soft_delete': False}, admin=True)
        with patch.object(runner, 'http') as http:
            runner.delete_user(uid, soft=True)
            http.assert_called_once_with('DELETE', '/admin/users/' + uid, {'should_soft_delete': True}, admin=True)

    def test_failed_http_response_is_not_dumped(self):
        sensitive = {'access_token': 'do-not-print', 'password': 'do-not-print', 'code': 'unexpected_failure'}
        with self.assertRaises(AssertionError) as failure:
            runner.ok((400, sensitive))
        self.assertNotIn('do-not-print', str(failure.exception))
        with self.assertRaises(AssertionError) as failure:
            runner.api_failure((200, sensitive))
        self.assertNotIn('do-not-print', str(failure.exception))
        runner.api_failure((500, {'code': 'unexpected_failure'}))
        runner.api_failure((500, {'code': 500, 'error_code': 'unexpected_failure'}))

    def test_http_error_preserves_status_for_assertion_only(self):
        error = urllib.error.HTTPError(runner.AUTH_URL, 500, 'error', {}, io.BytesIO(b'{"error_code":"unexpected_failure"}'))
        with patch.object(runner.urllib.request, 'build_opener') as build:
            build.return_value.open.side_effect = error
            self.assertEqual(runner.http('GET', '/health'), (500, {'error_code': 'unexpected_failure'}))

    def test_wait_requires_auth_backend_and_real_delete(self):
        with patch.object(runner, 'waits', return_value=[{'pid': 42, 'role': 'supabase_auth_admin', 'query': 'DELETE FROM "users" WHERE id = $1'}]):
            self.assertEqual(len(runner.wait_for(1, auth=True)), 1)
        with patch.object(runner, 'waits', return_value=[{'pid': 42, 'role': 'supabase_auth_admin', 'query': 'SELECT 1'}]):
            with self.assertRaises(AssertionError):
                runner.wait_for(1, auth=True)
        with patch.object(runner, 'waits', return_value=[{'pid': 42, 'role': 'postgres', 'query': 'DELETE FROM "users"'}]):
            with self.assertRaises(AssertionError):
                runner.wait_for(1, auth=True, deadline=runner.time.monotonic() + .02)

    def test_normal_auth_path_requires_barrier_to_still_be_owned(self):
        for lock_count in ('0', '1'):
            with self.subTest(lock_count=lock_count), patch.object(runner, 'Session') as session:
                holder = session.return_value.__enter__.return_value
                holder.query.side_effect = [[], [lock_count], []]
                if lock_count == '0':
                    with self.assertRaises(AssertionError):
                        runner.while_locked(lambda: (200, {}))
                else:
                    self.assertEqual(runner.while_locked(lambda: (200, {})), (200, {}))
                    self.assertEqual(holder.query.call_args.args[0], 'COMMIT;')

    def test_public_fixture_never_reconstructs_auth_schema_or_rows(self):
        fixture = (HERE / 'public-bootstrap.sql').read_text()
        self.assertNotRegex(fixture, r'(?i)(?:CREATE|ALTER|DROP)\s+TABLE\s+auth\.')
        self.assertNotRegex(fixture, r'(?i)(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+auth\.')
        self.assertNotRegex(fixture, r'(?i)CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+auth\.')
        self.assertNotIn('test_fixture.seed_account', fixture)
        self.assertIn('email text,display_name text', fixture)
        exact_hook = ('begin\n  insert into public.profiles (id, email)\n'
                      '  values (new.id, new.email)\n  on conflict (id) do nothing;\n  return new;\nend;')
        self.assertIn(exact_hook, fixture)
        self.assertIn('CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users', fixture)
        self.assertIn('REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated;', fixture)

    def test_runner_has_no_direct_auth_dml_or_sql_seed_fallback(self):
        source = (HERE / 'run.py').read_text()
        self.assertNotRegex(source, r'(?i)(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+auth\.')
        self.assertNotIn('db.auth_delete', source)
        self.assertNotIn('db.seed_auth_conversation', source)
        self.assertNotIn('db.main(', source)
        self.assertNotIn("tests/db/bootstrap.sql'", source)
        ast.parse(source)

    def test_compose_is_pinned_internal_and_synthetic(self):
        compose = (HERE / 'compose.yml').read_text()
        self.assertIn('image: supabase/gotrue:v2.197.0', compose)
        self.assertIn('image: postgres:17.6', compose)
        self.assertIn('internal: true', compose)
        self.assertIn("'127.0.0.1:55432:5432'", compose)
        self.assertIn("'127.0.0.1:59999:9999'", compose)
        self.assertIn("GOTRUE_SMTP_PORT: '1'", compose)
        self.assertIn("GOTRUE_MAILER_AUTOCONFIRM: 'true'", compose)
        self.assertNotIn('${', compose)
        self.assertNotIn('env_file:', compose)
        self.assertNotIn('network_mode:', compose)
        self.assertIn('tmpfs:', compose)

    def test_shell_checks_hosted_ci_before_any_runtime_and_scopes_cleanup(self):
        shell = (HERE / 'run-ci.sh').read_text()
        self.assertLess(shell.index('GITHUB_ACTIONS'), shell.index('compose=('))
        self.assertIn('${RUNNER_ENVIRONMENT:-} != github-hosted', shell)
        self.assertIn('project="cafe-auth-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"', shell)
        self.assertIn('--project-name "$project"', shell)
        self.assertIn('--env-file /dev/null', shell)
        self.assertNotRegex(shell, r'compose\[@\].*logs')
        self.assertNotIn('docker system prune', shell)
        self.assertIn('"${compose[@]}" down --volumes --remove-orphans', shell)


if __name__ == '__main__':
    unittest.main()
