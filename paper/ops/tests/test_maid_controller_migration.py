import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("migration_audit", Path(__file__).parents[1] / "audit-maid-controller-migration.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
MAID = "11111111-1111-4111-8111-111111111111"
OWNER = "22222222-2222-4222-8222-222222222222"


class MigrationAudit(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.binding = {"maidId": MAID, "ownerId": OWNER}
        self.write("legacyBrain", {**self.binding, "choices": {"dsh": {"token": "secret-never-print"}}})
        self.write("legacyRegistry", {"maids": {MAID: {**self.binding, "sessionKey": "secret-never-print", "memoryNamespace": "private-memory"}}})
        self.write("speech", {**self.binding, "voice": "existing-voice", "tokenFile": "secret-path", "backend": "http://private-host"})

    def write(self, key, value):
        path = self.root / module.CONFIGS[key]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding="utf-8")

    def run_audit(self):
        return module.audit(self.root, MAID, OWNER)

    def codes(self):
        return {x["code"] for x in self.run_audit()["findings"]}

    def test_original_remains_private_and_unmigrated(self):
        before = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        result = self.run_audit()
        self.assertFalse(result["deploymentReady"])
        self.assertFalse(result["runtimeVerified"])
        self.assertEqual(result["speech"]["voice"], "existing-voice")
        self.assertIn("not_registered_as_resident", self.codes())
        text = json.dumps(result)
        for secret in ("secret-never-print", "private-memory", "private-host", "secret-path"):
            self.assertNotIn(secret, text)
        self.assertEqual(before, {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()})

    def test_overlapping_controller_and_navigation_are_reported(self):
        self.write("agents", {"maids": [self.binding]})
        self.write("residents", {"residents": [{"maidId": MAID}]})
        self.write("legacyResidence", self.binding)
        self.assertTrue({"duplicate_brain_controller", "legacy_navigation_requires_explicit_handoff"} <= self.codes())

    def test_owner_mismatch_is_never_fixed(self):
        self.write("speech", {**self.binding, "ownerId": MAID})
        self.assertIn("owner_mismatch", self.codes())

    def test_unknown_receipt_is_not_replayed_or_made_successful(self):
        folder = self.root / "plugins/QiandengjiMaidBridge/native-receipts"
        folder.mkdir()
        for index, status in enumerate(["applied", "unknown", "reserved"]):
            (folder / f"{MAID}_{index}.json").write_text(json.dumps({"status": status, "dialogue": "private-dialogue"}))
        result = self.run_audit()
        receipts = result["legacyReceipts"]
        self.assertTrue(receipts["containsUncertainHistory"])
        self.assertFalse(receipts["activeOperationVerified"])
        self.assertEqual(receipts["statuses"], {"applied": 1, "reserved": 1, "unknown": 1})
        self.assertNotIn("private-dialogue", json.dumps(result))

    def test_invalid_config_diagnoses_without_echoing_private_input(self):
        (self.root / module.CONFIGS["legacyBrain"]).write_text('{"secret-never-print":')
        self.assertIn("config_unreadable", self.codes())
        self.assertNotIn("secret-never-print", json.dumps(self.run_audit()))

    def test_resident_requires_agent_and_never_authorizes_deployment(self):
        self.write("residents", {"residents": [{"maidId": MAID}]})
        self.assertIn("resident_without_agent_binding", self.codes())
        self.assertFalse(self.run_audit()["deploymentReady"])

    def test_duplicate_bindings_and_non_objects_are_diagnosed(self):
        self.write("agents", {"maids": [self.binding, self.binding]})
        self.assertIn("duplicate_binding", self.codes())
        self.write("agents", {"maids": ["not-a-binding"]})
        self.assertIn("invalid_binding_list", self.codes())

    def test_dialogue_terminal_is_not_action_completion(self):
        folder = self.root / "plugins/QiandengjiMaidBridge/native-receipts"
        folder.mkdir()
        for index, status in enumerate(["replied", "closed"]):
            (folder / f"{MAID}_{index}.json").write_text(json.dumps({"status": status}))
        receipts = self.run_audit()["legacyReceipts"]
        self.assertFalse(receipts["containsUncertainHistory"])
        self.assertEqual(receipts["statuses"], {"closed": 1, "replied": 1})
        self.assertNotIn("completed", receipts["statuses"])

    def test_malformed_registry_entry_does_not_crash_or_print(self):
        self.write("legacyRegistry", {"maids": {MAID: "secret-never-print"}})
        self.assertIn("invalid_original_registry_entry", self.codes())
        self.assertNotIn("secret-never-print", json.dumps(self.run_audit()))


if __name__ == "__main__":
    unittest.main()
