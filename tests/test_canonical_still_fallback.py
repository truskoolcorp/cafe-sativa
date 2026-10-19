import importlib.util
import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "still", Path(__file__).resolve().parents[1] / "tools/render_canonical_still_preview.py")
still = importlib.util.module_from_spec(spec)
spec.loader.exec_module(still)

class DeterministicFallbackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "approved.png"
        self.source.write_bytes(b"canonical-source-fixture")
        self.sha = hashlib.sha256(self.source.read_bytes()).hexdigest()
        self.output = self.root / "preview.mp4"

    def test_rejects_modified_canonical_bytes_without_provider_or_ffmpeg(self):
        with patch.object(still.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "differ"):
                still.render("stage", self.source, "a" * 64, self.output)
            run.assert_not_called()

    def test_rejects_unknown_room_and_overwrite(self):
        with self.assertRaises(ValueError):
            still.render("bar", self.source, self.sha, self.output)
        self.output.write_bytes(b"existing")
        with self.assertRaisesRegex(ValueError, "overwrite"):
            still.render("stage", self.source, self.sha, self.output)

    def test_calls_offline_still_filter_and_returns_unapproved_receipt(self):
        def fake_exec(argv, **_):
            self.assertIn("-loop", argv)
            self.assertIn("-an", argv)
            self.assertIn("libx264", argv)
            self.assertNotIn("-vf", argv[:argv.index("-i")])
            vf = argv[argv.index("-vf")+1]
            self.assertIn("force_original_aspect_ratio=decrease", vf)
            self.assertIn("pad=1280:720", vf)
            self.assertNotIn("crop=", vf)
            Path(argv[-1]).write_bytes(b"synthetic-mp4-fixture")
        with patch.object(still.subprocess, "run", side_effect=fake_exec):
            receipt = still.render("community", self.source, self.sha, self.output)
        self.assertFalse(receipt["publish_authorized"])
        self.assertEqual(receipt["status"], "qa_pending")
        self.assertEqual(receipt["source_sha256"], self.sha)
        self.assertEqual(self.source.read_bytes(), b"canonical-source-fixture")

if __name__ == "__main__":
    unittest.main()
