import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from backup import assert_stopped, create_snapshot, selected_files
from prepare import digest


class ColdBackupTests(unittest.TestCase):
    def test_two_copies_and_each_archived_file_are_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "world.dat"
            source.write_bytes(b"actual world bytes" * 100)
            result = create_snapshot({"server/world/level.dat": source}, root / "e/a.zip", root / "f/a.zip")
            self.assertEqual(result["sha256"], digest(root / "f/a.zip"))
            self.assertTrue(result["cold"])
            with zipfile.ZipFile(root / "e/a.zip") as z:
                manifest = json.loads(z.read("snapshot-manifest.json"))
                self.assertEqual(z.read("server/world/level.dat"), source.read_bytes())
                self.assertEqual(manifest["files"]["server/world/level.dat"]["sha256"], digest(source))

    def test_old_snapshot_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "old.zip"
            target.write_bytes(b"preserve")
            with self.assertRaisesRegex(ValueError, "distinct new"):
                create_snapshot({}, target, root / "new.zip")
            self.assertEqual(target.read_bytes(), b"preserve")
            self.assertFalse((root / "new.zip").exists())

    def test_only_world_configuration_and_npc_state_selected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for path in ("world/level.dat", "config/quests.json", "easy_npc/people.json", "runtime/token.json", "mods/vendor.jar"):
                file = root / path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(b"data")
            self.assertEqual(set(selected_files(root)), {"server/world/level.dat", "server/config/quests.json", "server/easy_npc/people.json"})

    def test_shutdown_failure_or_unready_exit_rejects_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / "server-process.local.json"
            for status, code in (("stopping", 0), ("failed", 0), ("stopped", 1)):
                file.write_text(json.dumps({"status": status, "exitCode": code}))
                with self.assertRaisesRegex(ValueError, "clean server shutdown"):
                    assert_stopped({"cache": str(root)})


if __name__ == "__main__":
    unittest.main()
