"""Offline builder and generated registry/asset integrity checks."""
import base64
from collections import defaultdict
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("web_assets", ROOT / "tools/build_web_mod_assets.py")
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class BuilderTests(unittest.TestCase):
    def test_enum_serialization_and_radix_order(self):
        rows = [(10 + i, {"connection": ["BASE", "MIDDLE_NS"][i // 2], "waterlogged": ["true", "false"][i % 2]}) for i in range(4)]
        states = builder.infer_states(rows)
        self.assertEqual([s["name"] for s in states], ["connection", "waterlogged"])
        self.assertEqual(states[0]["values"], ["base", "middle_ns"])

    def test_inexact_or_non_contiguous_states_rejected(self):
        for rows in ([(0, {}), (1, {})], [(0, {}), (2, {})],
                     [(0, {"x": "a"}), (1, {"x": "b"}), (2, {"x": "a"})]):
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                builder.infer_states(rows)

    def test_child_texture_binding_and_unused_parent_placeholder(self):
        assets = builder.Assets.__new__(builder.Assets)
        assets.model_cache = {}
        rows = {"test:block/parent": {"textures": {"used": "#replace", "unused": "#absent"},
                "elements": [{"from": [0,0,0], "to": [16,16,16], "faces": {"up": {"texture": "#used"}}}]},
                "test:block/child": {"parent": "test:block/parent", "textures": {"replace": "minecraft:block/gold_block"}}}
        assets.raw_model = lambda ref: deepcopy(rows.get(ref))
        assets.texture_exists = lambda ref: ref == "minecraft:block/gold_block"
        model = assets.final_model("test:block/child")
        self.assertEqual(model["textures"], {"used": "block/gold_block"})

    def test_loader_and_parent_cycle_are_not_claimed_as_supported(self):
        for row in ({"loader": "test:dynamic"}, {"parent": "test:block/bad"}):
            assets = builder.Assets.__new__(builder.Assets)
            assets.model_cache = {}
            assets.raw_model = lambda ref: row
            with self.subTest(row=row), self.assertRaises(ValueError):
                assets.final_model("test:block/bad")

    def test_first_declared_texture_frame_is_extracted(self):
        original = Image.new("RGBA", (16,32), (255,0,0,255))
        original.paste((0,0,255,255), (0,16,16,32))
        stream = io.BytesIO()
        original.save(stream, format="PNG")
        url, animated = builder.image_data(stream.getvalue(), {"animation": {"frames": [{"index": 1}]}})
        decoded = Image.open(io.BytesIO(base64.b64decode(url.split(",",1)[1])))
        self.assertTrue(animated)
        self.assertEqual(decoded.size, (16,16))
        self.assertEqual(decoded.getpixel((0,0)), (0,0,255,255))

    def test_resource_path_traversal_rejected(self):
        for ref in ("test:../escape", "../escape", "test:a\\b", "bad space:foo"):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                builder.canonical(ref)


class GeneratedAssetsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        base = ROOT / "vendor/modern-viewer/mod-assets"
        cls.pack = json.loads((base / "mod-pack.json").read_text(encoding="utf8"))
        cls.table = json.loads((base / "mod-blocks-mcdata.json").read_text(encoding="utf8"))
        cls.report = json.loads((base / "compatibility-report.json").read_text(encoding="utf8"))
        cls.dump = json.loads((ROOT / "server/mc/block-registry.json").read_text(encoding="utf8"))

    def test_every_current_mod_state_replays_exactly_and_defaults_match(self):
        lookup = {b["name"]: b for b in self.table["blocks"]}
        default = {b["name"]: b for b in self.dump["blocks"]}
        seen = 0
        for row in self.dump["blockStates"]:
            if row["block"].startswith("minecraft:"):
                continue
            entry = lookup[row["block"]]
            offset, properties = row["stateId"] - entry["minStateId"], {}
            for state in reversed(entry["states"]):
                properties[state["name"]] = state["values"][offset % state["num_values"]]
                offset //= state["num_values"]
            self.assertEqual(properties, {k: str(v).lower() for k,v in row["properties"].items()})
            self.assertEqual(entry["defaultState"], default[row["block"]]["defaultState"])
            seen += 1
        self.assertEqual(seen, 89816)
        self.assertEqual(len(lookup), 3276)
        self.assertFalse(any(name.startswith("settlements:") for name in lookup))

    def test_live_registry_mirror_is_byte_identical(self):
        source = (ROOT / "server/mc/block-registry.json").read_bytes()
        mirror = (ROOT / "server/world-data/block-registry.json").read_bytes()
        self.assertEqual(source, mirror)
        self.assertEqual(builder.digest(source), self.report["registry"]["sha256"])

    def test_every_block_model_ref_resolves_or_is_explicit_fallback(self):
        for name, state in self.pack["blockstates"].items():
            refs = list(builder.model_refs(state))
            self.assertTrue(refs, name)
            for ref in refs:
                self.assertTrue(ref.startswith("minecraft:") or ref in self.pack["models"], ref)
        for entry in self.report["unsupportedBlocks"]:
            self.assertEqual(self.pack["blockstates"][entry["block"]], {"variants": {"": {"model": builder.FALLBACK}}})

    def test_mod_texture_refs_reach_real_png_atlas_entries(self):
        assets = builder.Assets()
        assets.raw_models = self.pack["models"]
        original_exists = assets.texture_exists
        assets.texture_exists = lambda ref: original_exists(ref) if ref.startswith("minecraft:") else ref.replace("block/", "", 1).replace("blocks/", "", 1) in self.pack["textures"]
        try:
            refs = {ref for state in self.pack["blockstates"].values() for ref in builder.model_refs(state)}
            for ref in refs:
                self.assertTrue(assets.final_model(ref), ref)
        finally:
            assets.vanilla.close()
        for atlas in ("textures", "itemTextures"):
            for ref, url in self.pack[atlas].items():
                self.assertTrue(url.startswith("data:image/png;base64,"), ref)
                image = Image.open(io.BytesIO(base64.b64decode(url.split(",",1)[1])))
                image.verify()

    def test_staff_models_retain_real_geometry_and_vanilla_materials(self):
        for staff, count in (("whispering_staff",5), ("resonance_staff",7)):
            model = self.pack["models"]["qiandeng_chanting:" + staff]
            self.assertEqual(len(model["elements"]), count)
            self.assertEqual(model["parent"], "block/block")
            self.assertTrue(all(v.startswith("block/") for v in model["textures"].values()))
            self.assertTrue(model["display"]["firstperson_righthand"])

    def test_sources_and_character_limit_are_reported_truthfully(self):
        self.assertEqual(self.report["jarCounts"], {"server":71,"client":87})
        self.assertEqual(self.report["assetConflicts"], [])
        self.assertTrue(all(j["zipVerified"] for j in self.report["jars"]))
        chars = self.report["characters"]
        self.assertFalse(chars["ysmWebPlayback"])
        self.assertFalse(chars["actualWebGlbLoadTested"])
        for stem in ("naruto-uzumaki-shippuden", "kirito-black-swordsman"):
            info = builder.glb_info(ROOT / "vendor/modern-viewer/character-assets/characters" / (stem + ".glb"))
            self.assertTrue(info["validGlbStructure"])

    def test_public_summary_is_bounded_and_has_no_source_paths(self):
        summary = builder.public_summary(self.report)
        self.assertEqual(set(summary), {"schema", "generatedAt", "stats", "jarCounts", "registry", "staffItems", "ysmWebPlayback", "limits", "budget"})
        self.assertEqual(summary["budget"]["workers"], 1)
        self.assertEqual(summary["budget"]["maximumPackBytes"], 20 * 1024 * 1024)
        self.assertEqual(set(summary["registry"]), {"generatedAt", "sha256"})
        self.assertTrue(all(set(row) == {"id", "status"} for row in summary["staffItems"]))
        data = json.dumps(summary, ensure_ascii=False).encode("utf8")
        self.assertLess(len(data), 16 * 1024)
        self.assertNotIn(b"sourceManifest", data)
        self.assertNotIn(b"C:/", data)

    def test_startup_payload_and_worker_budget_are_bounded(self):
        self.assertLess((ROOT / "vendor/modern-viewer/mod-assets/mod-pack.json").stat().st_size, 20 * 1024 * 1024)
        self.assertEqual(self.pack["stats"]["itemModels"], 2)
        self.assertGreater(self.pack["stats"]["deferredItemModels"], 3000)
        self.assertEqual(self.pack["itemTextures"], {})
        self.assertEqual(self.report["bridge"]["workers"], 1)
        self.assertFalse(self.report["bridge"]["errorHandlersSuppressed"])


if __name__ == "__main__":
    unittest.main()
