"""Locked native Domum API/bytecode and production CAS audit, without a server.

MAW_DOMUM_AUDIT_ROOT selects the private lab. This compiles only to temporary
directories and never installs a bridge, edits a world, or creates an item.
Real survival consumption/output equality must also pass the isolated QA run.
"""
from pathlib import Path
import hashlib
import importlib.util
import os
import re
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
SOURCE = REPO / "world/society-bridge-src/src/main/java/dev/qiandeng/maw"
DOMUM_SHA = "04c0c902bdbcbd48e38bee5a323907ae0b7b7db4ff4a3e4da7c45334b65610a1"
COLONY_SHA = "ab97c0eec45c3f2539ec31428e3c836bb30ba1c537af0c86f5ab4e38754f6a4d"


@unittest.skipUnless(os.environ.get("MAW_DOMUM_AUDIT_ROOT"), "private locked Domum root not selected")
class DomumCutterAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = Path(os.environ["MAW_DOMUM_AUDIT_ROOT"]) / "server"
        cls.mods = cls.server / "mods"
        cls.java = Path(os.environ.get("MAW_DOMUM_AUDIT_JAVA", "E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe"))
        spec = importlib.util.spec_from_file_location("domum_audit_cp", REPO / "world/botgate-src/build.py")
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        cls.cp = os.pathsep.join([helper.full_cp(cls.server / "libraries"), *(str(cls.mods / name) for name in (
            "minecolonies-1.1.1319-1.21.1.jar", "structurize-1.0.832-1.21.1.jar",
            "domum-ornamentum-1.0.231-main.jar", "blockui-1.0.209-1.21.1.jar"))])
        for name, digest in (("domum-ornamentum-1.0.231-main.jar", DOMUM_SHA), ("minecolonies-1.1.1319-1.21.1.jar", COLONY_SHA)):
            if hashlib.sha256((cls.mods / name).read_bytes()).hexdigest() != digest:
                raise AssertionError("Locked primary source changed: " + name)

    def run_java(self, args):
        result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90)
        self.assertEqual(result.returncode, 0, result.stderr[-5000:])
        return result.stdout

    def bytecode(self, name, cp=None):
        return self.run_java([str(self.java.with_name("javap.exe")), "-classpath", cp or self.cp, "-p", "-c", name])

    def test_bridge_compiles_and_only_invokes_native_selection_after_full_preconditions(self):
        with tempfile.TemporaryDirectory(prefix="domum-native-api-") as temp:
            self.run_java([str(self.java.with_name("javac.exe")), "-proc:none", "--release", "21", "-encoding", "UTF-8", "-cp", self.cp,
                           "-d", temp, *[str(SOURCE / name) for name in ("DomumCutterBridge.java", "DomumCutterRules.java", "ColonyActionReplay.java")]])
            code = self.bytecode("dev.qiandeng.maw.DomumCutterBridge", temp)
            calls = re.findall(r"// (?:InterfaceMethod|Method) ([^\r\n]+)", code)
            for required in ("ArchitectsCutterContainer.clickMenuButton:", "ItemStack.saveOptional:", "DomumCutterRules.check:",
                             "ColonyActionReplay.begin:", "ColonyActionReplay.complete:", "ServerLevel.isLoaded:",
                             "ServerPlayer.distanceToSqr:", "ServerLevel.mayInteract:", "ArchitectsCutterContainer.stillValid:"):
                self.assertTrue(any(required in call for call in calls), required)
            for forbidden in ("ItemStack.\"<init>\":", "ItemStack.applyComponents:", "ItemStack.set:", "SimpleContainer.setItem:",
                              "Slot.set:", "ArchitectsCutterRecipe.assemble:", "Inventory.add:", "ServerLevel.getChunk:"):
                self.assertFalse(any(forbidden in call for call in calls), forbidden)
            select = code.split("private static void select(", 1)[1]
            self.assertLess(select.index("ColonyActionReplay.begin:"), select.index("DomumCutterRules.check:"))
            self.assertLess(select.index("DomumCutterRules.check:"), select.index("ArchitectsCutterContainer.clickMenuButton:"))

    def test_native_take_consumes_one_per_required_component_only_for_noncreative_players(self):
        code = self.bytecode("com.ldtteam.domumornamentum.container.ArchitectsCutterContainer$3")
        take = code.split("public void onTake(", 1)[1]
        self.assertIn("IMateriallyTexturedBlock.getComponents:", take)
        self.assertIn("Player.isCreative:", take)
        self.assertRegex(take, r"iconst_1\s+\d+: invokevirtual[^\n]+Slot.remove:\(I\)")
        self.assertLess(take.index("Player.isCreative:"), take.index("Slot.remove:"))
        self.assertIn("ArchitectsCutterContainer.updateRecipeResultSlot:", take)
        self.assertIn("awardUsedRecipes:", take)

    def test_native_recipe_uses_real_inputs_and_texture_components_then_original_patch(self):
        code = self.bytecode("com.ldtteam.domumornamentum.recipe.architectscutter.ArchitectsCutterRecipe")
        assemble = code.split("public net.minecraft.world.item.ItemStack assemble(com.", 1)[1].split("public boolean canCraftInDimensions", 1)[0]
        for required in ("ArchitectsCutterRecipeInput.getItem:", "BlockItem.getBlock:", "IMateriallyTexturedBlockComponent.getId:",
                         "IMateriallyTexturedBlockComponent.getValidSkins:", "MaterialTextureData$Builder.setComponent:",
                         "MaterialTextureData$Builder.writeToItemStack:", "java/lang/Math.max:", "ItemStack.applyComponents:"):
            self.assertIn(required, assemble)
        self.assertLess(assemble.index("writeToItemStack:"), assemble.index("ItemStack.applyComponents:"))
        matches = code.split("public boolean matches(com.", 1)[1].split("public net.minecraft.world.item.ItemStack assemble(com.", 1)[0]
        self.assertIn("BlockState.is:", matches)
        self.assertIn("iconst_0", matches)

    def test_native_menu_selects_original_recipe_with_exact_block_state_variant(self):
        code = self.bytecode("com.ldtteam.domumornamentum.container.ArchitectsCutterContainer")
        update = code.split("private void updateRecipeResultSlot(", 1)[1].split("public net.minecraft.world.item.ItemStack quickMoveStack", 1)[0]
        self.assertIn("DataComponents.BLOCK_STATE:", update)
        self.assertIn("BlockItemStateProperties.equals:", update)
        self.assertIn("ArchitectsCutterRecipe.assemble:", update)
        self.assertIn("Slot.set:", update)
        select = code.split("public boolean clickMenuButton(", 1)[1].split("public void slotsChanged(", 1)[0]
        self.assertIn("getOrComputeItemGroups:", select)
        self.assertIn("selectGroup:", select)
        self.assertIn("selectVariant:", select)
        self.assertIn("updateRecipeResultSlot:", select)

    def test_production_cas_rejects_component_identity_window_position_input_cursor_output_changes_without_effects(self):
        harness = r'''
package dev.qiandeng.maw;
import com.google.gson.*;
public final class DomumRulesTest {
 static JsonObject parse(String text) {return JsonParser.parseString(text).getAsJsonObject();}
 static JsonObject item(String snbt) {JsonObject i=new JsonObject();i.addProperty("snbt",snbt);return i;}
 static JsonObject state() {
  JsonObject s=parse("{playerUuid:'owner',windowId:2,stateId:7,position:{x:610,y:63,z:612},currentGroup:'domum_ornamentum:panel'}");
  s.add("currentVariant",item("panel[texture=oak,type=full]"));s.add("carried",item(""));s.add("output",item("panel[texture=oak,type=full]"));
  JsonArray a=new JsonArray();JsonObject row=new JsonObject();row.add("item",item("oak[name=材料,count=3]"));a.add(row);s.add("inputs",a);return s;
 }
 static JsonObject input() {return parse("{playerUuid:'owner',windowId:2,expectedStateId:7,expectedPosition:{x:610,y:63,z:612},expectedGroup:'domum_ornamentum:panel',expectedVariantSnbt:'panel[texture=oak,type=full]',expectedInputsSnbt:['oak[name=材料,count=3]'],expectedCarriedSnbt:'',expectedOutputSnbt:'panel[texture=oak,type=full]'}");}
 static void denied(JsonObject input,String code) {
  JsonObject actual=state(), copy=actual.deepCopy();String result=DomumCutterRules.check(input,actual);
  if (!code.equals(result)||!actual.equals(copy))throw new AssertionError("CAS denial/effect "+result+" expected "+code);
 }
 public static void main(String[] args) {
  if(DomumCutterRules.check(input(),state())!=null)throw new AssertionError("exact case denied");
  for(String field:new String[]{"playerUuid","expectedVariantSnbt","expectedCarriedSnbt","expectedOutputSnbt"}) {
   JsonObject i=input();i.addProperty(field,"changed");denied(i,switch(field){case "playerUuid"->"player_identity_mismatch";case "expectedVariantSnbt"->"variant_components_changed";case "expectedCarriedSnbt"->"cursor_changed";default->"output_components_changed";});
  }
  JsonObject i=input();i.addProperty("windowId",3);denied(i,"stale_window");i=input();i.addProperty("expectedStateId",8);denied(i,"stale_menu_state");
  i=input();i.getAsJsonObject("expectedPosition").addProperty("y",64);denied(i,"cutter_position_changed");
  i=input();i.addProperty("expectedGroup","domum_ornamentum:other");denied(i,"group_changed");
  i=input();i.getAsJsonArray("expectedInputsSnbt").set(0,new JsonPrimitive("oak[name=材料,count=2]"));denied(i,"input_components_changed");
  i=input();i.getAsJsonArray("expectedInputsSnbt").set(0,new JsonPrimitive("oak[name=材料,count=3,texture=birch]"));denied(i,"input_components_changed");
  i=input();i.remove("expectedInputsSnbt");denied(i,"missing_input_precondition");
  for(String field:new String[]{"windowId","expectedStateId"}){i=input();i.addProperty(field,"7");denied(i,"missing_or_invalid_precondition");i=input();i.addProperty(field,7.5);denied(i,"missing_or_invalid_precondition");}
  for(String id:new String[]{"PANEL","panel","foo:../Panel"," foo:panel"}){JsonObject g=new JsonObject();g.addProperty("groupId",id);try{DomumCutterRules.groupId(g);throw new AssertionError("bad group admitted");}catch(IllegalArgumentException expected){}}
  System.out.println("native full CAS no-side-effect audit passed");
 }
}
'''
        self.run_harness("DomumRulesTest", harness, ["DomumCutterRules.java"])

    def test_complete_fingerprint_reserves_before_effect_and_prevents_changed_components_replay(self):
        harness = r'''
package dev.qiandeng.maw;
import com.google.gson.*;
public final class DomumReplayTest {
 public static void main(String[] args) {
  JsonObject action=JsonParser.parseString("{kind:'select',selection:'variant',groupId:'domum_ornamentum:panel',choiceSnbt:'panel[oak,full]',expectedInputsSnbt:['oak[count=3]'],expectedStateId:7,expectedPosition:{x:610,y:63,z:612}}").getAsJsonObject();
  ColonyActionReplay ledger=new ColonyActionReplay();
  if(ledger.begin("once",action).outcome()!=ColonyActionReplay.Outcome.NEW)throw new AssertionError();
  if(ledger.begin("once",action).outcome()!=ColonyActionReplay.Outcome.IN_PROGRESS)throw new AssertionError();
  ledger.complete("once","known result");
  if(!"known result".equals(ledger.begin("once",action).response()))throw new AssertionError();
  for(String field:new String[]{"choiceSnbt","expectedInputsSnbt","expectedStateId","expectedPosition"}){
   JsonObject changed=action.deepCopy();changed.addProperty(field,"different complete component");
   if(ledger.begin("once",changed).outcome()!=ColonyActionReplay.Outcome.CONFLICT)throw new AssertionError(field);
  }
  System.out.println("full request reservation audit passed");
 }
}
'''
        self.run_harness("DomumReplayTest", harness, ["ColonyActionReplay.java"])

    def run_harness(self, name, harness, files):
        with tempfile.TemporaryDirectory(prefix="domum-pure-rules-") as temp:
            file = Path(temp) / (name + ".java"); file.write_text(harness, encoding="utf-8")
            self.run_java([str(self.java.with_name("javac.exe")), "-proc:none", "--release", "21", "-encoding", "UTF-8", "-cp", self.cp,
                           "-d", temp, *[str(SOURCE / name) for name in files], str(file)])
            self.assertIn("passed", self.run_java([str(self.java), "-cp", os.pathsep.join([temp, self.cp]), "dev.qiandeng.maw." + name]))


if __name__ == "__main__":
    unittest.main()
