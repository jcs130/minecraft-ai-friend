"""Source restoration tests; no Docker, model imports, downloads or playback."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

from tools import build_tts_runtime as builder


class TtsBuildTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="qd-tts-build-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "old-source"
        for name in builder.REQUIRED_FILES:
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture " + name, encoding="utf-8")
        digest = hashlib.sha256((self.source / "indextts/infer_v2_5.py").read_bytes()).hexdigest()
        self.patch = patch.object(builder, "INFER_SHA256", digest)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.project = self.root / "project"
        (self.project / "world/tts").mkdir(parents=True)
        (self.project / "world/tts/tts_api.py").write_text("# fixture API\n", encoding="utf-8")
        (self.project / "world/tts/Dockerfile").write_text("FROM fixture\n", encoding="utf-8")

    def test_stages_source_resources_but_never_models_voices_environment_or_secrets(self):
        for name in ("checkpoints/gpt.pth", "voices/goddess.wav", ".git/config", ".env",
                     "indextts/.venv/private.py", "indextts/cache.pt", "indextts/__pycache__/module.pyc"):
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("must not enter image", encoding="utf-8")
        resource = self.source / "indextts/vocab.json"
        resource.write_text('{"source": true}', encoding="utf-8")
        context, manifest = builder.stage(self.source, project=self.project)
        files = {row["path"] for row in manifest["files"]}
        self.assertEqual(files, set(builder.REQUIRED_FILES) | {"indextts/vocab.json"})
        self.assertFalse(manifest["weightsIncluded"])
        self.assertTrue((context / "source/checkpoints/pinyin.vocab").is_file())
        self.assertEqual((context / "tts_api.py").read_bytes(), (self.project / "world/tts/tts_api.py").read_bytes())
        self.assertTrue(resource.is_file())

    def test_changed_inference_is_rejected_before_creating_a_context(self):
        (self.source / "indextts/infer_v2_5.py").write_text("different revision", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "audited revision"):
            builder.stage(self.source, project=self.project)
        self.assertFalse((self.project / "runtime").exists())

    def test_missing_pinyin_does_not_silently_produce_broken_image(self):
        (self.source / "checkpoints/pinyin.vocab").unlink()
        with self.assertRaises(ValueError):
            builder.stage(self.source, project=self.project)

    def test_build_records_real_image_identity_without_starting_anything(self):
        context, _ = builder.stage(self.source, project=self.project)
        commands = []
        def run(command, **kwargs):
            commands.append(command)
            return types.SimpleNamespace(stdout=json.dumps({"Id": "sha256:" + "a" * 64, "Size": 100, "Created": "fixture"}))
        result = builder.build(context, runner=run)
        self.assertEqual(result["imageId"], "sha256:" + "a" * 64)
        self.assertEqual(result["status"], "built_not_started")
        self.assertFalse(result["serviceStarted"])
        self.assertEqual([command[1:3] for command in commands], [["build", "--progress=plain"], ["image", "inspect"]])

    def test_failed_build_never_claims_previous_tag_is_a_success(self):
        context, _ = builder.stage(self.source, project=self.project)
        def fail(command, **kwargs):
            raise subprocess.CalledProcessError(1, command)
        with self.assertRaises(subprocess.CalledProcessError):
            builder.build(context, runner=fail)
        receipt = json.loads((context / "build-result.json").read_text(encoding="utf-8"))
        self.assertEqual(receipt["status"], "build_failed")
        self.assertNotIn("imageId", receipt)

    def test_credentials_and_old_digest_cannot_become_build_options(self):
        for image, base, index in (("sha256:" + "a" * 64, "python:3.11", "https://pypi.org/simple"),
                                   (builder.IMAGE, "python:3.11", "https://user:password@example.com/simple"),
                                   (builder.IMAGE, "python:3.11", "https://example.com/simple?token=private")):
            with self.assertRaises(ValueError):
                builder.validate_build_options(image, base, index)

    def successful_build(self):
        context, _ = builder.stage(self.source, project=self.project)
        def run(command, **kwargs):
            return types.SimpleNamespace(stdout=json.dumps({"Id": "sha256:" + "a" * 64}))
        builder.build(context, runner=run)
        return context

    def test_publish_preserves_ownership_manifest_and_records_new_image_schema(self):
        context = self.successful_build()
        data = self.project / "server/tts-state"
        data.mkdir(parents=True)
        old = data / "source-manifest.json"
        old.write_text('{"historicalImage": "original"}', encoding="utf-8")
        def run(command, **kwargs):
            return types.SimpleNamespace(stdout="sha256:" + "a" * 64 + "\n")
        path = builder.publish_runtime_image(context, project=self.project, runner=run)
        actual = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(actual["schema"], 1)
        self.assertEqual(actual["image"], {"id": "sha256:" + "a" * 64, "tag": builder.IMAGE})
        self.assertEqual(actual["inferSha256"], builder.INFER_SHA256)
        self.assertEqual(old.read_text(encoding="utf-8"), '{"historicalImage": "original"}')
        builder.publish_runtime_image(context, project=self.project, runner=run)
        self.assertEqual(len(list(context.glob("previous-runtime-image-*.json"))), 1)

    def test_publish_rejects_retagged_image_before_touching_runtime_state(self):
        context = self.successful_build()
        def run(command, **kwargs):
            return types.SimpleNamespace(stdout="sha256:" + "b" * 64)
        with self.assertRaisesRegex(ValueError, "no longer"):
            builder.publish_runtime_image(context, project=self.project, runner=run)
        self.assertFalse((self.project / "server").exists())


if __name__ == "__main__":
    unittest.main()
