"""Preparation changes only fixture files, never the deployed runtime tree."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "tools" / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


runtime = load("prepare_tts_runtime")
packs = load("prepare_voice_packs")


class TtsPreparationTests(unittest.TestCase):
    def setUp(self):
        # D drive is part of the production preparer's explicit boundary.
        self.temporary = tempfile.TemporaryDirectory(prefix="qd-tts-test-", dir=ROOT / "runtime")
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_site_url_only_preserves_all_other_fields_and_exact_backup(self):
        path = self.root / "server/mc/config/touhou_little_maid/sites/tts.json"
        path.parent.mkdir(parents=True)
        original = {"gpt-sovits": {"api_type": "gpt-sovits", "url": "http://old/tts",
            "enabled": True, "secret_key": "fixture-only", "ref_audio_path": "/voices/maid.wav",
            "prompt_text": "fixture reference", "models": [{"id": "voice"}]},
            "other": {"enabled": False, "extra": 42}}
        before = json.dumps(original, indent=3).encode()
        path.write_bytes(before)
        result = packs.prepare_maid_tts(self.root)
        actual = json.loads(path.read_bytes())
        self.assertEqual(actual, packs.maid_tts_config(original))
        actual["gpt-sovits"]["url"] = original["gpt-sovits"]["url"]
        self.assertEqual(actual, original)
        self.assertEqual((self.root / result["backup"]).read_bytes(), before)
        self.assertFalse(packs.prepare_maid_tts(self.root)["changed"])
        self.assertEqual(len(list((self.root / "server/tts-state/backups").iterdir())), 1)

    def test_missing_site_is_not_fabricated(self):
        with self.assertRaises(ValueError):
            packs.maid_tts_config({"other": {}})

    def api_fixture(self):
        target = self.root / "server/tts-state"
        (target / "app").mkdir(parents=True)
        api_path = target / "app/tts_api.py"
        api_path.write_bytes(b"# previous API\n")
        digest = hashlib.sha256(api_path.read_bytes()).hexdigest()
        manifest = {"producer": "prepare_tts_runtime.py", "files": [
            {"path": "app/tts_api.py", "sha256": digest, "bytes": api_path.stat().st_size}],
            "workers": [{"path": "/app/tts_api.py", "sha256": digest}], "privateFixture": "preserved"}
        (target / "source-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        source = self.root / "world/tts/tts_api.py"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"# reviewed project API\nVALUE = 2\n")
        (target / "untouched.fixture").write_bytes(b"model/voice/compose stand-in")
        return target, source

    def test_api_sync_backups_and_updates_only_api_manifest_then_is_idempotent(self):
        target, source = self.api_fixture()
        previous_manifest = (target / "source-manifest.json").read_bytes()
        with patch.multiple(runtime, PROJECT=self.root, TARGET=target, API_SOURCE=source):
            result = runtime.sync_api()
            self.assertTrue(result["restartRequired"])
            self.assertEqual((target / "app/tts_api.py").read_bytes(), source.read_bytes())
            self.assertEqual((target / result["backup"] / "tts_api.py").read_bytes(), b"# previous API\n")
            self.assertEqual((target / result["backup"] / "source-manifest.json").read_bytes(), previous_manifest)
            self.assertEqual(json.loads((target / "source-manifest.json").read_bytes())["privateFixture"], "preserved")
            self.assertEqual((target / "untouched.fixture").read_bytes(), b"model/voice/compose stand-in")
            self.assertFalse(runtime.sync_api()["changed"])

    def test_api_sync_refuses_unknown_runtime_edits(self):
        target, source = self.api_fixture()
        (target / "app/tts_api.py").write_bytes(b"unowned edits")
        with patch.multiple(runtime, PROJECT=self.root, TARGET=target, API_SOURCE=source):
            with self.assertRaises(ValueError):
                runtime.sync_api()
        self.assertEqual((target / "app/tts_api.py").read_bytes(), b"unowned edits")

    def test_manifest_failure_rolls_back_api(self):
        target, source = self.api_fixture()
        previous_manifest = (target / "source-manifest.json").read_bytes()
        with patch.multiple(runtime, PROJECT=self.root, TARGET=target, API_SOURCE=source), \
             patch.object(runtime, "write_owned_json", side_effect=OSError("fixture failure")):
            with self.assertRaises(OSError):
                runtime.sync_api()
        self.assertEqual((target / "app/tts_api.py").read_bytes(), b"# previous API\n")
        self.assertEqual((target / "source-manifest.json").read_bytes(), previous_manifest)


if __name__ == "__main__":
    unittest.main()
