"""Read-only audit against the locked MC/NeoForge and mod JAR APIs.

MAW_COLLISION_AUDIT_ROOT selects the private lab root. Compiles only into a
temporary directory; does not install, start a server, connect, or act in game.
Wire/player/navigation acceptance remains a separate live-server check.
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
PINS = {
    "domum-ornamentum-1.0.231-main.jar": "04c0c902bdbcbd48e38bee5a323907ae0b7b7db4ff4a3e4da7c45334b65610a1",
    "FarmersDelight-1.21.1-1.3.4.jar": "139ad7696462c89c03eea463f805abffa552526c5dadaadae221dd9624cb197c",
    "mcw-roofs-2.3.2-mc1.21.1neoforge.jar": "25c79def993a24b05b0f8494ee9417717d469bc000d5ed7c219b47dcc3b3e9c8",
    "mcw-bridges-3.1.2-mc1.21.1neoforge.jar": "070b817d3282760d9789b22ce13779613c8b558e02012fd5884d343175d88fd9",
}

# Exact leaves allowed by production policy. An unaudited subclass cannot use
# its ancestor's entry. Shape dispatch is resolved through the real JAR chain.
LEAVES = {
    "net.minecraft.world.level.block.Block",
    "net.minecraft.world.level.block.SlabBlock",
    "net.minecraft.world.level.block.StairBlock",
    "net.minecraft.world.level.block.DoorBlock",
    "net.minecraft.world.level.block.TrapDoorBlock",
    "net.minecraft.world.level.block.FenceBlock",
    "net.minecraft.world.level.block.FenceGateBlock",
    "net.minecraft.world.level.block.WallBlock",
    "com.ldtteam.domumornamentum.block.decorative.PanelBlock",
    "com.ldtteam.domumornamentum.block.vanilla.SlabBlock",
    "com.ldtteam.domumornamentum.block.vanilla.StairBlock",
    "com.mcwbridges.kikoz.objects.Bridge_Stairs",
    "com.mcwroofs.kikoz.objects.roofs.RoofBlock",
    "com.mcwroofs.kikoz.objects.roofs.BaseRoof",
    "com.mcwroofs.kikoz.objects.roofs.Lower",
    "vectorwing.farmersdelight.common.block.CuttingBoardBlock",
}

HARNESS = r"""
package dev.qiandeng.maw;
import com.google.gson.*;
import java.util.*;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.shapes.Shapes;
import net.minecraft.world.level.block.state.properties.EnumProperty;
import net.minecraft.world.level.block.state.properties.DirectionProperty;
import net.minecraft.core.Direction;
import com.mcwbridges.kikoz.objects.Bridge_Stairs.ConnectionStatus;
public final class CollisionFactsHarness {
  private static int checked;
  private static void require(boolean value, String message) {
    checked++; if (!value) throw new AssertionError(message);
  }
  private static void reject(Runnable call, String message) {
    checked++; try { call.run(); } catch (IllegalArgumentException expected) { return; }
    throw new AssertionError(message);
  }
  public static void main(String[] args) {
    var thin = Shapes.box(0,0,0,1,1.0/16,1).toAabbs();
    var exported = NativeCollisionFacts.boxes(thin);
    require(exported.size()==1 && exported.get(0).getAsJsonArray().get(4).getAsDouble()==1.0/16,"native thin block thickness");
    var fence = NativeCollisionFacts.boxes(Shapes.box(.375,0,.375,.625,1.5,.625).toAabbs());
    require(fence.get(0).getAsJsonArray().get(4).getAsDouble()==1.5,"do not clamp native fence to unit cube");
    var stairs = Shapes.or(Shapes.box(0,0,0,1,.5,1),Shapes.box(0,.5,.5,1,1,1)).toAabbs();
    var parts = NativeCollisionFacts.boxes(stairs);
    require(parts.size()==2,"preserve native stair components, not bounding hull");
    require(NativeCollisionFacts.boxes(Shapes.empty().toAabbs()).size()==0,"real empty shape is empty");
    require(NativeCollisionFacts.boxes(Collections.nCopies(64,new AABB(0,0,0,1,.5,1))).size()==64,"64 box budget");
    reject(()->NativeCollisionFacts.boxes(Collections.nCopies(65,new AABB(0,0,0,1,.5,1))),"65 boxes must fail");
    reject(()->NativeCollisionFacts.boxes(List.of(new AABB(0,0,0,1,17,1))),"unbounded box must fail");
    reject(()->NativeCollisionFacts.boxes(List.of(new AABB(0,0,0,0,1,1))),"degenerate box must fail");
    reject(()->NativeCollisionFacts.boxes(List.of(new AABB(Double.NaN,0,0,1,1,1))),"nonfinite box must fail");
    JsonObject point = new JsonObject(); point.addProperty("y",65);
    require(NativeCollisionFacts.integer(point,"y")==65,"real integer");
    point.addProperty("y","65"); reject(()->NativeCollisionFacts.integer(point,"y"),"string cannot coerce to coordinate");
    point.addProperty("y",65.5); reject(()->NativeCollisionFacts.integer(point,"y"),"fraction cannot truncate");
    point.addProperty("y",2147483648L); reject(()->NativeCollisionFacts.integer(point,"y"),"coordinate cannot overflow");
    JsonObject props = new JsonObject(); props.addProperty("open","false"); props.addProperty("half","bottom");
    require(NativeCollisionFacts.properties(props).toString().equals("{\"half\":\"bottom\",\"open\":\"false\"}"),"full string state canonicalization");
    props.addProperty("open",false); reject(()->NativeCollisionFacts.properties(props),"boolean cannot coerce to state");
    require(NativeCollisionFacts.supported("domum_ornamentum","com.ldtteam.domumornamentum.block.decorative.PanelBlock"),"audited exact Domum panel");
    require(!NativeCollisionFacts.supported("domum_ornamentum","example.PanelSubclass"),"unknown subclass cannot dispatch");
    require(!NativeCollisionFacts.supported("unknown","net.minecraft.world.level.block.Block"),"namespace alone cannot borrow audit");
    require(!NativeCollisionFacts.supported("create","com.simibubi.create.content.kinetics.millstone.MillstoneBlock"),"not all mods audited");
    var connection = EnumProperty.create("connection",ConnectionStatus.class);
    require(ConnectionStatus.BASE.toString().equals("BASE"),"actual Macaw enum toString is not serialized state");
    require(NativeCollisionFacts.propertyValue(connection,ConnectionStatus.BASE).equals("base"),"actual Property.getName serialized Macaw value");
    var facing = DirectionProperty.create("facing");
    require(NativeCollisionFacts.propertyValue(facing,Direction.NORTH).equals("north"),"native direction serialization");
    reject(()->NativeCollisionFacts.propertyValue(facing,ConnectionStatus.BASE),"foreign value cannot borrow a property");
    JsonObject budget = new JsonObject(); budget.addProperty("text","界".repeat(6000));
    require(NativeCollisionFacts.bytes(budget)>NativeCollisionFacts.MAX_BYTES,"wire budget counts UTF8 bytes");
    System.out.println("native collision facts checks="+checked);
  }
}
"""


def methods(bytecode):
    """Split javap methods including private shape-index helper dispatch."""
    headers = list(re.finditer(r"(?m)^  (?!  )[^\r\n]+(?:;|\{)\s*$", bytecode))
    result = {}
    for index, header in enumerate(headers):
        text = header.group(0)
        name = re.search(r"([A-Za-z_$][A-Za-z0-9_$]*)\(", text)
        if name:
            end = headers[index + 1].start() if index + 1 < len(headers) else len(bytecode)
            result.setdefault(name.group(1), []).append(bytecode[header.start():end])
    return result


@unittest.skipUnless(os.environ.get("MAW_COLLISION_AUDIT_ROOT"), "private locked collision API root not selected")
class NativeCollisionAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = Path(os.environ["MAW_COLLISION_AUDIT_ROOT"]) / "server"
        cls.java = Path(os.environ.get("MAW_COLLISION_AUDIT_JAVA", "E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe"))
        spec = importlib.util.spec_from_file_location("collision_audit_cp", REPO / "world/botgate-src/build.py")
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        cls.cp = os.pathsep.join([helper.full_cp(cls.server / "libraries"),
                                 *(str(cls.server / "mods" / name) for name in PINS)])
        cls.temp = tempfile.TemporaryDirectory(prefix="maw-native-collision-api-")
        cls.addClassCleanup(cls.temp.cleanup)
        harness = Path(cls.temp.name) / "CollisionFactsHarness.java"
        harness.write_text(HARNESS, encoding="utf-8")
        compilation = subprocess.run([str(cls.java.with_name("javac.exe")), "-proc:none", "--release", "21", "-encoding", "UTF-8",
                                      "-cp", cls.cp, "-d", cls.temp.name,
                                      str(SOURCE / "NativeCollisionFacts.java"), str(SOURCE / "PlayerCollisionBridge.java"), str(harness)],
                                     capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
        if compilation.returncode:
            raise AssertionError("Native MC1.21.1/NeoForge API compilation failed: " + compilation.stderr[-4000:])
        cls.bytecodes = {}

    @classmethod
    def bytecode(cls, name, compiled=False):
        key = (name, compiled)
        if key not in cls.bytecodes:
            cp = os.pathsep.join([cls.temp.name, cls.cp]) if compiled else cls.cp
            result = subprocess.run([str(cls.java.with_name("javap.exe")), "-classpath", cp, "-p", "-c", name],
                                    capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20)
            if result.returncode:
                raise AssertionError("Cannot resolve locked class " + name + ": " + result.stderr[-1000:])
            cls.bytecodes[key] = result.stdout
        return cls.bytecodes[key]

    def test_locked_mod_source_jars_match_the_audited_builds(self):
        for name, pin in PINS.items():
            with self.subTest(jar=name):
                self.assertEqual(hashlib.sha256((self.server / "mods" / name).read_bytes()).hexdigest(), pin)

    def test_actual_voxel_shapes_preserve_small_tall_split_and_empty_geometry(self):
        result = subprocess.run([str(self.java), "-cp", os.pathsep.join([self.temp.name, self.cp]),
                                 "dev.qiandeng.maw.CollisionFactsHarness"],
                                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr[-3000:])
        self.assertIn("native collision facts checks=24", result.stdout)

    def test_production_policy_whitelist_matches_the_complete_audit_set(self):
        source = (SOURCE / "NativeCollisionFacts.java").read_text(encoding="utf-8")
        selected = set(re.findall(r'"((?:net\.minecraft|com\.ldtteam|com\.mcw|vectorwing\.)[^"]+)"', source))
        self.assertEqual(selected, LEAVES)

    def test_complete_real_collision_outline_interaction_dispatch_has_no_world_reads(self):
        for leaf in sorted(LEAVES):
            chain, current = [], leaf
            for _ in range(10):
                chain.append((current, methods(self.bytecode(current))))
                if current == "net.minecraft.world.level.block.state.BlockBehaviour":
                    break
                declaration = self.bytecode(current)
                # Erase balanced generic type bounds before finding the actual
                # superclass; B extends Foo<B> is not an inheritance hop.
                for _ in range(8):
                    erased = re.sub(r"<[^<>]*>", "", declaration)
                    if erased == declaration:
                        break
                    declaration = erased
                parent = re.search(r"(?m)^(?:public |protected |private )?(?:abstract |final )?class [^\r\n]+? extends ([\w.$]+)", declaration)
                self.assertIsNotNone(parent, "Cannot resolve inherited shape dispatch: " + current)
                current = parent.group(1)
            else:
                self.fail("Shape inheritance exceeds bounded audit for " + leaf)
            for kind in ("getCollisionShape", "getShape", "getInteractionShape"):
                with self.subTest(block=leaf, dispatch=kind):
                    owner, method_map = next((owner, mapping) for owner, mapping in chain if kind in mapping)
                    body = "\n".join(method_map[kind])
                    self.assertNotRegex(body, r"(?:getBlockState|getBlockEntity|getChunk|hasChunk|loadChunk|ServerLevel|LevelAccessor|CollisionGetter)",
                                        owner + ": unaudited world/context read")
                    # Shape index helpers are separately inspected. They are
                    # state-only, including CrossCollisionBlock's private lambda.
                    for helper in ("getShapeIndex", "getAABBIndex", "lambda$getAABBIndex$0"):
                        if helper + ":" in body or helper in method_map:
                            for segment in method_map.get(helper, []):
                                self.assertNotRegex(segment, r"(?:getBlockState|getBlockEntity|getChunk|LevelAccessor|CollisionGetter)")
                    # Actual leaf methods must not delegate into another mod's
                    # service/event API. All observed calls stay in MC shape /
                    # state or Java/fastutil state maps and owner-only helpers.
                    calls = re.findall(r"// (?:InterfaceMethod|Method) ([^\r\n]+)", body)
                    for call in calls:
                        if call == "com/mcwbridges/kikoz/objects/Bridge_Stairs$ConnectionStatus.ordinal:()I":
                            # This exact enum's ordinal is java.lang.Enum's
                            # final method; it does not read neighbouring world.
                            self.assertIn("extends java.lang.Enum", self.bytecode("com.mcwbridges.kikoz.objects.Bridge_Stairs$ConnectionStatus"))
                            continue
                        self.assertRegex(call, r"^(?:net/minecraft/|java/|it/unimi/dsi/fastutil/|[a-zA-Z_$][a-zA-Z0-9_$]*:)",
                                         owner + ": new unaudited dispatch " + call)

    def test_production_query_calls_real_player_context_and_loaded_native_ray(self):
        bytecode = self.bytecode("dev.qiandeng.maw.PlayerCollisionBridge", compiled=True)
        calls = re.findall(r"// (?:InterfaceMethod|Method) ([^\r\n]+)", bytecode)
        self.assertTrue(any("CollisionContext.of:" in call for call in calls))
        self.assertTrue(any("BlockState.getCollisionShape:" in call for call in calls))
        self.assertTrue(any("BlockGetter.traverseBlocks:" in call for call in calls))
        self.assertTrue(any("Level.isLoaded:" in call for call in calls))
        self.assertFalse(any(re.search(r"(?:getOcclusionShape|getBlockSupportShape|EmptyBlockGetter|getChunk:|setBlock:|addFreshEntity:|destroyBlock:)", call) for call in calls))
        self.assertFalse(any("CollisionContext.empty:" in call for call in calls))


if __name__ == "__main__":
    unittest.main(verbosity=2)
