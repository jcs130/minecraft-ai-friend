import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace

import prepare


class PreparationTests(unittest.TestCase):
    def test_nonempty_existing_instance_is_refused_before_any_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            server, client = root / "server", root / "client"
            server.mkdir()
            (server / "server.properties").write_text("existing production data")
            with self.assertRaisesRegex(ValueError, "unowned nonempty"):
                prepare.validate_owned_roots(SimpleNamespace(server=server, client=client))
            self.assertFalse((server / "mods").exists())
            self.assertFalse(client.exists())

    def test_wrong_instance_marker_is_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            server, client = root / "server", root / "client"
            server.mkdir()
            prepare.write_json(server / "fabric263-lab.json", {"game": "1.20.1", "loopbackOnly": True})
            with self.assertRaisesRegex(ValueError, "marker"):
                prepare.validate_owned_roots(SimpleNamespace(server=server, client=client))

    def test_path_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):
                prepare.safe_child(temp, "../other-instance/file.jar")
            self.assertEqual(prepare.safe_child(temp, "mods/a.jar"), Path(temp).resolve() / "mods/a.jar")

    def test_existing_hash_mismatch_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "mod.jar"
            target.write_bytes(b"operator-edited")
            with self.assertRaises(ValueError):
                prepare.download("https://unused.invalid/mod.jar", target, {"sha256": hashlib.sha256(b"other").hexdigest()})
            self.assertEqual(target.read_bytes(), b"operator-edited")

    def test_atomic_download_checks_source_before_replace(self):
        with tempfile.TemporaryDirectory() as temp:
            source, target = Path(temp) / "source", Path(temp) / "target"
            source.write_bytes(b"actual-file")
            with self.assertRaises(ValueError):
                prepare.download(source.as_uri(), target, {"sha256": "0" * 64})
            self.assertFalse(target.exists())
            prepare.download(source.as_uri(), target, {"sha256": prepare.digest(source)}, source.stat().st_size)
            self.assertEqual(target.read_bytes(), source.read_bytes())

    def test_copy_preserves_different_operator_file(self):
        with tempfile.TemporaryDirectory() as temp:
            source, target = Path(temp) / "source", Path(temp) / "target"
            source.write_bytes(b"new")
            target.write_bytes(b"old")
            with self.assertRaises(ValueError):
                prepare.copy_checked(source, target)
            self.assertEqual(target.read_bytes(), b"old")

    def test_windows_linux_and_arch_rules(self):
        self.assertTrue(prepare.allowed(None))
        self.assertFalse(prepare.allowed([{"action": "allow", "os": {"name": "linux"}}]))
        self.assertFalse(prepare.allowed([{"action": "allow", "os": {"arch": "x86"}}]))
        self.assertTrue(prepare.allowed([{"action": "allow", "os": {"name": "windows", "arch": "amd64"}}]))
        self.assertFalse(prepare.allowed([{"action": "allow"}, {"action": "disallow", "os": {"name": "windows"}}]))

    def test_launch_features_and_unresolved_values(self):
        items = ["--name", "${name}", {"rules": [{"action": "allow", "features": {"demo": True}}], "value": "--demo"}]
        self.assertEqual(prepare.expand_arguments(items, {"name": "GraalScout"}, {}), ["--name", "GraalScout"])
        with self.assertRaises(ValueError):
            prepare.expand_arguments(["${unrecognized}"], {}, {})

    def test_explicit_dependency_pin_wins(self):
        resolver = prepare.Resolver({"minecraft": "26.3"})
        resolver.root_pins["animation"] = "reviewed-beta"
        resolver.versions["reviewed-beta"] = {"id": "reviewed-beta", "version_type": "beta"}
        self.assertEqual(resolver.choose("animation")["id"], "reviewed-beta")

    def test_other_game_version_is_rejected(self):
        resolver = prepare.Resolver({"minecraft": "26.3"})
        with self.assertRaisesRegex(ValueError, "exact game/loader"):
            resolver.add({"id": "wrong", "game_versions": ["26.2"], "loaders": ["fabric"]}, {"server"}, "root")

    def test_required_library_reaches_client_despite_server_catalogue_label(self):
        entries = [
            {"projectId": "wizard", "versionId": "w1", "clientSide": "required", "serverSide": "required", "sides": [],
             "dependencies": [{"dependency_type": "required", "project_id": "library", "version_id": None}]},
            {"projectId": "library", "versionId": "l1", "clientSide": "unsupported", "serverSide": "required", "sides": [], "dependencies": []},
        ]
        lock = {"mods": entries}
        prepare.derive_locked_sides(lock, {"roots": [{"versionId": "w1"}]})
        self.assertEqual(entries[1]["sides"], ["client", "server"])
        self.assertEqual(lock["sideRulesVersion"], 2)

    def test_conflicting_dependency_versions_are_rejected(self):
        resolver = prepare.Resolver({"minecraft": "26.3"})
        resolver.projects["p"] = {"id": "p", "slug": "example", "client_side": "required", "server_side": "required"}
        resolver.by_project["p"] = {"versionId": "v1", "sides": ["server"]}
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            resolver.add({"id": "v2", "project_id": "p", "game_versions": ["26.3"], "loaders": ["fabric"]}, {"server"}, "root")


if __name__ == "__main__":
    unittest.main()
