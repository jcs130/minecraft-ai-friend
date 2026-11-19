"""Local resource and catalog regression tests. No speech service or game is contacted."""
import base64
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location("pack_voices", Path(__file__).resolve().parents[1] / "sync-pack-voices.py")
voices = importlib.util.module_from_spec(spec)
spec.loader.exec_module(voices)


class PackCatalogTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.encoder = self.folder / "encoder"
        self.pcm = bytes([55, 0]) * 48000
        self.rows = {}
        self.writes = 0
        self.conflict = False
        self.patch = patch.object(voices, "json_request", side_effect=self.request)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        pcm = patch.object(voices, "decode_clip", return_value=self.pcm)
        pcm.start()
        self.addCleanup(pcm.stop)

    def archive(self, name="spring", clip="idle.ogg", authored=True):
        file = self.folder / (name + ".zip")
        meta = {"author": ["测试"]}
        if authored:
            meta["tts_reference"] = {"file": "sounds/maid/" + clip, "text": "早安，一起出发吧。"}
        with ZipFile(file, "w") as z:
            z.writestr("assets/" + name + "/maid_sound.json", json.dumps(meta))
            z.writestr("assets/" + name + "/sounds/maid/" + clip, b"synthetic clip")
        return file

    def request(self, url, data=None):
        if url == voices.API and data is None:
            return {"catalog": [{"id": key} for key in self.rows]}
        if data is not None:
            self.writes += 1
            key = data["id"]
            self.rows[key] = {**data, "reference_sha256": voices.digest(base64.b64decode(data["reference_audio"]))}
            if self.conflict:
                raise HTTPError(url, 409, "concurrent create", None, None)
            return self.rows[key]
        return self.rows[url.rsplit("/", 1)[1]]

    def sync(self, paths, aliases=None, publish=True):
        return voices.sync(paths, aliases or {}, self.encoder, lambda _: None, publish)

    def test_reimport_reuses_identical_voice(self):
        path = self.archive()
        cfg, _ = self.sync([path])
        self.assertEqual(cfg, self.sync([path])[0])
        self.assertEqual(self.writes, 1)
        self.assertEqual(cfg["scope"], "player_owned")
        self.assertNotIn("ownerId", cfg)

    def test_concurrent_registration_checks_winning_reference(self):
        self.conflict = True
        cfg, _ = self.sync([self.archive()])
        self.assertEqual(len(cfg["packs"]), 1)
        self.assertEqual(self.writes, 1)

    def test_changed_reference_is_refused(self):
        path = self.archive()
        cfg, _ = self.sync([path])
        self.rows[cfg["packs"]["spring"]]["reference_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "does not match"):
            self.sync([path])
        self.assertEqual(self.writes, 1)

    def test_verified_alias_needs_both_original_hashes(self):
        path = self.archive()
        aliases = {"spring": {"voice": "known", "archiveSha256": voices.digest(path.read_bytes()), "referenceSha256": "original"}}
        self.rows["known"] = {"reference_sha256": "original"}
        self.assertEqual(self.sync([path], aliases)[0]["packs"], {"spring": "known"})
        self.assertEqual(self.writes, 0)
        self.rows["known"]["reference_sha256"] = "changed"
        with self.assertRaisesRegex(ValueError, "reference changed"):
            self.sync([path], aliases)

    def test_unvoiced_pack_never_gets_a_substitute(self):
        cfg, evidence = self.sync([self.archive(clip="hurt1.ogg", authored=False)])
        self.assertEqual(cfg["packs"], {})
        self.assertEqual(evidence[0]["origin"], "no-spoken-reference")
        self.assertEqual(self.writes, 0)

    def test_duplicate_namespace_keeps_previous_catalog(self):
        path = self.archive()
        other = self.folder / "duplicate.zip"
        other.write_bytes(path.read_bytes())
        previous = self.folder / "personal-dialogue.json"
        voices.atomic_json(previous, {"ok": True})
        with self.assertRaisesRegex(ValueError, "same sound pack"):
            voices.atomic_json(previous, self.sync([path, other])[0])
        self.assertEqual(json.loads(previous.read_text()), {"ok": True})

    def test_preview_is_read_only_and_publish_is_idempotent(self):
        cfg, _ = self.sync([self.archive()], publish=False)
        self.assertEqual(self.writes, 0)
        p = self.folder / "out.json"
        voices.atomic_json(p, cfg)
        stamp = p.stat().st_mtime_ns
        voices.atomic_json(p, cfg)
        self.assertEqual(p.stat().st_mtime_ns, stamp)


if __name__ == "__main__":
    unittest.main()
