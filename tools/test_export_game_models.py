"""Exercise model lock enforcement, including full small-mrpack round trips."""
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

from export_pack import allowed_path, export_pack, load_model_lock, verify_pack, MODEL_TARGET
from pack_builder import ROOT


class ExportModelsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / "client/mods").mkdir(parents=True)
        (self.root / "manifests").mkdir()
        for name in ("qiandengji_naruto", "qiandengji_kirito"):
            relative = Path("config/yes_steve_model/custom") / name
            shutil.copytree(ROOT / "client" / relative, self.root / "client" / relative)
        shutil.copyfile(ROOT / "manifests/game-models.lock.json", self.root / "manifests/game-models.lock.json")
        self.target = {"minecraft": "1.21.1", "neoforge": "21.1.248"}
        (self.root / "client/options.txt").write_text("lastServer:private.example\nfov:0.0\n")
        lock = {"target": self.target, "files": [{"path": "options.txt"}]}
        (self.root / "manifests/client.lock.json").write_text(json.dumps(lock))

    def tearDown(self):
        self.temporary.cleanup()

    def test_actual_model_lock_and_round_trip(self):
        models = load_model_lock(self.root, self.target)
        self.assertEqual(len(models), 26)
        destination = self.root / "fixture.mrpack"
        report = export_pack(self.root, destination, "0.1.2-local")
        self.assertEqual(report["game_model_file_count"], 26)
        self.assertEqual(report["game_model_count"], 2)
        self.assertEqual(verify_pack(destination)["override_hashes"], "passed")
        with zipfile.ZipFile(destination) as archive:
            lock = json.loads(archive.read("overrides/qiandeng-pack.lock.json"))
            self.assertEqual(lock["game_models"]["target"], MODEL_TARGET)
            self.assertEqual(len(lock["game_models"]["files"]), 26)
            self.assertNotIn(b"private.example", archive.read("overrides/options.txt"))
            self.assertTrue(all("/auth/" not in name and "/cache/" not in name for name in archive.namelist()))

    def test_modified_model_rejected_instead_of_relaxed_config_hash(self):
        path = self.root / "client/config/yes_steve_model/custom/qiandengji_naruto/models/main.json"
        path.write_bytes(path.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "differs from lock"):
            export_pack(self.root, self.root / "bad.mrpack", "test")

    def test_unlocked_file_and_include_override_are_rejected(self):
        path = self.root / "client/config/yes_steve_model/custom/qiandengji_naruto/unlocked.json"
        path.write_text("{}")
        with self.assertRaisesRegex(ValueError, "unlocked files"):
            export_pack(self.root, self.root / "bad.mrpack", "test", [path.relative_to(self.root / "client").as_posix()])

    def test_private_and_foreign_ysm_roots_rejected(self):
        for name in ("config/yes_steve_model/auth/paid.ysm", "config/yes_steve_model/cache/key.dat",
                     "config/yes_steve_model/builtin/default/ysm.json", "config/yes_steve_model/custom/foreign/ysm.json"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                allowed_path(name)

    def test_wrong_target_and_duplicate_model_rows_rejected(self):
        with self.assertRaisesRegex(ValueError, "target"):
            load_model_lock(self.root, {"minecraft": "1.20.1", "neoforge": "21.1.248"})
        path = self.root / "manifests/game-models.lock.json"
        value = json.loads(path.read_text())
        value["files"].append(value["files"][0])
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, "duplicate"):
            load_model_lock(self.root, self.target)

    def test_general_archive_lock_cannot_override_model_lock(self):
        destination = self.root / "fixture.mrpack"
        export_pack(self.root, destination, "0.1.2-local")
        with zipfile.ZipFile(destination) as archive:
            data = {name: archive.read(name) for name in archive.namelist()}
        model = "config/yes_steve_model/custom/qiandengji_naruto/models/main.json"
        data["overrides/" + model] += b" "
        general = json.loads(data["overrides/qiandeng-pack.lock.json"])
        # Even an updated general settings hash must not relax the separate model lock.
        for row in general["files"]:
            if row["path"] == model:
                payload = data["overrides/" + model]
                row.update(size=len(payload), sha256=hashlib.sha256(payload).hexdigest(), sha512=hashlib.sha512(payload).hexdigest())
        data["overrides/qiandeng-pack.lock.json"] = json.dumps(general).encode()
        with zipfile.ZipFile(destination, "w") as archive:
            for name, payload in data.items():
                archive.writestr(name, payload)
        with self.assertRaisesRegex(ValueError, "model hash mismatch"):
            verify_pack(destination)


if __name__ == "__main__":
    unittest.main(verbosity=2)
