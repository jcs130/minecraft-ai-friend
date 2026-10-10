"""Read-only Create source/API audit; optional independent server-wire checks.

Set MAW_RECIPE_AUDIT_ROOT to the private lab root. No server/bootstrap/network,
random rolls, model requests, installation, or game actions are performed.
MAW_RECIPE_CAPTURE can point to private recipe query JSON captured by the owner.
"""

from pathlib import Path
import hashlib
import importlib.util
import json
import os
import re
import struct
import subprocess
import tempfile
import unittest
import zipfile


REPO = Path(__file__).resolve().parents[1]
SOURCE = REPO / "world/society-bridge-src/src/main/java/dev/qiandeng/maw/PlayerRecipeCatalog.java"
PIN = "ef87fe5709f1ba1f5b8bb20a2925b5afb4669e178fd6d8bf10c167759eefe37a"
KINDS = {"create:milling", "create:crushing", "create:cutting", "create:pressing", "create:filling", "create:emptying"}


def captured_rows(value):
    """Find recipe rows without printing unrelated private capture contents."""
    pending = [value]
    for _ in range(100000):
        if not pending:
            return
        row = pending.pop()
        if isinstance(row, dict):
            if "recipeId" in row and "definitionAvailable" in row:
                yield row
            pending.extend(row.values())
        elif isinstance(row, list):
            pending.extend(row)
    raise ValueError("recipe capture traversal budget exceeded")


