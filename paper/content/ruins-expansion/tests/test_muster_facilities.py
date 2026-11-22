import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zlib

import nbtlib
from nbtlib import Byte, Compound, Int, List, String
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apply_access import replacement_chunk, state_tag
from apply_ground_musters import read_plan
from plan_ground_musters import facility_layout, plan


class FlatTerrain:
    def sections(self, cx, cz):
        return {4: None}

    def read(self, x, y, z):
        return "minecraft:stone" if y == 64 else "minecraft:air"


class MusterFacilitiesTest(unittest.TestCase):
    def test_layout_keeps_landing_and_button_and_requires_all_facilities(self):
        terrain = FlatTerrain()
        layout, edits = plan(terrain, {"forest": {"name": "森林"}}, (0, 0), [])
        station = layout["platforms"]["forest"]
        points = list(station["station"]["facilities"].values())
        self.assertEqual(len(points), 5)
        self.assertTrue(all(abs(x) == 3 and y == 65 for x, y, _ in points))
        self.assertEqual(station["entry"], [0, 65, -3])
        self.assertEqual(station["station"]["button"], [0, 65, 2])
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "dungeon-muster.yml").write_text(yaml.safe_dump(layout), encoding="utf-8")
            path = root / "muster-block-plan.json"
            path.write_text(json.dumps(edits), encoding="utf-8")
            read_plan(path, terrain)
            right = station["station"]["facilities"]["sharedChestOtherHalf"]
            edits["changes"] = [row for row in edits["changes"] if row["at"] != right]
            path.write_text(json.dumps(edits), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "incomplete public facilities"):
                read_plan(path, terrain)

    def test_chunk_retains_existing_items_and_creates_empty_public_storage(self):
        items = List[Compound]([Compound({"id": String("minecraft:iron_ingot"), "count": Int(7), "Slot": Byte(0)})])
        existing = Compound({"id": String("minecraft:chest"), "x": Int(2), "y": Int(65), "z": Int(2), "Items": items})

        class SavedTerrain(FlatTerrain):
            def chunk(self, cx, cz):
                return nbtlib.File({"DataVersion": Int(3955), "Status": String("minecraft:full"),
                                    "sections": List[Compound]([Compound({"Y": Byte(4), "block_states": Compound({
                                        "palette": List[Compound]([state_tag("minecraft:air")])})})]),
                                    "block_entities": List[Compound]([existing])})

        positions = facility_layout(4, 65, 4)
        rows = [(*pos, "minecraft:air", state) for key, (pos, state) in positions.items() if key != "sign"]
        record = replacement_chunk(SavedTerrain(), (0, 0), rows, [])
        saved = nbtlib.File.parse(io.BytesIO(zlib.decompress(record[5:])))["block_entities"]
        self.assertEqual(saved[0], existing)
        self.assertCountEqual([str(row["id"]) for row in saved[1:]],
                              ["minecraft:chest", "minecraft:chest", "minecraft:furnace"])
        self.assertTrue(all(not row["Items"] and "LootTable" not in row for row in saved[1:]))
        with self.assertRaisesRegex(ValueError, "existing block entity"):
            replacement_chunk(SavedTerrain(), (0, 0), [(2, 65, 2, "minecraft:air", "minecraft:furnace")], [])
