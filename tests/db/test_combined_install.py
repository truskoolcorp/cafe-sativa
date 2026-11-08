"""Offline structure checks for the modeled whole-install verification fixture."""
import importlib.util
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location('combined_install_checks',HERE/'combined_install_checks.py')
CHECKS=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKS)
CANDIDATE=(HERE.parent.parent/'supabase/migrations/20261108090000_durable_concierge_admission.sql').read_text()

class CombinedInstallModelTests(unittest.TestCase):
    def test_all_variants_are_entire_atomic_installations(self):
        variants=list(CHECKS.variants(CANDIDATE))
        self.assertEqual(len(variants),22)
        self.assertEqual(len({name for name,_,_ in variants}),22)
        for name,altered,_ in variants:
            with self.subTest(case=name):
                self.assertIn('BEGIN;',altered)
                self.assertTrue(altered.endswith('COMMIT;\n'))
                self.assertIn('CREATE SCHEMA concierge_private;',altered)
                self.assertIn('CREATE TABLE concierge_private.requests',altered)
                self.assertIn('CREATE OR REPLACE FUNCTION public.cs_record_gallery_payment',altered)
                self.assertNotIn('SET ROLE postgres',altered)
                self.assertNotIn('CREATE ROLE',altered)
                self.assertNotIn('ALTER DEFAULT PRIVILEGES',altered)

    def test_pristine_fixture_repeats_exact_final_checks(self):
        fixture=(HERE/'combined_install.sql').read_text()
        for tag in ('combined_first_install','postconditions','private_acl_postflight','new_public_acl_postflight'):
            start,end='DO $'+tag+'$','END $'+tag+'$;'
            block=lambda text: start+text.split(start,1)[1].split(end,1)[0]+end
            self.assertEqual(block(CANDIDATE),block(fixture),tag)

    def test_public_faults_do_not_modify_actual_privileges(self):
        for name,altered,_ in CHECKS.variants(CANDIDATE):
            if name.startswith('public-'):
                self.assertEqual(altered.count('GRANT '),CANDIDATE.count('GRANT '))
                self.assertEqual(altered.count('REVOKE '),CANDIDATE.count('REVOKE '))
                self.assertEqual(altered.count('CREATE FUNCTION'),CANDIDATE.count('CREATE FUNCTION'))
                self.assertIn('UNION ALL SELECT',altered)

    def test_verify_requires_exact_rejection_and_unchanged_fingerprint(self):
        cases={altered:message for _,altered,message in CHECKS.variants(CANDIDATE)}
        def sql(statement):
            if statement in cases:
                raise RuntimeError('ERROR: 55000: '+cases[statement])
            return 'fingerprint' if 'AS fingerprint;' in statement else 't'
        CHECKS.verify(sql,CANDIDATE)

    def test_verify_does_not_accept_unexpected_success(self):
        def sql(statement):
            return 'fingerprint' if 'AS fingerprint;' in statement else 't'
        with self.assertRaisesRegex(AssertionError,'unexpectedly accepted'):
            CHECKS.verify(sql,CANDIDATE)

if __name__=='__main__':unittest.main()
