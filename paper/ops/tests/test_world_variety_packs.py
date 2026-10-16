import gzip
import hashlib
import importlib.util
import json
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("builder", Path(__file__).parents[1]/"build-world-variety-packs.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


class CompatibilityTests(unittest.TestCase):
    def test_gson_comments_do_not_change_strings(self):
        self.assertEqual(b.loads('{/* comment */"url":"https://test/a,//}","list":[1,],}'),
                         {"url": "https://test/a,//}", "list": [1]})

    def test_exact_version_ranges_and_ambiguous_choices(self):
        self.assertEqual(b.versioned_location({"1.21-1.21.1": "old", "1.21.2-1.21.11": "new"}), "old")
        with self.assertRaises(ValueError):
            b.versioned_location({"1.21.2-1.21.11": "new"})
        with self.assertRaises(ValueError):
            b.versioned_location({"1.21-1.21.1": "a", "1.21.1-1.21.4": "b"})

    def test_stair_orientation_survives_material_swap(self):
        states = {name: [{"facing": f, "half": "top", "waterlogged": False}
                         for f in ("east", "west")] for name in ("minecraft:oak_stairs", "minecraft:stone_brick_stairs")}
        processor = b.block_swap_rules({"minecraft:oak_stairs": "minecraft:stone_brick_stairs"}, states)
        self.assertEqual(processor["rules"][1]["output_state"]["Properties"],
                         {"facing": "west", "half": "top", "waterlogged": "false"})
        with self.assertRaises(ValueError):
            b.block_swap_rules({"minecraft:oak_stairs": "mod:stairs"}, states)

    def test_unknown_codec_and_nether_search_are_rejected(self):
        for kind in ("mod:invented", "mod:generic_nether_jigsaw_structure"):
            with self.assertRaises(ValueError):
                b.rewrite_codec({"type": kind}, "jigsaw", {}, [], "fixture")

    def test_sky_height_and_full_pool_are_preserved(self):
        before = {"type": "mss:mss_generic_jigsaw_structure", "start_pool": "mss:castle",
                  "size": 3, "start_height": {"absolute": 160}, "terrain_adaptation": "none"}
        after = b.rewrite_codec(before, "jigsaw", {}, [], "fixture")
        self.assertEqual(after["type"], "minecraft:jigsaw")
        self.assertEqual(after["start_height"], {"absolute": 160})
        self.assertEqual(after["start_pool"], "mss:castle")
        self.assertEqual(before["type"], "mss:mss_generic_jigsaw_structure")

    def test_binary_nbt_namespace_rewrite_preserves_numbers(self):
        def s(value):
            raw = value.encode(); return struct.pack(">H", len(raw))+raw
        data = b"\x0a"+s("")+b"\x08"+s("LootTable")+s("nova_structures:castle")+b"\x03"+s("x")+struct.pack(">i", -534)+b"\0"
        changed = gzip.decompress(b.rewrite_nbt_namespace(gzip.compress(data), "nova_structures", "qd_end_castle"))
        self.assertIn(s("qd_end_castle:castle"), changed)
        self.assertIn(struct.pack(">i", -534), changed)
        self.assertNotIn(b"nova_structures", changed)
        with self.assertRaises(ValueError):
            b.rewrite_nbt_namespace(data[:-1], "a", "b")

    def test_current_loot_and_advancement_schema(self):
        value = b.current_schema({"type": "minecraft:loot_table", "name": "minecraft:test",
                                  "display": {"icon": {"item": "minecraft:book"}},
                                  "functions": [{"function": "#minecraft:enchant_with_levels", "treasure": True}]})
        self.assertEqual(value["value"], "minecraft:test")
        self.assertEqual(value["display"]["icon"]["id"], "minecraft:book")
        self.assertEqual(value["functions"][0]["function"], "minecraft:enchant_with_levels")
        self.assertEqual(value["functions"][0]["options"], "#minecraft:on_random_loot")

    def test_temporary_blueprint_removes_only_root_entities(self):
        def s(text):
            raw=text.encode();return struct.pack(">H",len(raw))+raw
        entity=b"\x08"+s("id")+s("minecraft:armor_stand")+b"\0"
        original=b"\x0a"+s("")+b"\x09"+s("entities")+b"\x0a"+struct.pack(">i",1)+entity+b"\x03"+s("DataVersion")+struct.pack(">i",3955)+b"\0"
        stripped=b.rewrite_nbt_namespace(original,"unused","unused",strip_template_entities=True)
        self.assertNotIn(b"armor_stand",stripped)
        self.assertIn(b"\x09"+s("entities")+b"\x0a\0\0\0\0",stripped)
        self.assertIn(struct.pack(">i",3955),stripped)
        self.assertEqual(b.rewrite_nbt_namespace(original,"unused","unused"),original)

    def test_source_integrity_and_archive_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)/"bad.zip"
            with zipfile.ZipFile(p, "w") as z:
                z.writestr("../escape", "bad")
            with self.assertRaises(ValueError):
                b.read_pack(p)
            with self.assertRaises(ValueError):
                b.build_pack({"slug": "bad", "local": str(p), "sha256": "0"*64}, {})

    def test_ctov_java_injected_placements_are_restored(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/"ctov.zip"
            with zipfile.ZipFile(p,"w") as z:
                for sid in ["small/village_plains","small/village_underground","pillager_outpost_plains"]:
                    z.writestr("data/ctov/worldgen/structure/"+sid+".json",json.dumps({"type":"minecraft:jigsaw"}))
            row={"slug":"ctov","version":"fixture","source":"fixture","local":str(p),"sha256":hashlib.sha256(p.read_bytes()).hexdigest(),
                 "profile":"ctov","manualOnlyStructures":["ctov:small/village_underground"]}
            entries,report=b.build_pack(row,{})
            self.assertEqual(report["villageEntries"],[{"structure":"ctov:small/village_plains","weight":1}])
            native=json.loads(entries["data/ctov/worldgen/structure_set/qiandengji_outposts.json"])
            self.assertEqual(native["structures"][0]["structure"],"ctov:pillager_outpost_plains")
            self.assertIn("data/ctov/worldgen/structure/small/village_underground.json",entries)

    def test_cloned_capital_buildings_keep_natural_placements(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/"capitals.zip"
            with zipfile.ZipFile(p,"w") as z:
                for sid in ["pillager_outpost","swamp_hut"]:
                    z.writestr("data/minecraft/worldgen/structure/"+sid+".json",json.dumps({"type":"minecraft:jigsaw"}))
            entries,_=b.build_pack({"slug":"capitals","version":"fixture","source":"fixture","local":str(p),"sha256":hashlib.sha256(p.read_bytes()).hexdigest(),
                                   "cloneVanillaStructures":True},{})
            for sid in ["pillager_outpost","swamp_hut"]:
                value=json.loads(entries["data/qiandeng_capitals/worldgen/structure_set/"+sid+".json"])
                self.assertEqual(value["structures"][0]["structure"],"qiandeng_capitals:"+sid)
                self.assertNotIn("data/minecraft/worldgen/structure/"+sid+".json",entries)

    def test_zip_output_is_reproducible_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as directory:
            a, c = Path(directory)/"a.zip", Path(directory)/"b.zip"
            entries = {"data/a/function/example.mcfunction": b"# test\n", "pack.mcmeta": b"{}"}
            self.assertEqual(b.write_zip(a, entries), b.write_zip(c, dict(reversed(list(entries.items())))))
            with self.assertRaises(FileExistsError):
                b.write_zip(a, entries)


if __name__ == "__main__":
    unittest.main()
