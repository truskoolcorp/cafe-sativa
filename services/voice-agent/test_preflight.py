import unittest
from preflight import REQUIRED, missing_configuration

class PreflightTests(unittest.TestCase):
    def test_missing_and_invalid_config(self):
        self.assertIn('DEEPGRAM_API_KEY', missing_configuration({}))
        env = {key: 'secret-test-value' for key in REQUIRED}
        env.update(LIVEKIT_URL='wss://example.invalid', CS_LIVEKIT_AGENT_NAME='cafe-sativa-hosts')
        self.assertEqual(missing_configuration(env), [])
        env['LIVEKIT_URL'] = 'https://example.invalid'
        self.assertTrue(missing_configuration(env))
        env['LIVEKIT_URL'] = 'wss://user:password@example.invalid'
        self.assertTrue(missing_configuration(env))
        self.assertNotIn('secret-test-value', str(missing_configuration(env)))
        env['CS_LIVEKIT_AGENT_NAME'] = 'anya'
        self.assertTrue(any('dedicated' in name for name in missing_configuration(env)))

if __name__ == '__main__':
    unittest.main()
