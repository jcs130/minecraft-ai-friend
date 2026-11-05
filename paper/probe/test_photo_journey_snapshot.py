import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import yaml
from photo_journey_snapshot import snapshot


class SnapshotTest(unittest.TestCase):
    def test_owner_scoped_read_only_export(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "plugins/AgentFriend"
            data.mkdir(parents=True)
            owner = "3b71682c-b2e8-4b77-836f-c30e46408991"
            job = "be6ab292-5195-439b-8b71-c9c13e2d1d5c"
            album = {"owner": owner, "id": job, "imageIndex": 17, "published": False, "story": "fixture story"}
            tile = {"type": "FILLED_MAP", "amount": 1, "meta": {"map-id": 23}}
            documents = {"photo-tasks.json": json.dumps({"players": {owner: {"photoTask": {"job": job}}, "other": {"private": "UNRELATED"}}}),
                         "photo-journal.json": json.dumps({"players": {owner: {"photos": {job: album}}, "other": {"private": "UNRELATED"}}}),
                         "config.yml": yaml.safe_dump({"photo-rewards": {owner: {"17": {"map-ids": [23], "pending": [tile]}}}, "dungeon-personal-stash": {owner: {"0": {"type": "STONE"}}, "other": {"private": "UNRELATED"}}})}
            for name, text in documents.items():
                (data / name).write_text(text)
            result = snapshot(root, owner, job)
            self.assertEqual(result["stash"]["pendingMapIds"], [23])
            self.assertEqual(result["stash"]["storedMapIds"], [])
            self.assertFalse(result["album"]["published"])
            self.assertNotIn("UNRELATED", json.dumps(result))
            for name, text in documents.items():
                self.assertEqual((data / name).read_text(), text)
                self.assertEqual(result["sourceSha256"][name], hashlib.sha256(text.encode()).hexdigest())
            with self.assertRaises(ValueError):
                snapshot(root, owner, "ffffffff-ffff-4fff-8fff-ffffffffffff")


if __name__ == "__main__":
    unittest.main()
