import importlib.util
import json
from pathlib import Path
from subprocess import CompletedProcess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("qd_project_startup", ROOT / "tools/project.py")
project = importlib.util.module_from_spec(spec)
spec.loader.exec_module(project)


class ProjectStartupTests(unittest.TestCase):
    def test_default_includes_survivor_and_excludes_archived_operations(self):
        self.assertIn("survivor", project.DEFAULT_SERVICES)
        self.assertNotIn("qwenpaw-ops", project.DEFAULT_SERVICES)
        self.assertIn("inventory", project.DEFAULT_SERVICES)
        self.assertEqual(len(project.DEFAULT_SERVICES), 13)

    def test_missing_dependency_image_blocks_startup_before_data_creation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            config = {"services": {"mc": {"image": "missing-mc", "volumes": []},
                                   "world": {"image": "world", "depends_on": {"mc": {}}, "volumes": []}}}
            def inspect(args, **kwargs):
                return CompletedProcess(args, 1 if "missing-mc" in args else 0)
            with patch.object(project, "ROOT", root), patch.object(project, "docker", return_value=CompletedProcess([], 0, json.dumps(config))), \
                 patch.object(project.subprocess, "run", side_effect=inspect):
                with self.assertRaisesRegex(ValueError, "mc: image"):
                    project.preflight(["world"])
                self.assertEqual(list(root.iterdir()), [])

    def test_external_or_missing_bind_is_rejected_and_socket_is_allowed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            service = {"image": "world", "volumes": []}
            config = {"services": {"control": service}}
            with patch.object(project, "ROOT", root), patch.object(project, "docker", side_effect=lambda *a, **kw: CompletedProcess([], 0, json.dumps(config))), \
                 patch.object(project.subprocess, "run", return_value=CompletedProcess([], 0)):
                for source in (str(root / "missing"), str(root.parent)):
                    service["volumes"] = [{"type": "bind", "source": source, "target": "/data"}]
                    with self.assertRaisesRegex(ValueError, "bind"):
                        project.preflight(["control"])
                service["volumes"] = [{"type": "bind", "source": "/var/run/docker.sock", "target": "/var/run/docker.sock"}]
                self.assertEqual(project.preflight(["control"]), ["control"])

    def test_setup_never_replaces_an_existing_different_rcon_credential(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data = root / "server/world-data"
            data.mkdir(parents=True)
            (root / ".env").write_text("QIANDENG_RCON_PASSWORD=env-fixture\n", encoding="utf8")
            secret = data / "rcon-secret.txt"
            secret.write_text("original-fixture", encoding="utf8")
            with patch.object(project, "ROOT", root), self.assertRaisesRegex(ValueError, "differs"):
                project.setup()
            self.assertEqual(secret.read_text(), "original-fixture")


if __name__ == "__main__":
    unittest.main()