@unittest.skipUnless(os.environ.get("MAW_RECIPE_AUDIT_ROOT"), "private locked source/API root not selected")
class CreateRecipeCatalogAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = Path(os.environ["MAW_RECIPE_AUDIT_ROOT"]) / "server"
        cls.jar = cls.server / "mods/create-1.21.1-6.0.10.jar"
        cls.java = Path(os.environ.get("MAW_RECIPE_AUDIT_JAVA", "E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe"))

    def recipe(self, name):
        with zipfile.ZipFile(self.jar) as archive:
            return json.loads(archive.read("data/create/recipe/" + name + ".json"))

    def test_locked_create_jar_and_real_wheat_byproducts(self):
        self.assertEqual(hashlib.sha256(self.jar.read_bytes()).hexdigest(), PIN)
        wheat = self.recipe("milling/wheat")
        self.assertEqual(wheat["type"], "create:milling")
        self.assertEqual(wheat["ingredients"], [{"item": "minecraft:wheat"}])
        self.assertEqual(wheat["processing_time"], 150)
        self.assertEqual([(r["id"], r.get("count", 1), r.get("chance", 1)) for r in wheat["results"]],
                         [("create:wheat_flour", 1, 1), ("create:wheat_flour", 2, .25), ("minecraft:wheat_seeds", 1, .25)])

    def test_real_fluid_quantities_and_complex_component_boundary(self):
        filling = self.recipe("filling/honey_bottle")
        self.assertEqual(filling["ingredients"][1], {"type": "neoforge:tag", "amount": 250, "tag": "c:honey"})
        emptying = self.recipe("emptying/honey_bottle")
        self.assertEqual(emptying["results"], [{"id": "minecraft:glass_bottle"}, {"amount": 250, "id": "create:honey"}])
        potion = self.recipe("filling/glowstone")["ingredients"][1]
        self.assertEqual(potion["type"], "neoforge:components")
        self.assertEqual(potion["amount"], 25)
        self.assertEqual(potion["components"]["minecraft:potion_contents"]["potion"], "minecraft:night_vision")
        # The custom component predicate must not become a bare potion fluid ID.
        self.assertEqual(potion["components"]["create:potion_fluid_bottle_type"], "regular")

    def test_actual_catalog_compiles_and_cannot_sample_processing_results(self):
        spec = importlib.util.spec_from_file_location("recipe_audit_cp", REPO / "world/botgate-src/build.py")
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        mods = self.server / "mods"
        cp = os.pathsep.join([helper.full_cp(self.server / "libraries"),
                              os.environ.get("MAW_NATIVE_AUDIT_JAR", str(mods / "maw_agent_bridge-0.1.0.jar")), str(self.jar),
                              str(mods / "ponder-neoforge-1.0.82+mc1.21.1.jar"),
                              str(mods / "FarmersDelight-1.21.1-1.3.4.jar")])
        with tempfile.TemporaryDirectory(prefix="create-recipe-api-audit-") as temporary:
            compile_result = subprocess.run([str(self.java.with_name("javac.exe")), "-proc:none", "--release", "21", "-encoding", "UTF-8",
                                             "-cp", cp, "-d", temporary, str(SOURCE)], capture_output=True, text=True, encoding="utf-8", timeout=90)
            self.assertEqual(compile_result.returncode, 0, compile_result.stderr[-4000:])
            result = subprocess.run([str(self.java.with_name("javap.exe")), "-classpath", temporary, "-p", "-c", "dev.qiandeng.maw.PlayerRecipeCatalog"],
                                    capture_output=True, text=True, encoding="utf-8", timeout=30)
            self.assertEqual(result.returncode, 0)
            calls = re.findall(r"// (?:InterfaceMethod|Method) ([^\r\n]+)", result.stdout)
            self.assertFalse(any(re.search(r"(?:rollResults|rollOutput|RandomSource|nextFloat|nextInt|enforceNextResult)", call) for call in calls),
                             "Read-only definition projection must never consume a random result or force one")
            self.assertTrue(any("ProcessingRecipe.getRollableResults:" in call for call in calls))
            self.assertTrue(any("ProcessingRecipe.getFluidResults:" in call for call in calls))
            self.assertTrue(any("FluidStack.saveOptional:" in call for call in calls), "fluid components must survive projection")

    @unittest.skipUnless(os.environ.get("MAW_RECIPE_CAPTURE"), "no owner-captured loaded-server recipe response selected")
    def test_owner_captured_definitions_match_all_declared_source_results(self):
        rows = list(captured_rows(json.loads(Path(os.environ["MAW_RECIPE_CAPTURE"]).read_text(encoding="utf-8"))))
        checked = 0
        for row in rows:
            if row["type"] not in KINDS or row["definitionAvailable"] is not True:
                continue
            recipe_id = row["recipeId"]
            if not recipe_id.startswith("create:"):
                continue
            raw = self.recipe(recipe_id.removeprefix("create:"))
            with self.subTest(recipe=recipe_id):
                self.assertNotIn("output", row, "single display result is not a complete Create output")
                self.assertIs(row["executionAvailable"], False)
                processing = row["processing"]
                for flag in ("randomResultsSampled", "dynamicHandlersIncluded", "recipeSelectionPriorityVerified", "machineExecutionVerified", "fluidHandlingAvailable"):
                    self.assertIs(processing[flag], False)
                self.assertEqual(processing["processingDurationTicks"], raw.get("processing_time", 0))
                expected = [r for r in raw["results"] if "amount" not in r]
                actual = processing["rollableResults"]
                self.assertEqual(len(actual), len(expected))
                for exported, declared in zip(actual, expected):
                    self.assertEqual(exported["item"]["id"], declared["id"])
                    self.assertEqual(exported["item"]["count"], declared.get("count", 1))
                    self.assertEqual(struct.pack("f", exported["baseChancePerItem"]), struct.pack("f", declared.get("chance", 1)))
                    self.assertIn("snbt", exported["item"])
                for ingredient in row["ingredients"]:
                    self.assertEqual(ingredient["requiredCount"], 1)
                    self.assertIn("nativeIngredient", ingredient)
                expected_fluids = [r for r in raw["results"] if "amount" in r]
                self.assertEqual([(r["id"], r["amount"]) for r in processing["fluidResults"]], [(r["id"], r["amount"]) for r in expected_fluids])
                for fluid in processing["fluidResults"]:
                    self.assertEqual(fluid["amountUnit"], "mB")
                    self.assertIn("nativeFluidStack", fluid); self.assertIn("snbt", fluid)
                expected_inputs = [r for r in raw["ingredients"] if "amount" in r]
                self.assertEqual([r["requiredAmount"] for r in processing["fluidInputs"]], [r["amount"] for r in expected_inputs])
                for fluid in processing["fluidInputs"]:
                    self.assertIn("nativeIngredient", fluid)
                    for option in fluid["alternatives"]:
                        self.assertEqual(option["amount"], fluid["requiredAmount"])
                        self.assertIn("nativeFluidStack", option); self.assertIn("snbt", option)
                checked += 1
        self.assertGreater(checked, 0, "capture did not contain an accepted locked Create definition")


if __name__ == "__main__":
    unittest.main()
