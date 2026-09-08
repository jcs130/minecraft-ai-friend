import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).with_name("prepare_smoke_state.py")
spec = importlib.util.spec_from_file_location("prepare_smoke_fixture", SOURCE)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class SmokeFixtureTest(unittest.TestCase):
    def test_reserved_fixtures_preserve_other_players_and_are_idempotent(self):
        with tempfile.TemporaryDirectory(prefix="qiandeng-prepare-test-") as td:
            project = Path(td)
            (project / "compose.yml").write_text("name: qiandengji\n", encoding="utf-8")
            original = {"mana": 31, "learned": ["example-existing-skill"], "custom": {"nested": [1, 2]}}
            files = [project / "server" / x / "magic-state.json" for x in ("world-data", "mcdata")]
            for path in files:
                path.parent.mkdir(parents=True)
                path.write_text(json.dumps({"version": 1, "players": {"ExistingFixture": original}}), encoding="utf-8")
            self.assertTrue(fixture.prepare_project(project)["ok"])
            for path in files:
                players = json.loads(path.read_text(encoding="utf-8"))["players"]
                self.assertEqual(players["ExistingFixture"], original)
                self.assertEqual(players["QDSmokeBody"]["learned"], ["feather_fall"])
                self.assertEqual(players["QDSmokeProbe"]["skillbar"], ["feather_fall"])
            before = [p.read_bytes() for p in files]
            fixture.prepare_project(project)
            self.assertEqual([p.read_bytes() for p in files], before)

    def test_name_collision_refuses_before_writing_either_snapshot(self):
        with tempfile.TemporaryDirectory(prefix="qiandeng-prepare-test-") as td:
            project = Path(td)
            (project / "compose.yml").write_text("name: qiandengji\n", encoding="utf-8")
            files = [project / "server" / x / "magic-state.json" for x in ("world-data", "mcdata")]
            for path in files:
                path.parent.mkdir(parents=True)
                path.write_text(json.dumps({"version": 1, "players": {"QDSmokeBody": {"mana": 42}}}), encoding="utf-8")
            before = [p.read_bytes() for p in files]
            with self.assertRaises(SystemExit):
                fixture.prepare_project(project)
            self.assertEqual([p.read_bytes() for p in files], before)
            self.assertFalse((files[0].parent / ".qiandengji-smoke").exists())


if __name__ == "__main__":
    unittest.main()
