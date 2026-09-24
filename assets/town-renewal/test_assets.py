import copy
import unittest

from generate import house, market, native_structure
from validate import validate_files, validate_structure


class AssetTests(unittest.TestCase):
    def setUp(self):
        blocks, self.info = house()
        self.data = native_structure(blocks, self.info["size"])

    def rejects(self, data, reason):
        with self.assertRaisesRegex(ValueError, reason):
            validate_structure(data, self.info)

    def test_committed_assets_roundtrip_hashes_and_materials(self):
        self.assertEqual(set(validate_files()), {"market-courtyard", "courtyard-house"})

    def test_five_flat_beds_reachable_through_wood_door(self):
        result = validate_structure(self.data, self.info)
        self.assertEqual((result["beds"], result["doors"]), (5, 1))
        self.assertGreater(result["reachableGroundCells"], 50)

    def test_market_three_wide_throughway(self):
        blocks, info = market()
        self.assertTrue(validate_structure(native_structure(blocks, info["size"]), info)["centralPathClear"])

    def test_duplicate_position_rejected(self):
        self.data["blocks"].append(copy.deepcopy(self.data["blocks"][0]))
        self.rejects(self.data, "duplicate position")

    def test_container_and_air_rejected(self):
        for name in ("minecraft:chest", "minecraft:air", "minecraft:command_block", "mod:stone"):
            with self.subTest(name=name):
                data = copy.deepcopy(self.data)
                data["palette"][0] = {"Name": name}
                self.rejects(data, "reviewed material|non-vanilla")

    def test_block_entity_payload_rejected(self):
        self.data["blocks"][0]["nbt"] = {"Items": []}
        self.rejects(self.data, "block NBT")

    def test_entity_payload_rejected(self):
        self.data["entities"] = [{"nbt": {"id": "minecraft:villager"}}]
        self.rejects(self.data, "entities must be empty")

    def test_out_of_bounds_and_invalid_state_rejected(self):
        self.data["blocks"][0]["pos"] = [13, 0, 0]
        self.rejects(self.data, "outside size")
        self.data["blocks"][0]["pos"] = [0, 0, 0]
        self.data["blocks"][0]["state"] = 999
        self.rejects(self.data, "palette index")

    def test_missing_bed_head_rejected(self):
        self.data["blocks"] = [cell for cell in self.data["blocks"] if cell["pos"] != [3, 1, 3]]
        self.rejects(self.data, "orphan or inconsistent bed")

    def test_missing_upper_door_rejected(self):
        self.data["blocks"] = [cell for cell in self.data["blocks"] if cell["pos"] != [6, 2, 9]]
        self.rejects(self.data, "orphan or inconsistent door")

    def test_path_blocked_rejected(self):
        self.data["blocks"].append({"pos": [6, 1, 6], "state": 0})
        self.rejects(self.data, "central path")

    def test_low_bed_ceiling_rejected(self):
        self.data["blocks"].append({"pos": [3, 3, 3], "state": 0})
        self.rejects(self.data, "bed headroom")


if __name__ == "__main__":
    unittest.main()
