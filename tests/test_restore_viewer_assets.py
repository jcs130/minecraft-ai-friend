"""Isolated restore safety tests; no Git, network, services, or live asset writes."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "restore_viewer_assets", Path(__file__).resolve().parents[1] / "tools/restore_viewer_assets.py")
restore = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(restore)


class RestoreViewerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.output = self.root / "runtime/isolated-viewer"
        self.payloads = {name: ("fixture:" + name).encode() for name in restore.ASSETS}
        self.manifest = {"schema": 1, "files": [
            {"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
            for name, raw in self.payloads.items()]}
        self.reads = []

    def reader(self, root, name):
        self.assertEqual(root, self.root)
        self.reads.append(name)
        return self.payloads[name]

    def prepare(self):
        return restore.prepare(self.root, self.output, self.manifest, self.reader)

    def test_check_validates_all_22_without_creating_output(self):
        _, _, result = self.prepare()
        self.assertEqual(len(restore.ASSETS), 22)
        self.assertEqual(self.reads, list(restore.ASSETS))
        self.assertEqual(result["missing"], list(restore.ASSETS))
        self.assertEqual(result["changed"], [])
        self.assertFalse(self.output.exists())

    def test_restore_exact_bytes_and_repeat_preserves_files(self):
        args = self.prepare()
        result = restore.restore(*args)
        self.assertTrue(result["ok"])
        before = {}
        for name, raw in self.payloads.items():
            path = self.output / name
            self.assertEqual(path.read_bytes(), raw)
            before[name] = path.stat().st_mtime_ns
        repeated = restore.restore(*self.prepare())
        self.assertTrue(repeated["ok"])
        self.assertEqual(repeated["restored"], [])
        self.assertEqual(repeated["unchangedCount"], 22)
        self.assertEqual(before, {name: (self.output / name).stat().st_mtime_ns for name in before})

    def test_late_changed_file_refuses_every_missing_write(self):
        last = self.output / restore.ASSETS[-1]
        last.parent.mkdir(parents=True)
        last.write_bytes(b"later local patch")
        result = restore.restore(*self.prepare())
        self.assertFalse(result["ok"])
        self.assertEqual(result["changed"], [restore.ASSETS[-1]])
        self.assertEqual(result["restored"], [])
        self.assertEqual([p for p in self.output.rglob("*") if p.is_file()], [last])
        self.assertEqual(last.read_bytes(), b"later local patch")

    def test_last_source_hash_mismatch_is_detected_before_any_write(self):
        self.manifest["files"][-1]["sha256"] = "0" * 64
        with self.assertRaisesRegex(restore.RestoreError, "SHA256 or size mismatch"):
            self.prepare()
        self.assertEqual(len(self.reads), 22)
        self.assertFalse(self.output.exists())

    def test_unknown_duplicate_and_missing_paths_rejected_before_git(self):
        valid = list(self.manifest["files"])
        for rows in [valid + [valid[0]], valid[:-1],
                     valid + [{"path": "../escape", "bytes": 1, "sha256": "0" * 64}]]:
            with self.subTest(paths=len(rows)):
                self.manifest["files"] = rows
                with self.assertRaises(restore.RestoreError):
                    self.prepare()
                self.assertEqual(self.reads, [])

    def test_generated_mod_assets_are_not_read_or_restored(self):
        for name in restore.EXCLUDED_GENERATED:
            self.manifest["files"].append({"path": name, "bytes": 1, "sha256": "0" * 64})
        result = restore.restore(*self.prepare())
        self.assertTrue(result["ok"])
        self.assertEqual(len(self.reads), 22)
        self.assertFalse((self.output / "mod-assets").exists())

    def test_output_boundaries_and_linked_paths_rejected(self):
        for value in ["../outside", "server/mc", ".git/test", "world/src", "runtime"]:
            with self.subTest(output=value):
                with self.assertRaises(restore.RestoreError):
                    restore.output_path(self.root, value)
        self.assertEqual(restore.output_path(self.root, "vendor/modern-viewer"),
                         self.root / "vendor/modern-viewer")
        with patch.object(Path, "is_symlink", return_value=True):
            with self.assertRaisesRegex(restore.RestoreError, "Linked output"):
                self.prepare()

    def test_file_appearing_after_preflight_is_never_overwritten(self):
        destination, payloads, report = self.prepare()
        first = destination / restore.ASSETS[0]
        first.parent.mkdir(parents=True)
        first.write_bytes(b"created by another process")
        with self.assertRaisesRegex(restore.RestoreError, "changed after preflight"):
            restore.restore(destination, payloads, report)
        self.assertEqual(first.read_bytes(), b"created by another process")
        self.assertEqual(report["restored"], [])

    def test_git_source_ref_and_prefix_are_fixed(self):
        class Result:
            returncode = 0
            stdout = b"blob"
        with patch.object(restore.subprocess, "run", return_value=Result()) as run:
            self.assertEqual(restore.git_blob(self.root, "viewer.css"), b"blob")
            command = run.call_args.args[0]
            self.assertEqual(command[-1], restore.COMMIT + ":packaging/docker/modern-viewer/viewer.css")
            with self.assertRaises(restore.RestoreError):
                restore.git_blob(self.root, "../../config")
            self.assertEqual(run.call_count, 1)

    def test_default_cli_only_checks_and_does_not_create_assets(self):
        manifest = self.root / restore.MANIFEST
        manifest.parent.mkdir(parents=True)
        manifest.write_text(json.dumps(self.manifest), encoding="utf8")
        def fake_git(*args, **kwargs):
            class Result:
                returncode = 0
            result = Result()
            name = args[0][-1].split(":" + restore.PREFIX, 1)[1]
            result.stdout = self.payloads[name]
            return result
        text = io.StringIO()
        with patch.object(restore, "ROOT", self.root), \
                patch.object(restore.subprocess, "run", side_effect=fake_git), \
                contextlib.redirect_stdout(text):
            code = restore.main(["--output", "runtime/isolated-viewer"])
        result = json.loads(text.getvalue())
        self.assertEqual(code, 1)
        self.assertEqual(result["mode"], "check")
        self.assertTrue(result["sourceValidated"])
        self.assertFalse(result["ok"])
        self.assertEqual(len(result["missing"]), 22)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
