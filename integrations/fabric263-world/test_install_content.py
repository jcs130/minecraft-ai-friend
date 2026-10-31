import json
from pathlib import Path
import tempfile
import unittest

from install_content import install, merge_quests


class QuestInstallTests(unittest.TestCase):
    def test_fresh_owned_instance_and_idempotent_second_install(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "fabric263-lab.json").write_text("{}")
            quests = {"maw:first": {"title": "First task"}}
            self.assertTrue(install(root, quests)["changed"])
            self.assertFalse(install(root, quests)["changed"])
            self.assertEqual(json.loads((root / "world/justquests/custom-quests.json").read_text()), quests)
            self.assertEqual(list(root.rglob("*.before-*.json")), [])

    def test_conflict_requires_explicit_update_and_preserves_other_quests(self):
        before = {"vendor:story": {"title": "Keep"}, "maw:first": {"title": "Old"}}
        additions = {"maw:first": {"title": "New"}}
        with self.assertRaisesRegex(ValueError, "differs"):
            merge_quests(before, additions)
        result = merge_quests(before, additions, True)
        self.assertEqual(result["vendor:story"], before["vendor:story"])
        self.assertEqual(before["maw:first"]["title"], "Old")

    def test_wrong_namespace_or_unowned_instance_cannot_write(self):
        with self.assertRaisesRegex(ValueError, "namespace"):
            merge_quests({}, {"vendor:overwrite": {}})
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "isolated instance"):
                install(Path(directory), {"maw:first": {}})
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
