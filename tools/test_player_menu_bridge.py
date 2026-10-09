"""Compile and audit ordinary-player menu contracts; no server startup or inventory operation."""

from pathlib import Path
import importlib.util
import os
import re
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
SOURCE = REPO / "world/society-bridge-src/src/main/java"
TEST = REPO / "world/society-bridge-src/src/test/java/dev/qiandeng/maw/MenuActionReplayTest.java"


@unittest.skipUnless(os.environ.get("MAW_MENU_AUDIT_ROOT"), "private locked menu API root not selected")
class PlayerMenuBridgeAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(os.environ["MAW_MENU_AUDIT_ROOT"])
        cls.java = Path(os.environ.get("MAW_MENU_AUDIT_JAVA", "E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe"))
        spec = importlib.util.spec_from_file_location("menu_audit_cp", REPO / "world/botgate-src/build.py")
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        cls.cp = os.pathsep.join([helper.full_cp(root / "server/libraries"),
                                 *(str(path) for path in sorted((root / "server/mods").glob("*.jar"))),
                                 str(root / "build/numen-0.1.4.1/numen_api.jar")])

    def run_java(self, arguments):
        result = subprocess.run(arguments, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
        self.assertEqual(result.returncode, 0, result.stderr[-5000:])
        return result.stdout

    def test_large_repeated_recipe_alternatives_remain_lossless_under_wire_budget(self):
        with tempfile.TemporaryDirectory(prefix="recipe-ingredient-codec-") as temporary:
            self.run_java([str(self.java.with_name("javac.exe")), "-proc:none", "--release", "21", "-encoding", "UTF-8",
                           "-cp", self.cp, "-d", temporary,
                           str(SOURCE / "dev/qiandeng/maw/RecipeIngredientEncoding.java"),
                           str(REPO / "world/society-bridge-src/src/test/java/dev/qiandeng/maw/RecipeIngredientEncodingTest.java")])
            output = self.run_java([str(self.java), "-cp", temporary + os.pathsep + self.cp,
                                    "dev.qiandeng.maw.RecipeIngredientEncodingTest"])
            self.assertRegex(output, r"RecipeIngredientEncoding 21 checks passed; rawBytes=39110; wireBytes=5461")

    def test_complete_menu_request_fingerprint_reservation_conflict_and_unknown_replay(self):
        with tempfile.TemporaryDirectory(prefix="menu-replay-contract-") as temporary:
            self.run_java([str(self.java.with_name("javac.exe")), "-proc:none", "--release", "21", "-encoding", "UTF-8",
                           "-cp", self.cp, "-d", temporary,
                           str(SOURCE / "dev/qiandeng/maw/ColonyActionReplay.java"),
                           str(SOURCE / "dev/qiandeng/maw/MenuActionReplay.java"), str(TEST)])
            output = self.run_java([str(self.java), "-cp", temporary + os.pathsep + self.cp,
                                    "dev.qiandeng.maw.MenuActionReplayTest"])
            self.assertRegex(output, r"MenuActionReplay \d+ checks passed")

    def test_real_bridge_compiles_and_reserves_before_native_mutation_then_caches_before_send(self):
        # Compile the actual sources and inspect resulting bytecode: this avoids
        # a mock PlayerMenuBridge accidentally passing different production code.
        with tempfile.TemporaryDirectory(prefix="menu-native-contract-") as temporary:
            quoted = lambda value: '"' + str(value).replace("\\", "/") + '"'
            args = Path(temporary) / "javac.args"
            args.write_text("\n".join(["-proc:none", "--release", "21", "-encoding", "UTF-8", "-cp", quoted(self.cp),
                                       "-d", quoted(temporary), *(quoted(path) for path in sorted(SOURCE.rglob("*.java")))]), encoding="utf-8")
            self.run_java([str(self.java.with_name("javac.exe")), "@" + str(args)])
            bytecode = self.run_java([str(self.java.with_name("javap.exe")), "-classpath", temporary, "-p", "-c",
                                      "dev.qiandeng.maw.PlayerMenuBridge"])
            handler = bytecode.split("private static void handleAction(", 1)[1].split("private static", 1)[0]
            calls = re.findall(r"// (?:InterfaceMethod|Method) ([^\r\n]+)", handler)
            reservation = next(i for i, call in enumerate(calls) if "MenuActionReplay.begin:" in call)
            click = next(i for i, call in enumerate(calls) if "AbstractContainerMenu.clicked:" in call)
            self.assertLess(reservation, click)
            self.assertEqual(sum("AbstractContainerMenu.clicked:" in call for call in calls), 1)
            self.assertTrue(any("AbstractContainerMenu.stillValid:" in call for call in calls[:click]))
            self.assertTrue(any("ItemStack.saveOptional:" in call for call in calls[:click]))
            self.assertTrue(any("AbstractContainerMenu.getStateId:" in call for call in calls[:click]))
            self.assertIn("action_outcome_unknown", handler)
            reply = bytecode.split("private static void reply(", 1)[1].split("private static void handleAction(", 1)[0]
            self.assertLess(reply.index("MenuActionReplay.complete:"), reply.index("Method send:"))
            for field in ("playerUuid", "action", "outcomeKnown", "receiptScope", "stateUnavailable"):
                self.assertIn(field, reply)
            self.assertFalse(any(re.search(r"(?:dispatchCommand|performPrefixedCommand|opPlayer)", call) for call in calls))

    def test_numen_durable_intent_survives_restart_without_replay(self):
        with tempfile.TemporaryDirectory(prefix="numen-native-receipt-") as temporary:
            self.run_java([str(self.java.with_name("javac.exe")), "-proc:none", "--release", "21", "-encoding", "UTF-8",
                           "-cp", self.cp, "-d", temporary,
                           str(SOURCE / "dev/qiandeng/maw/NumenBodyBridge.java"),
                           str(REPO / "world/society-bridge-src/src/test/java/dev/qiandeng/maw/NumenReceiptTest.java")])
            output = self.run_java([str(self.java), "-cp", temporary + os.pathsep + self.cp,
                                    "dev.qiandeng.maw.NumenReceiptTest"])
            self.assertIn("NumenReceipt 12 checks passed", output)


if __name__ == "__main__":
    unittest.main()
