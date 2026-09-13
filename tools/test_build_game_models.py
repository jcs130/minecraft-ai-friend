"""Meaningful format, reproducibility and deployment-boundary checks."""
import copy
import tempfile
from pathlib import Path
import unittest

import build_game_models as build


class GameModelsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template = build.ROOT / "server/mc/config/yes_steve_model/builtin/misc/2_steve"
        cls.skins = build.ROOT / "server/character-skins"
        cls.models = {name: build.build_model(cls.template, cls.skins, name)
                      for name in build.MODEL_NAMES}

    def test_deterministic_and_skin_bytes_unchanged(self):
        for name, (files, summary) in self.models.items():
            self.assertEqual((files, summary), build.build_model(self.template, self.skins, name))
            skin = "naruto_748.png" if name.endswith("naruto") else "kirito_726.png"
            self.assertEqual(files["textures/skin.png"], (self.skins / skin).read_bytes())

    def test_complete_manifest_and_animation_bindings(self):
        import json
        for files, summary in self.models.values():
            manifest = json.loads(files["ysm.json"])
            self.assertEqual(manifest["spec"], 2)
            self.assertTrue(manifest["properties"]["free"])
            for section in ("model", "animation"):
                for path in manifest["files"]["player"][section].values():
                    self.assertIn(path, files)
            for path in manifest["files"]["player"]["texture"]:
                self.assertEqual(build.png_dimensions(files[path]), (64, 64))
            geometry = json.loads(files["models/main.json"])
            names = set(build.validate_geometry(geometry)["boneNames"])
            self.assertTrue({"Head", "RightHandLocator", "LeftHandLocator", "RightItem", "LeftItem"} <= names)
            for path in manifest["files"]["player"]["animation"].values():
                for animation in json.loads(files[path])["animations"].values():
                    self.assertFalse(set(animation.get("bones", {})) - names)
            self.assertGreater(summary["main"]["cubes"], 40)

    def test_visible_character_features_and_follow_bones(self):
        import json
        expected = {"qiandengji_naruto": {"QD_NarutoHair": "Head", "QD_NarutoHeadband": "Head",
                                          "QD_NarutoKunaiPouch": "RightLeg"},
                    "qiandengji_kirito": {"QD_KiritoBackSword": "UpperBody",
                                          "QD_KiritoLeftCoat": "LeftLeg", "QD_KiritoRightCoat": "RightLeg"}}
        for name, mapping in expected.items():
            geometry = json.loads(self.models[name][0]["models/main.json"])
            bones = {b["name"]: b for b in geometry["minecraft:geometry"][0]["bones"]}
            for feature, parent in mapping.items():
                self.assertEqual(bones[feature]["parent"], parent)
                self.assertTrue(bones[feature]["cubes"])

    def test_invalid_geometry_rejected(self):
        import json
        original = json.loads(self.models[build.MODEL_NAMES[0]][0]["models/main.json"])
        for problem in ("cycle", "missing_parent", "duplicate", "nan", "uv"):
            bad = copy.deepcopy(original)
            bones = bad["minecraft:geometry"][0]["bones"]
            if problem == "cycle": bones[0]["parent"] = bones[-1]["name"]
            elif problem == "missing_parent": bones[-1]["parent"] = "nonexistent"
            elif problem == "duplicate": bones[-1]["name"] = bones[0]["name"]
            elif problem == "nan": bones[-1]["cubes"][0]["size"][0] = float("nan")
            else: bones[-1]["cubes"][0]["uv"]["north"]["uv"] = [65, 0]
            with self.subTest(problem=problem), self.assertRaises(ValueError):
                build.validate_geometry(bad)

    def test_deploy_hashes_and_refuse_foreign_or_edited_content(self):
        files = self.models[build.MODEL_NAMES[0]][0]
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / build.MODEL_NAMES[0]
            build.write_owned(folder, files)
            build.write_owned(folder, files)
            build.verify_tree(folder, files)
            (folder / "models/main.json").write_text("user edited")
            with self.assertRaises(ValueError): build.write_owned(folder, files)
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / build.MODEL_NAMES[0]
            folder.mkdir()
            (folder / "foreign.txt").write_text("user content")
            with self.assertRaises(ValueError): build.write_owned(folder, files)
            self.assertEqual((folder / "foreign.txt").read_text(), "user content")

    def test_no_private_or_server_files_in_payload(self):
        for files, _ in self.models.values():
            for path, content in files.items():
                self.assertNotIn("auth/", path)
                self.assertNotIn("cache/", path)
                self.assertNotIn("skinValue", content.decode("utf-8", errors="ignore"))
                self.assertNotIn("skinSig", content.decode("utf-8", errors="ignore"))
            self.assertNotIn("skins.json", files)


if __name__ == "__main__":
    unittest.main(verbosity=2)
