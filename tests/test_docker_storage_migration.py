import importlib.util
from pathlib import Path
import unittest
import copy
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "storage_migration", Path(__file__).resolve().parents[1] / "tools/migrate_docker_storage.py")
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class MigrationGuardsTest(unittest.TestCase):
    def test_mount_and_record_order_do_not_change_identity(self):
        before = {"images": [{"id": "i1", "tags": ["z", "a"]}], "containers": [
            {"id": "c1", "mounts": [{"Source": "D:/one", "RW": False}, {"Source": "D:/two", "RW": True}]}]}
        after = copy.deepcopy(before)
        after["images"][0]["tags"].reverse()
        after["containers"][0]["mounts"].reverse()
        self.assertEqual({}, migration.inventory_diff(before, after))

    def test_mount_permissions_change_is_preserved_in_diff(self):
        before = {"images": [], "containers": [{"id": "c1", "mounts": [{"Source": "D:/one", "RW": False}]}]}
        after = copy.deepcopy(before)
        after["containers"][0]["mounts"][0]["RW"] = True
        delta = migration.inventory_diff(before, after)
        self.assertIn("mounts", delta["containers"]["changedFields"]["c1"])

    def test_rejects_running_game_and_stopped_unrelated_container(self):
        items = [{"name": "tts", "project": "qiandengji", "state": "running"},
                 {"name": "other", "project": "other-app", "state": "exited"}]
        self.assertEqual(2, len(migration.container_errors(items)))

    def test_preflight_failure_never_submits_migration(self):
        with patch.object(migration, "preflight", return_value={"errors": ["still building"]}), \
                patch.object(migration, "api") as api, \
                patch("sys.argv", ["migrate", "--migrate"]):
            self.assertEqual(1, migration.main())
        api.assert_not_called()

    def test_readonly_default_never_submits_migration(self):
        with patch.object(migration, "preflight", return_value={"readyToMigrate": True}), \
                patch.object(migration, "api") as api, \
                patch("sys.argv", ["migrate"]):
            self.assertEqual(0, migration.main())
        api.assert_not_called()


if __name__ == "__main__":
    unittest.main()
