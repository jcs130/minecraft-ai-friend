import importlib.util
import json
from pathlib import Path
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("web_state_map", ROOT / "tools/build_web_state_map.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TranslationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dump = json.loads((ROOT / "server/mc/block-registry.json").read_text())
        cls.vanilla = json.loads(module.CANONICAL_BLOCKS.read_text())
        cls.result = module.build_map(cls.dump, cls.vanilla, "registry", "canonical")
        cls.mapping = dict(cls.result["mappings"])

    def test_real_registry_all_vanilla_states_have_property_exact_or_declared_fallback(self):
        lookup = {"minecraft:" + b["name"]: dict(module.canonical_states(b)) for b in self.vanilla}
        fallback = {r["serverStateId"]: r for r in self.result["fallbacks"]}
        count = 0
        for row in self.dump["blockStates"]:
            if not row["block"].startswith("minecraft:"):
                self.assertNotIn(row["stateId"], self.mapping)
                continue
            count += 1
            target = self.mapping[row["stateId"]]
            if row["stateId"] not in fallback:
                self.assertEqual(lookup[row["block"]][target], module.normalized_properties(row.get("properties") or {}))
            else:
                self.assertEqual(row["block"], "minecraft:note_block")
                self.assertTrue(row["properties"]["instrument"].startswith("SPAWN"))
        self.assertEqual(count, 26834)
        self.assertEqual(len(fallback), 150)

    def test_shifted_chest_rail_and_stairs_keep_properties(self):
        for name in ("chest", "rail", "oak_stairs", "white_bed"):
            b = next(b for b in self.vanilla if b["name"] == name)
            actual = next(b for b in self.dump["blocks"] if b["name"] == "minecraft:" + name)
            self.assertEqual(self.mapping[actual["minStateId"]], b["minStateId"])
            self.assertEqual(self.mapping[actual["maxStateId"]], b["maxStateId"])

    def test_note_extra_states_never_use_offset_as_another_block(self):
        default = next(b["defaultState"] for b in self.vanilla if b["name"] == "note_block")
        self.assertEqual({r["canonicalStateId"] for r in self.result["fallbacks"]}, {default})

    def test_bool_true_precedes_false_and_enum_case_is_normalized(self):
        block = {"minStateId": 10, "maxStateId": 13, "states": [
            {"name": "side", "type": "enum", "num_values": 2, "values": ["a", "b"]},
            {"name": "powered", "type": "bool", "num_values": 2}]}
        self.assertEqual(module.canonical_states(block)[0], (10, (("powered", "true"), ("side", "a"))))
        self.assertEqual(module.normalized_properties({"side": "B", "powered": "false"}), module.canonical_states(block)[3][1])

    def test_duplicate_runtime_ids_fail_closed(self):
        dump = {**self.dump, "blockStates": [self.dump["blockStates"][0]] * 2}
        with self.assertRaisesRegex(ValueError, "duplicate"):
            module.build_map(dump, self.vanilla, "x", "y")

    def test_mod_range_cannot_alias_vanilla(self):
        dump = {**self.dump, "blocks": [{"name": "test:collision", "minStateId": 10, "maxStateId": 12, "defaultState": 10}]}
        with self.assertRaisesRegex(ValueError, "overlaps"):
            module.build_map(dump, self.vanilla, "x", "y")

    def test_legacy_atlas_coordinates_match_real_texture_pixels(self):
        # Check actual UV output and PNG as a pair; transparent RGB bytes may
        # differ after canvas premultiplication but visible colour must match.
        public = ROOT / "world/node_modules/prismarine-viewer/public"
        atlas = Image.open(public / "textures/1.21.1.png").convert("RGBA")
        blocks = json.loads((public / "blocksStates/1.21.1.json").read_text())
        for block, texture in [("stone", "stone"), ("dirt", "dirt"), ("oak_planks", "oak_planks"),
                               ("grass_block", "grass_block_top"), ("glass", "glass")]:
            variant = next(iter(blocks[block]["variants"].values()))
            if isinstance(variant, list):
                variant = variant[0]
            uv = variant["model"]["textures"]["top" if block == "grass_block" else "all"]
            x, y = round(uv["u"] * atlas.width), round(uv["v"] * atlas.height)
            tile = atlas.crop((x, y, x + 16, y + 16))
            original = Image.open(public / f"textures/1.21.1/blocks/{texture}.png").convert("RGBA")
            for py in range(16):
                for px in range(16):
                    a, b = tile.getpixel((px, py)), original.getpixel((px, py))
                    self.assertEqual(a[3], b[3], block)
                    if b[3]:
                        self.assertEqual(a, b, block)


if __name__ == "__main__":
    unittest.main()
