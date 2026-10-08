import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("maw_health", ROOT / "world/ops/health/health_mon.py")
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class NekoAdapterHealthTest(unittest.TestCase):
    def test_artifacts_healthy_then_tamper_is_detected_without_claiming_runtime(self):
        with tempfile.TemporaryDirectory(prefix="maw-neko-health-") as directory:
            root = Path(directory)
            files = []
            for index in range(13):
                filename = root / f"source-{index}.txt"
                filename.write_text("native adapter", encoding="utf-8")
                files.append({"path": str(filename), "sha256": hashlib.sha256(filename.read_bytes()).hexdigest()})
            manifest = root / "installation.json"
            manifest.write_text(json.dumps({"schemaVersion": 1, "files": files,
                "mcAgentNekoRevision": "23f5971203e3f4d15ef416ff8e5cc67965845d82",
                "projectNekoRevision": "fb2a2e731a8c954478d08678b0c8cf40e8145a54",
                "tool": "minecraft_mod", "operationCount": 48, "samePlayerConnection": True,
                "automaticReplay": False, "pluginMessageBroadcast": False}), encoding="utf-8")
            report = health.probe_neko_adapters(manifest)
            self.assertTrue(report["ok"])
            self.assertEqual(report["runtimeObservation"], "not_checked")
            self.assertFalse(report["autonomousPlayVerified"])
            Path(files[3]["path"]).write_text("edited", encoding="utf-8")
            self.assertFalse(health.probe_neko_adapters(manifest)["ok"])

    def test_missing_installation_does_not_pass(self):
        with tempfile.TemporaryDirectory(prefix="maw-neko-health-") as directory:
            self.assertFalse(health.probe_neko_adapters(Path(directory) / "missing.json")["ok"])


if __name__ == "__main__":
    unittest.main()
