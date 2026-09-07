"""Meaningful isolated tests: dependency closure, identity, integrity and export boundaries."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import pack_builder as pb
import export_pack as ep


def jar_bytes(mod_id, version="1.0.0", dependencies="", extra=None):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        archive.writestr("META-INF/neoforge.mods.toml", f'''modLoader="javafml"
loaderVersion="[4,)"
[[mods]]
modId="{mod_id}"
version="{version}"
{dependencies}
''')
        for name, content in (extra or {}).items():
            archive.writestr(name, content)
    return data.getvalue()


def dependency(owner, dep, version="[1,)", kind="required", side="BOTH"):
    return f'''\n[[dependencies.{owner}]]
modId="{dep}"
type="{kind}"
versionRange="{version}"
side="{side}"
'''


class PackBuilderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.base = self.root / "original-base"
        self.server = self.root / "production-mods"
        (self.base / "mods").mkdir(parents=True)
        (self.base / "config").mkdir()
        self.server.mkdir()
        self.output = self.root / "isolated-project"
        self.output.mkdir()
        self.write_jar(self.base / "mods" / "base.jar", "base")
        (self.base / "config" / "base.toml").write_text("quality=2\n")
        (self.base / "config" / "sodium-fingerprint.json").write_text('{"fingerprint":"private"}')
        (self.base / "options.txt").write_text("renderDistance:10\n")
        (self.base / "original-base.jar").write_bytes(b"game-binary-must-not-copy")
        (self.base / "PCL").mkdir()
        (self.base / "PCL" / "Setup.ini").write_text("account=never-copy")
        self.config = {
            "sources": {"base_pack": str(self.base), "server_mods": str(self.server)},
            "target": {"minecraft": "1.21.1", "neoforge": "21.1.248", "java": 21, "fml": "4.0.43"},
            "expected_base_jar_count": 1, "include_mod_ids": [],
            "exclude_server_mod_ids": ["botgate", "numen"],
            "exclude_base_files": ["config/sodium-fingerprint.json"],
        }

    def write_jar(self, path, mod_id, version="1.0.0", deps="", extra=None):
        path.write_bytes(jar_bytes(mod_id, version, deps, extra))
        return path

    def add_export_model_fixture(self):
        # Export-boundary fixture; complete real model format is tested separately.
        rows = []
        for model in ("qiandengji_naruto", "qiandengji_kirito"):
            relative = f"config/yes_steve_model/custom/{model}/ysm.json"
            target = self.output / "client" / relative
            target.parent.mkdir(parents=True)
            data = b'{"spec":2}\n'
            target.write_bytes(data)
            rows.append({"path": relative, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        (self.output / "manifests/game-models.lock.json").write_text(json.dumps({
            "schema_version": 1, "target": ep.MODEL_TARGET, "files": rows,
        }))

    def test_range_endpoints_and_union(self):
        self.assertFalse(pb.in_range("1.21.1", "[1.21,1.21.1)"))
        self.assertTrue(pb.in_range("1.21.1", "[1.21.1]"))
        self.assertFalse(pb.in_range("1.21.2", "[1.21.1]"))
        self.assertTrue(pb.in_range("2.0", "(,1.0],[2.0,)"))
        self.assertFalse(pb.in_range("1.5", "(,1.0],[2.0,)"))
        self.assertTrue(pb.in_range("4.9.2", "4.7.5.1"))  # Maven recommendation, not exact.
        self.assertTrue(pb.in_range("1.21.1-2.6.22", "[1.21-2.3.0,)"))
        self.assertTrue(pb.in_range("1.5.3-neoforge+mc1.21.1", "[1.5.3,)"))
        self.assertLess(pb.compare_versions("0.8.13-beta.1", "0.8.13"), 0)

    def test_required_dependencies_auto_added(self):
        self.write_jar(self.server / "feature.jar", "feature", deps=dependency("feature", "library"))
        self.write_jar(self.server / "library.jar", "library")
        self.config["include_mod_ids"] = ["feature"]
        report = pb.build(self.config, self.output)
        self.assertEqual(report["errors"], [])
        self.assertEqual(report["added_jar_count"], 2)
        self.assertTrue(any(row["kind"] == "dependency_added" for row in report["decisions"]))

    def test_missing_dependency_stops_before_copy(self):
        self.write_jar(self.server / "feature.jar", "feature", deps=dependency("feature", "missing"))
        self.config["include_mod_ids"] = ["feature"]
        with self.assertRaisesRegex(ValueError, "Missing required dependency"):
            pb.build(self.config, self.output)
        self.assertFalse((self.output / "client").exists())

    def test_required_server_dependency_not_added_on_client(self):
        self.write_jar(self.server / "feature.jar", "feature", deps=dependency("feature", "botgate", side="SERVER"))
        self.config["include_mod_ids"] = ["feature"]
        self.assertEqual(pb.build(self.config, self.output)["errors"], [])

    def test_server_only_dependency_refused_when_required_both(self):
        self.write_jar(self.server / "feature.jar", "feature", deps=dependency("feature", "botgate"))
        self.config["include_mod_ids"] = ["feature"]
        with self.assertRaisesRegex(ValueError, "excluded server mod"):
            pb.build(self.config, self.output)

    def test_nested_library_satisfies_required_dependency(self):
        nested = "META-INF/jarjar/library.jar"
        extra = {nested: jar_bytes("library"), "META-INF/jarjar/metadata.json": json.dumps({"jars": [{"path": nested}]})}
        self.write_jar(self.server / "feature.jar", "feature", deps=dependency("feature", "library"), extra=extra)
        self.config["include_mod_ids"] = ["feature"]
        report = pb.build(self.config, self.output)
        self.assertEqual(report["errors"], [])
        self.assertEqual(report["added_jar_count"], 1)

    def test_duplicate_hash_prefers_canonical_bettercombat_name(self):
        canonical = self.write_jar(self.server / "bettercombat-1.0.jar", "bettercombat")
        (self.server / "bc232-rebuilt.jar").write_bytes(canonical.read_bytes())
        self.config["include_mod_ids"] = ["bettercombat"]
        report = pb.build(self.config, self.output)
        self.assertEqual(report["added_jar_count"], 1)
        self.assertTrue((self.output / "client/mods/bettercombat-1.0.jar").exists())
        self.assertFalse((self.output / "client/mods/bc232-rebuilt.jar").exists())

    def test_different_duplicate_ids_fail(self):
        self.write_jar(self.server / "a.jar", "feature", "1.0")
        self.write_jar(self.server / "b.jar", "feature", "2.0")
        self.config["include_mod_ids"] = ["feature"]
        with self.assertRaisesRegex(ValueError, "Multiple different"):
            pb.build(self.config, self.output)

    def test_incompatible_pair_and_wrong_loader_reported(self):
        self.write_jar(self.server / "feature.jar", "feature", deps=dependency("feature", "base", kind="incompatible"))
        self.config["include_mod_ids"] = ["feature"]
        report = pb.build(self.config, self.output)
        self.assertTrue(any("incompatible" in error for error in report["errors"]))
        self.assertFalse((self.output / "client").exists())
        with zipfile.ZipFile(self.server / "fabric.jar", "w") as archive:
            archive.writestr("fabric.mod.json", '{"id":"fabric_only","version":"1.0"}')
        jar = pb.inspect_jar(self.server / "fabric.jar", "test")
        self.assertTrue(any("Wrong loader" in error for error in pb.validate_jars([jar], self.config)["errors"]))

    def test_corrupt_and_missing_nested_archives_fail(self):
        invalid = self.server / "invalid.jar"
        invalid.write_bytes(b"not a zip")
        with self.assertRaises(zipfile.BadZipFile):
            pb.inspect_jar(invalid, "test")
        missing = self.write_jar(self.server / "missing.jar", "missing", extra={"META-INF/jarjar/metadata.json": '{"jars":[{"path":"missing.jar"}]}'})
        with self.assertRaisesRegex(ValueError, "Missing bundled"):
            pb.inspect_jar(missing, "test")

    def test_builtin_loader_alias_is_reported_without_changing_jar(self):
        source = self.write_jar(self.server / "old-range.jar", "old_range", deps=dependency("old_range", "minecraft", "[1.21,1.21.1)"))
        original_hash = pb.digest(source)
        self.config["include_mod_ids"] = ["old_range"]
        self.config["loader_compatibility_aliases"] = {"minecraft": ["1.21"]}
        report = pb.build(self.config, self.output)
        self.assertEqual(report["errors"], [])
        self.assertTrue(any("native compatibility aliases" in warning for warning in report["warnings"]))
        self.assertEqual(pb.digest(self.output / "client/mods/old-range.jar"), original_hash)
        self.assertFalse((self.output / "client/config/fml.toml").exists())

    def test_idempotence_privacy_and_preserved_edits(self):
        first = pb.build(self.config, self.output)
        lock_path = self.output / "manifests/client.lock.json"
        original_lock = lock_path.read_bytes()
        second = pb.build(self.config, self.output)
        self.assertEqual(original_lock, lock_path.read_bytes())
        self.assertEqual(first["lock_sha256"], second["lock_sha256"])
        client = self.output / "client"
        self.assertFalse((client / "PCL").exists())
        self.assertFalse((client / "original-base.jar").exists())
        self.assertFalse((client / "config/sodium-fingerprint.json").exists())
        (client / "config/base.toml").write_text("quality=1\n")
        (client / "notes.txt").write_text("user notes")
        report = pb.build(self.config, self.output)
        self.assertIn("config/base.toml", report["preserved_existing_files"])
        self.assertEqual((client / "config/base.toml").read_text(), "quality=1\n")
        self.assertEqual((client / "notes.txt").read_text(), "user notes")

    def test_unmanaged_jar_stops_rebuild_without_deleting(self):
        pb.build(self.config, self.output)
        unknown = self.output / "client/mods/user-mod.jar"
        unknown.write_bytes(b"user-managed file")
        report = pb.build(self.config, self.output)
        self.assertEqual(report["status"], "blocked")
        self.assertEqual(unknown.read_bytes(), b"user-managed file")

    def test_relative_path_traversal_refused(self):
        for path in ("../secret", "C:/secret", "\\secret", "/secret"):
            with self.assertRaises(ValueError):
                pb.safe_relative(path)

    def test_export_reproducibility_hashes_and_privacy(self):
        pb.build(self.config, self.output)
        self.add_export_model_fixture()
        client = self.output / "client"
        (client / "options.txt").write_text("renderDistance:10\nlastServer:private-address\n")
        (client / "saves/PrivateWorld").mkdir(parents=True)
        (client / "saves/PrivateWorld/level.dat").write_bytes(b"private")
        (client / "config/accounts.json").write_text('{"account":"not exported"}')
        one, two = self.output / "dist/one.mrpack", self.output / "dist/two.mrpack"
        first = ep.export_pack(self.output, one, "test")
        second = ep.export_pack(self.output, two, "test")
        self.assertEqual(first["sha256"], second["sha256"])
        self.assertEqual(ep.verify_pack(one)["override_hashes"], "passed")
        with zipfile.ZipFile(one) as archive:
            self.assertEqual(json.loads(archive.read("modrinth.index.json"))["files"], [])
            self.assertNotIn(b"lastServer", archive.read("overrides/options.txt"))
            self.assertFalse(any("saves" in name or "accounts" in name or "fingerprint" in name for name in archive.namelist()))
        with self.assertRaisesRegex(ValueError, "Personal/generated"):
            ep.export_pack(self.output, two, "test", ["config/accounts.json"])

    def test_export_refuses_changed_or_untracked_mods(self):
        pb.build(self.config, self.output)
        self.add_export_model_fixture()
        mod = self.output / "client/mods/base.jar"
        mod.write_bytes(b"modified")
        with self.assertRaisesRegex(ValueError, "differs from validated lock"):
            ep.export_pack(self.output, self.output / "pack.mrpack", "test")

    def test_package_tampering_detected(self):
        pb.build(self.config, self.output)
        self.add_export_model_fixture()
        package = self.output / "pack.mrpack"
        ep.export_pack(self.output, package, "test")
        with zipfile.ZipFile(package) as archive:
            entries = {name: archive.read(name) for name in archive.namelist()}
        entries["overrides/config/base.toml"] = b"tampered"
        with zipfile.ZipFile(package, "w") as archive:
            for name, data in entries.items():
                archive.writestr(name, data)
        with self.assertRaisesRegex(ValueError, "hash/size mismatch"):
            ep.verify_pack(package)


if __name__ == "__main__":
    unittest.main()
