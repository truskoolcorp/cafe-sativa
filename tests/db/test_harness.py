"""Offline assertions only: no database, provider, process or network calls."""
import importlib.util
from pathlib import Path
import unittest

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


if __name__ == '__main__':
    unittest.main()
