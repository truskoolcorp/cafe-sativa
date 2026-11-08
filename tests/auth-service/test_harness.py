"""Offline tests only: no database, subprocess service, socket or Auth request."""
import ast
import base64
import copy
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
    def setUp(self):
        # HTTP tests use a fake, known local origin and a mocked opener only.
        endpoint = patch.object(runner, 'AUTH_URL', 'http://127.0.0.1:59999')
        endpoint.start()
        self.addCleanup(endpoint.stop)

    def test_runtime_requires_explicit_hosted_ci(self):
        for env in ({}, {'CAFE_DISPOSABLE_AUTH': '1'},
                    {'CAFE_DISPOSABLE_AUTH': '1', 'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'self-hosted'}):
            with self.subTest(env=env), patch.dict(os.environ, env, clear=True):
                with self.assertRaises(SystemExit):
                    runner.configure_environment()

    def test_libpq_environment_is_replaced_not_inherited(self):
        with patch.dict(os.environ, {
            'CAFE_DISPOSABLE_AUTH': '1', 'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
            'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1',
            'PGHOST': 'live.invalid', 'PGHOSTADDR': '192.0.2.1', 'PGSERVICE': 'live',
            'PGSERVICEFILE': '/tmp/untrusted.conf', 'PGPASSWORD': 'not-a-real-password',
        }, clear=True), patch.object(runner.isolation, 'discover_endpoints',
                                    return_value={'db': '172.30.0.2', 'auth': '172.30.0.3'}):
            runner.configure_environment()
            self.assertEqual(os.environ['PGHOST'], '172.30.0.2')
            self.assertEqual(os.environ['PGPORT'], '5432')
            self.assertEqual(runner.AUTH_URL, 'http://172.30.0.3:9999')
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

    def test_http_refuses_an_unverified_origin(self):
        with patch.object(runner, 'AUTH_URL', None), patch.object(runner.urllib.request, 'build_opener') as build:
            with self.assertRaises(RuntimeError):
                runner.http('GET', '/health')
            build.assert_not_called()

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
            runner.api_failure((200, sensitive), expected_code='unexpected_failure')
        self.assertNotIn('do-not-print', str(failure.exception))
        for body in ({'code': 'do-not-print'}, {'error_code': 'do-not-print'}, sensitive, ['do-not-print']):
            with self.subTest(body_type=type(body).__name__), self.assertRaises(AssertionError) as failure:
                runner.api_failure((400, body), expected_code='23503')
            self.assertNotIn('do-not-print', str(failure.exception))

    def test_http_failure_requires_exact_scenario_code_and_status(self):
        for code in ('23503', 'unexpected_failure'):
            for body in ({'code': code}, {'code': 500, 'error_code': code}):
                runner.api_failure((500, body), expected_code=code)
                wrong = '23503' if code == 'unexpected_failure' else 'unexpected_failure'
                with self.assertRaises(AssertionError):
                    runner.api_failure((500, body), expected_code=wrong)
                for status in (200, 400, 401, 403, 404, 429, 503):
                    with self.assertRaises(AssertionError):
                        runner.api_failure((status, body), expected_code=code)
        for code in ('23505', '42501', '40P01', '55P03', None):
            with self.assertRaises(AssertionError):
                runner.api_failure((500, {'code': code}), expected_code='23503')
        with self.assertRaises(ValueError):
            runner.api_failure((500, {'code': '23505'}), expected_code='23505')

    def test_failure_sites_separate_fk_and_lock_timeout(self):
        tree = ast.parse((HERE / 'run.py').read_text())
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Name) and node.func.id == 'api_failure']
        codes = [next(keyword.value.value for keyword in call.keywords
                      if keyword.arg == 'expected_code') for call in calls]
        self.assertEqual(codes.count('23503'), 5)
        self.assertEqual(codes.count('unexpected_failure'), 1)
        timeout = next(call for call in calls if any(keyword.value.value == 'unexpected_failure'
                                                   for keyword in call.keywords))
        self.assertEqual(ast.unparse(timeout.args[0]), 'future.result(timeout=6)')

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
        self.assertNotIn('ports:', compose)
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


