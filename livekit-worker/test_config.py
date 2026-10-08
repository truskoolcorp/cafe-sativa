"""Pure configuration tests for the isolated worker scaffold."""
import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

# Unit tests run only after dependencies are installed.
spec = importlib.util.spec_from_file_location("cafe_livekit_agent", Path(__file__).with_name("agent.py"))
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class VoiceConfigTests(unittest.TestCase):
    def test_namespaced_room_and_host(self):
        self.assertEqual(agent.host_for_room("cafe-sativa-ginger-" + "a" * 32), "ginger")
        for bad in ("anya-owner-room", "cafe-sativa-ginger-1", "cafe-sativa-unknown-" + "a" * 32):
            with self.assertRaises(ValueError):
                agent.host_for_room(bad)

    def test_voice_id_fail_closed(self):
        with patch.dict(os.environ, {"ELEVENLABS_VOICE_GINGER": ""}):
            with self.assertRaises(RuntimeError):
                agent.voice_id_for("ginger")
        with patch.dict(os.environ, {"ELEVENLABS_VOICE_GINGER": "canonical-ginger"}):
            self.assertEqual(agent.voice_id_for("ginger"), "canonical-ginger")

    def test_integration_gate_defaults_closed(self):
        variables = {k: "test" for k in (
            "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
            "DEEPGRAM_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY",
            "ELEVENLABS_VOICE_LAVICHE", "ELEVENLABS_VOICE_GINGER", "ELEVENLABS_VOICE_AHNIKA"
        )}
        with patch.dict(os.environ, variables):
            with patch.dict(os.environ, {"CAFE_SATIVA_VOICE_INTEGRATION_READY": "0"}):
                with self.assertRaisesRegex(RuntimeError, "Integration gate closed"):
                    agent.validate_configuration()


if __name__ == "__main__":
    unittest.main()
