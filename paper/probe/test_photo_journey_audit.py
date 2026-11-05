"""Synthetic schema/negative tests ONLY. No real Agent, world, image or E2E claim."""
import copy
import hashlib
import json
from pathlib import Path
import random
import struct
import tempfile
import unittest
import zlib
from photo_journey_audit import audit


class AuditTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.owner = "3b71682c-b2e8-4b77-836f-c30e46408991"
        self.job = "be6ab292-5195-439b-8b71-c9c13e2d1d5c"
        def chunk(kind, value):
            return struct.pack(">I", len(value)) + kind + value + struct.pack(">I", zlib.crc32(kind + value) & 0xffffffff)
        pixels = b"".join(b"\0" + random.Random(y).randbytes(768 * 3) for y in range(768))
        png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 768, 768, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")
        (self.root / "test-only.png").write_bytes(png)
        self.sha = hashlib.sha256(png).hexdigest()
        command = "/mycli photo take 旅途 third 1 --story 洞口见闻"
        # 'real-client' here exercises a declared-source schema. This is explicitly
        # fabricated test input, not an execution of a real client or model.
        self.run = {"schema": "photo-journey/v1", "owner": self.owner, "evidenceKind": "real-client", "gameAddress": "127.0.0.1:25914"}
        data = [
            ("hint", {"type": "adventure_hint", "eventId": "hint-1", "recipient": self.owner, "requiresDecision": True, "command": "/mycli photo take <新照片名> third 1 --story <见闻>"}),
            ("decision", {"source": "model-host-tool-call", "model": "fixture", "responseId": "r-1", "toolCallId": "c-1", "command": command, "hintId": "hint-1", "observation": {"at": 1000, "safe": True, "cameraReady": True, "sourceRef": "fixture-only"}}),
            ("submitted", {"command": command, "toolCallId": "c-1"}),
            ("image", {"job": self.job, "owner": self.owner, "mode": "third", "world": "fixture-world", "file": "test-only.png", "sha256": self.sha, "diagnostics": {"nativeInstance": "fixture", "renderer": "Intel fixture", "width": 768, "height": 768}}),
            ("receipt", {"status": "success", "jobStatus": "success", "job": self.job, "owner": self.owner, "name": "旅途", "imageIndex": 17, "mapIds": [23]}),
            ("album", {"id": self.job, "owner": self.owner, "name": "旅途", "story": "洞口见闻", "published": False, "imageIndex": 17, "mapIds": [23], "worldUuid": "fixture-world", "image": {"sha256": self.sha}}),
            ("stash", {"owner": self.owner, "imageIndex": 17, "mapIds": [23], "storedMapIds": [23], "pendingMapIds": []}),
        ]
        self.events = [{"sequence": i + 1, "at": 1000 + i, "kind": k, "data": v} for i, (k, v) in enumerate(data)]
        trace = json.dumps({"model": "fixture", "id": "r-1", "tool_calls": [{"id": "c-1", "arguments": json.dumps({"command": command})}]}).encode()
        (self.root / "fixture-trace.json").write_bytes(trace)
        self.events[1]["data"].update(traceFile="fixture-trace.json", traceSha256=hashlib.sha256(trace).hexdigest())

    def result(self):
        (self.root / "run.json").write_text(json.dumps(self.run))
        (self.root / "events.jsonl").write_text("\n".join(json.dumps(e) for e in self.events))
        return audit(self.root)

    def test_consistent_declared_schema(self):
        self.assertTrue(self.result()["evidenceComplete"])

    def test_fixture_is_never_real_e2e(self):
        self.run["evidenceKind"] = "synthetic-fixture"
        self.assertFalse(self.result()["evidenceComplete"])

    def test_hint_is_not_decision(self):
        self.events = [e for e in self.events if e["kind"] != "decision"]
        self.assertEqual(self.result()["stages"]["agent_decision"]["status"], "BLOCKED")

    def test_other_adventure_hint_is_not_photo_suggestion(self):
        self.events[0]["data"]["command"] = "/mycli guild status"
        self.assertEqual(self.result()["stages"]["suggestion_received"]["status"], "BLOCKED")

    def test_old_image_or_receipt_cannot_complete_new_submission(self):
        for kind in ("image", "receipt"):
            with self.subTest(kind=kind):
                previous = copy.deepcopy(self.events)
                row = next(e for e in self.events if e["kind"] == kind)
                self.events.remove(row)
                self.events.insert(0, row)
                for i, event in enumerate(self.events):
                    event.update(sequence=i + 1, at=1000 + i)
                self.assertFalse(self.result()["evidenceComplete"])
                self.events = previous

    def test_missing_or_unrelated_model_trace(self):
        file = self.root / "fixture-trace.json"
        file.write_text('{"summary":"the Agent decided to take a picture"}')
        self.events[1]["data"]["traceSha256"] = hashlib.sha256(file.read_bytes()).hexdigest()
        self.assertFalse(self.result()["evidenceComplete"])
        file.unlink()
        self.assertFalse(self.result()["evidenceComplete"])

    def test_unsafe_or_stale_observation(self):
        for values in [{"safe": False}, {"cameraReady": False}, {"at": -999999}, {"sourceRef": ""}]:
            with self.subTest(values=values):
                previous = copy.deepcopy(self.events[1]["data"]["observation"])
                self.events[1]["data"]["observation"].update(values)
                self.assertFalse(self.result()["evidenceComplete"])
                self.events[1]["data"]["observation"] = previous

    def test_missing_or_corrupted_png(self):
        file = self.root / "test-only.png"
        file.write_bytes(file.read_bytes()[:-20])
        self.assertEqual(self.result()["stages"]["actual_image_artifact"]["status"], "BLOCKED")
        file.unlink()
        self.assertFalse(self.result()["evidenceComplete"])

    def test_digest_mismatch(self):
        self.events[3]["data"]["sha256"] = "0" * 64
        self.assertFalse(self.result()["evidenceComplete"])

    def test_uploaded_or_unknown_is_not_game_success(self):
        for status in ("uploaded", "importing", "unknown", "idle"):
            self.events[4]["data"]["status"] = status
            self.assertEqual(self.result()["stages"]["game_completion"]["status"], "BLOCKED")

    def test_foreign_owner_or_public_album(self):
        self.events[5]["data"]["owner"] = "somebody-else"
        self.assertFalse(self.result()["evidenceComplete"])
        self.events[5]["data"]["owner"] = self.owner
        self.events[5]["data"]["published"] = True
        self.assertFalse(self.result()["evidenceComplete"])

    def test_story_and_map_identity_required(self):
        self.events[5]["data"]["story"] = ""
        self.assertFalse(self.result()["evidenceComplete"])
        self.events[5]["data"]["story"] = "洞口见闻"
        self.events[5]["data"]["mapIds"] = [999]
        self.assertFalse(self.result()["evidenceComplete"])

    def test_duplicate_storage_and_resubmission_fail(self):
        self.events[6]["data"]["pendingMapIds"] = [23]
        self.assertFalse(self.result()["evidenceComplete"])
        self.events[6]["data"]["pendingMapIds"] = []
        self.events.append({"kind": "submitted", "data": self.events[2]["data"], "at": 1010, "sequence": 8})
        self.assertFalse(self.result()["evidenceComplete"])


if __name__ == "__main__":
    unittest.main()