class IsolationTests(unittest.TestCase):
    def topology(self):
        project = 'cafe-auth-123-1'
        name = project + '_isolated'
        net_id = 'c' * 64
        containers = {}
        for i, service in enumerate(('db', 'auth'), 2):
            containers[service] = {
                'id': ('a' if service == 'auth' else 'b') * 64,
                'image': runner.isolation.IMAGES[service], 'project': project,
                'service': service, 'status': 'running', 'bindings': {},
                'networks': {name: {'NetworkID': net_id, 'IPAddress': f'172.30.0.{i}'}},
            }
        network = {'name': name, 'id': net_id, 'project': project, 'network': 'isolated',
                   'driver': 'bridge', 'internal': True, 'ipam': [{'Subnet': '172.30.0.0/16'}],
                   'containers': {data['id']: {'IPv4Address': data['networks'][name]['IPAddress'] + '/16'}
                                  for data in containers.values()}}
        return project, network, containers

    def test_accepts_only_owned_internal_topology(self):
        project, network, containers = self.topology()
        self.assertEqual(runner.isolation.validate_topology(project, network, containers),
                         {'db': '172.30.0.2', 'auth': '172.30.0.3'})

    def test_rejects_external_network_mixed_membership_or_unowned_services(self):
        project, original_net, original_containers = self.topology()
        mutations = (
            lambda n, c: n.update(internal=False),
            lambda n, c: n.update(project='different-project'),
            lambda n, c: n.update(driver='overlay'),
            lambda n, c: n['containers'].update({'d' * 64: {}}),
            lambda n, c: c['auth'].update(project='different-project'),
            lambda n, c: c['auth'].update(image='supabase/gotrue:latest'),
            lambda n, c: c['auth'].update(status='exited'),
            lambda n, c: c['auth'].update(bindings={'9999/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '59999'}]}),
            lambda n, c: c['auth']['networks'].update({'external': {}}),
            lambda n, c: c['auth']['networks'][project + '_isolated'].update(NetworkID='d' * 64),
            lambda n, c: n.update(ipam=[{'Subnet': '8.8.8.0/24'}]),
        )
        for mutation in mutations:
            network, containers = copy.deepcopy(original_net), copy.deepcopy(original_containers)
            mutation(network, containers)
            with self.assertRaises(RuntimeError):
                runner.isolation.validate_topology(project, network, containers)

    def test_rejects_guessed_public_loopback_and_mismatched_addresses(self):
        project, original_net, original_containers = self.topology()
        for address in ('8.8.8.8', '127.0.0.1', '169.254.169.254', '172.31.0.3',
                        '172.30.0.0', '172.30.255.255', '172.30.0.2', 'not-an-ip'):
            network, containers = copy.deepcopy(original_net), copy.deepcopy(original_containers)
            containers['auth']['networks'][project + '_isolated']['IPAddress'] = address
            with self.subTest(address=address), self.assertRaises((RuntimeError, ValueError)):
                runner.isolation.validate_topology(project, network, containers)
        network, containers = self.topology()[1:]
        network['containers']['a' * 64]['IPv4Address'] = '172.30.0.4/16'
        with self.assertRaises(RuntimeError):
            runner.isolation.validate_topology(project, network, containers)

    def test_startup_diagnostics_never_echo_untrusted_log_fields(self):
        raw = '\n'.join(json.dumps(entry) for entry in (
            {'msg': 'GoTrue migrations applied successfully', 'count': 123, 'password': 'do-not-print'},
            {'msg': 'GoTrue API started on: 0.0.0.0:9999', 'access_token': 'do-not-print'},
            {'msg': 'Failed to load configuration: do-not-print', 'level': 'fatal'},
            {'msg': 'error opening database: postgres://do-not-print', 'level': 'fatal'},
            {'msg': 'do-not-print running db migrations', 'level': 'fatal'},
            {'msg': 'do-not-print', 'level': 'error'},
            {'msg': 'GoTrue API started on: do-not-print', 'level': 'info'},
            {'msg': 'audit_event', 'access_token': 'do-not-print'},
        ))
        events = runner.isolation.startup_events(raw)
        self.assertEqual(len(events), 6)
        self.assertNotIn('do-not-print', json.dumps(events))
        self.assertEqual(events[0], {'event': 'auth_migrations_applied', 'count': 123})
        self.assertEqual(events[1], {'event': 'auth_api_listening', 'port': 9999})

    def test_docker_inspection_ignores_remote_daemon_environment(self):
        with patch.dict(os.environ, {'DOCKER_HOST': 'tcp://remote.invalid', 'DOCKER_CONTEXT': 'remote'}), \
                patch.object(runner.isolation.subprocess, 'run') as run:
            run.return_value.returncode = 0
            run.return_value.stdout = '{}'
            runner.isolation.docker('network', 'inspect', 'synthetic')
            self.assertEqual(run.call_args.args[0][:3], ['docker', '--context', 'default'])
            self.assertNotIn('DOCKER_HOST', run.call_args.kwargs['env'])
            self.assertNotIn('DOCKER_CONTEXT', run.call_args.kwargs['env'])

    def test_inspection_projection_does_not_request_secrets_or_raw_logs(self):
        self.assertNotIn('.Config.Env', runner.isolation.CONTAINER_FORMAT)
        self.assertNotIn('.State.Error', runner.isolation.CONTAINER_FORMAT)
        self.assertNotIn('.Health.Log', runner.isolation.CONTAINER_FORMAT)


if __name__ == '__main__':
    unittest.main()
