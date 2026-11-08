"""Offline assertions only: no database, provider, process or network calls."""
import importlib.util
from pathlib import Path
import unittest
from unittest import mock
import io
from types import SimpleNamespace

SPEC = importlib.util.spec_from_file_location('durable_db_harness', Path(__file__).with_name('run.py'))
HARNESS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HARNESS)


class LoungeModeratorDenialTests(unittest.TestCase):
    def test_accepts_rpc_snapshot_denial(self):
        HARNESS.assert_lounge_moderator_denied({
            'error': 'ERROR:  42501: Message unavailable or not owned\nCONTEXT:  PL/pgSQL function soft_delete_lounge_message(uuid) at RAISE'})

    def test_accepts_row_guard_snapshot_denial(self):
        HARNESS.assert_lounge_moderator_denied({
            'error': 'ERROR:  42501: Message ownership required\nCONTEXT:  PL/pgSQL function guard_lounge_message_write() at RAISE'})

    def test_rejects_other_failures_and_context_matches(self):
        for error in (
            'ERROR:  40P01: deadlock detected\nCONTEXT:  42501: Message ownership required',
            'ERROR:  55P03: canceling statement due to lock timeout',
            'ERROR:  57014: canceling statement due to statement timeout',
            'ERROR:  23503: foreign key constraint failed',
            'ERROR:  42501: permission denied for schema concierge_private',
            'ERROR:  42501: Only soft deletion is permitted',
            'ERROR:  40P01: Message ownership required',
            'ERROR:  42501: Message ownership required unexpectedly',
            'CONTEXT:  42501: Message ownership required',
            'ERROR:  42501: Message ownership required\nERROR:  55P03: lock timeout',
            '',
        ):
            with self.subTest(error=error), self.assertRaises(AssertionError):
                HARNESS.assert_lounge_moderator_denied({'error': error})

    def test_rejects_success_in_denial_branch(self):
        with self.assertRaises(AssertionError):
            HARNESS.assert_lounge_moderator_denied({'ok': 'unexpected success'})


COMBINED_SPEC = importlib.util.spec_from_file_location('combined_races', Path(__file__).with_name('combined_races.py'))
COMBINED = importlib.util.module_from_spec(COMBINED_SPEC)
COMBINED_SPEC.loader.exec_module(COMBINED)


