"""Exercise model staging against fixture bytes, never the production cache."""
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tools import prepare_kokoro_runtime as kokoro


class KokoroPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="qd-kokoro-stage-")
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.target = self.root / "target"
        self.assets = {}
        for name in kokoro.ASSETS:
            data = ("fixture:" + name).encode()
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            self.assets[name] = (len(data), hashlib.sha256(data).hexdigest())
        self.patched = patch.object(kokoro, "ASSETS", self.assets)
        self.patched.start()

    def tearDown(self):
        self.patched.stop()
        self.temp.cleanup()

    def test_copy_verified_assets_manifest_and_idempotence(self):
        first = kokoro.stage(self.source, self.target)
        before = (self.target / "source-manifest.json").read_bytes()
        self.assertEqual(first, kokoro.stage(self.source, self.target))
        self.assertEqual(before, (self.target / "source-manifest.json").read_bytes())
        self.assertEqual(first["revision"], kokoro.REVISION)
        self.assertFalse(first["switched"])
        for name in self.assets:
            self.assertEqual((self.source / name).read_bytes(), (self.target / "model" / name).read_bytes())

    def test_bad_source_hash_fails_before_creating_target(self):
        (self.source / "voices/zm_010.pt").write_bytes(b"bad source")
        with self.assertRaisesRegex(ValueError, "pinned revision"):
            kokoro.stage(self.source, self.target)
        self.assertFalse(self.target.exists())

    def test_different_existing_destination_is_preserved(self):
        destination = self.target / "model/config.json"
        destination.parent.mkdir(parents=True)
        destination.write_bytes(b"preexisting data")
        with self.assertRaises(ValueError):
            kokoro.stage(self.source, self.target)
        self.assertEqual(destination.read_bytes(), b"preexisting data")
        self.assertFalse((self.target / "model/kokoro-v1_1-zh.pth").exists())

    def test_hf_source_symlink_is_dereferenced(self):
        source = self.source / "config.json"
        data = source.read_bytes()
        blob = self.root / "blob"
        blob.write_bytes(data)
        source.unlink()
        try:
            source.symlink_to(blob)
        except OSError:
            self.skipTest("Symlink creation is unavailable")
        result = kokoro.stage(self.source, self.target)
        self.assertFalse((self.target / "model/config.json").is_symlink())
        self.assertEqual((self.target / "model/config.json").read_bytes(), data)
        self.assertEqual(result["files"][0]["resolvedSource"], str(blob.resolve()))

    def test_unowned_manifest_is_preserved(self):
        self.target.mkdir()
        manifest = self.target / "source-manifest.json"
        manifest.write_text(json.dumps({"producer": "another-tool"}), encoding="utf-8")
        before = manifest.read_bytes()
        with self.assertRaisesRegex(ValueError, "different owner"):
            kokoro.stage(self.source, self.target)
        self.assertEqual(before, manifest.read_bytes())
        self.assertFalse((self.target / "model").exists())

    def image_fixture(self):
        target = self.root / "server/kokoro-state"
        kokoro.stage(self.source, target)
        code = self.root / "world/tts"
        code.mkdir(parents=True)
        for name in ("tts_api.py", "kokoro_engine.py"):
            (code / name).write_text("# fixture " + name, encoding="utf-8")
        return target, {name: kokoro.sha256(code / name) for name in ("tts_api.py", "kokoro_engine.py")}

    def test_image_record_requires_built_source_and_preserves_asset_manifest(self):
        target, hashes = self.image_fixture()
        asset_bytes = (target / "source-manifest.json").read_bytes()
        answers = iter((kokoro.BASE_IMAGE_ID, "sha256:" + "1" * 64, json.dumps(hashes)))
        calls = []
        def runner(command, **kwargs):
            calls.append(command)
            return SimpleNamespace(stdout=next(answers))
        record = kokoro.record_image(project=self.root, runner=runner)
        self.assertEqual(record["adapterSha256"], hashes["tts_api.py"])
        self.assertEqual(record["assetsManifestSha256"], hashlib.sha256(asset_bytes).hexdigest())
        self.assertEqual((target / "source-manifest.json").read_bytes(), asset_bytes)
        self.assertEqual(calls[-1][0:7], ["docker", "run", "--rm", "--network", "none", "--entrypoint", "python3"])
        self.assertFalse(record["serviceStarted"])

    def test_mismatched_built_source_does_not_publish_image(self):
        target, hashes = self.image_fixture()
        hashes["tts_api.py"] = "bad-built-source"
        answers = iter((kokoro.BASE_IMAGE_ID, "sha256:" + "1" * 64, json.dumps(hashes)))
        with self.assertRaisesRegex(ValueError, "does not match"):
            kokoro.record_image(project=self.root, runner=lambda *a, **k: SimpleNamespace(stdout=next(answers)))
        self.assertFalse((target / "runtime-image.json").exists())

    def test_changed_base_is_rejected_before_docker_build(self):
        calls = []
        def runner(command, **kwargs):
            calls.append(command)
            return SimpleNamespace(stdout="sha256:" + "2" * 64)
        with self.assertRaisesRegex(ValueError, "base tag differs"):
            kokoro.build(project=self.root, runner=runner)
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