class CombinedFixtureTests(unittest.TestCase):
    def test_explicit_test_cap_and_override(self):
        with mock.patch.object(HARNESS, 'sql') as execute:
            HARNESS.configure()
            self.assertIn('max_retained_requests=10000', execute.call_args.args[0])
            HARNESS.configure(max_retained_requests=7)
            self.assertIn('max_retained_requests=7,', execute.call_args.args[0])

    def test_direct_insert_uses_only_old_columns(self):
        statement = COMBINED.terminal_insert(HARNESS, ['one', 'two'], old=True)
        self.assertNotIn('cleanup_scan_id', statement)
        self.assertNotIn('OVERRIDING', statement)
        self.assertNotIn('GRANT', statement)
        self.assertNotIn('DELETE', statement)
        self.assertEqual(statement.count("'cancelled'"), 2)
        self.assertIn("interval '4 days'", statement)

    def test_error_classification_cannot_accept_context_or_multiple_errors(self):
        COMBINED.assert_sqlstate({'error': 'ERROR:  PCB02: retained ceiling'}, 'PCB02')
        COMBINED.assert_sqlstate({'error': 'ERROR:  55P03: lock timeout'}, '55P03')
        for result in ({'ok': ''}, {'error': 'CONTEXT: PCB02: retained ceiling'},
                       {'error': 'ERROR:  40P01: deadlock detected\nCONTEXT: PCB02'},
                       {'error': 'ERROR:  PCB02: ceiling\nERROR:  55P03: timeout'}):
            with self.subTest(result=result), self.assertRaises(AssertionError):
                COMBINED.assert_sqlstate(result, 'PCB02')

    def test_checked_maintenance_timeout_injection_and_wiring(self):
        command = Path(__file__).with_name('cleanup_checked_command.sql').read_text()
        injected = COMBINED.checked_command_with_timeout(command)
        self.assertEqual(injected.replace('PERFORM pg_catalog.pg_sleep(6);\n', ''), command)
        self.assertIn("statement_timeout = '5s'", command)
        self.assertIn('maintain_v1(100)', command)
        self.assertIn('maintenance_timeout_recovery(db)', Path(COMBINED.__file__).read_text())
        with self.assertRaises(AssertionError):
            COMBINED.checked_command_with_timeout(command+command)

    def test_checked_maintenance_timeout_rollback_then_success(self):
        execute = mock.Mock(side_effect=['before', RuntimeError('ERROR:  57014: canceling statement due to statement timeout'), 'before', '', 'after'])
        db = SimpleNamespace(sql=execute, captured=HARNESS.captured)
        with mock.patch('builtins.print'):
            COMBINED.maintenance_timeout_recovery(db)
        calls = [call.args[0] for call in execute.call_args_list]
        self.assertEqual(calls[0], calls[2])
        self.assertEqual(calls[0], calls[4])
        self.assertIn('md5(row_to_json(r)::text)', calls[0])
        self.assertIn('pg_sleep(6)', calls[1])
        self.assertNotIn('pg_sleep', calls[3])
        self.assertEqual(calls[3], Path(__file__).with_name('cleanup_checked_command.sql').read_text())

    def test_changed_timeout_fingerprint_prevents_success_claim(self):
        execute = mock.Mock(side_effect=['before', RuntimeError('ERROR:  57014: statement timeout'), 'changed'])
        db = SimpleNamespace(sql=execute, captured=HARNESS.captured)
        with self.assertRaisesRegex(AssertionError, 'changed lifecycle or ledger'):
            COMBINED.maintenance_timeout_recovery(db)
        self.assertEqual(execute.call_count, 3)

    def holder_fixture(self):
        class Pipe(io.BytesIO):
            def close(self):
                pass  # Retain test bytes for assertions after fixture cleanup.
            def fileno(self):
                return 123
        class Process:
            def __init__(self):
                self.stdin, self.stdout, self.stderr = Pipe(), Pipe(), Pipe()
                self.returncode = None
            def poll(self):
                return self.returncode
            def wait(self, timeout):
                self.returncode = 0
            def kill(self):
                self.returncode = -9
        process = Process()
        selector = mock.MagicMock()
        selector.__enter__.return_value = selector
        selector.select.return_value = [True]
        return process, selector

    def test_real_holder_observed_wait_and_rollback(self):
        process, selector = self.holder_fixture()
        db = SimpleNamespace(sql=mock.Mock(return_value='1'))
        with mock.patch.object(COMBINED.subprocess, 'Popen', return_value=process), \
             mock.patch.object(COMBINED.selectors, 'DefaultSelector', return_value=selector), \
             mock.patch.object(COMBINED.os, 'read', return_value=b'holder:42\n'):
            lines, results = COMBINED.hold_then(db, 'INSERT fixture;', [lambda: {'ok': True}], rollback=True)
        self.assertEqual(results, [{'ok': True}])
        self.assertIn('h.pid=42', db.sql.call_args.args[0])
        self.assertIn('NOT w.granted', db.sql.call_args.args[0])
        sent = process.stdin.getvalue().decode()
        self.assertIn('idle_in_transaction_session_timeout', sent)
        self.assertIn('SET LOCAL ROLE service_role', sent)
        self.assertNotIn('pg_advisory_xact_lock', sent)
        self.assertTrue(sent.endswith('ROLLBACK;\n'))

    def test_missing_wait_fails_and_releases_holder(self):
        process, selector = self.holder_fixture()
        db = SimpleNamespace(sql=mock.Mock(return_value='0'))
        # Clock advances beyond the observation window without any DB call.
        with mock.patch.object(COMBINED.subprocess, 'Popen', return_value=process), \
             mock.patch.object(COMBINED.selectors, 'DefaultSelector', return_value=selector), \
             mock.patch.object(COMBINED.os, 'read', return_value=b'holder:42\n'), \
             mock.patch.object(COMBINED.time, 'monotonic', side_effect=[0, 0, 0, 2]), \
             self.assertRaisesRegex(AssertionError, 'every contender'):
            COMBINED.hold_then(db, 'INSERT fixture;', [lambda: {'ok': True}])
        self.assertTrue(process.stdin.getvalue().endswith(b'COMMIT;\n'))


if __name__ == '__main__':
    unittest.main()
