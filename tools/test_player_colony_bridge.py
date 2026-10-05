"""Read-only locked MineColonies API/resource audit; never starts a server or acts in game.

Set MAW_COLONY_AUDIT_ROOT to the private lab root. Tests compile sources in a
temporary directory and exercise production construction confirmation rules.
"""
from pathlib import Path
import gzip
import hashlib
import importlib.util
import io
import json
import os
import re
import struct
import subprocess
import tempfile
import unittest
import zipfile

REPO = Path(__file__).resolve().parents[1]
SOURCE = REPO / "world/society-bridge-src/src/main/java/dev/qiandeng/maw"
PIN = "ab97c0eec45c3f2539ec31428e3c836bb30ba1c537af0c86f5ab4e38754f6a4d"


class NbtReader:
    """Small bounded standard NBT reader for the original compressed blueprints."""
    def __init__(self, data):
        if len(data) > 8 * 1024 * 1024:
            raise ValueError("blueprint audit budget exceeded")
        self.stream = io.BytesIO(data)

    def number(self, kind):
        return struct.unpack(">" + kind, self.stream.read(struct.calcsize(">" + kind)))[0]

    def string(self):
        return self.stream.read(self.number("H")).decode("utf-8")

    def value(self, tag, depth=0):
        if depth > 32:
            raise ValueError("NBT nesting exceeded")
        if tag in (1, 2, 3, 4, 5, 6):
            return self.number({1: "b", 2: "h", 3: "i", 4: "q", 5: "f", 6: "d"}[tag])
        if tag == 8:
            return self.string()
        if tag in (7, 9, 11, 12):
            child = self.number("b") if tag == 9 else None
            count = self.number("i")
            if not 0 <= count <= 2_000_000:
                raise ValueError("NBT list budget exceeded")
            return [self.value(child, depth + 1) if tag == 9 else self.number({7: "b", 11: "i", 12: "q"}[tag]) for _ in range(count)]
        if tag == 10:
            result = {}
            while (child := self.number("b")):
                name = self.string()
                if len(result) >= 16384 or name in result:
                    raise ValueError("NBT compound budget/duplicate key")
                result[name] = self.value(child, depth + 1)
            return result
        raise ValueError("Unsupported NBT tag")

    def root(self):
        tag = self.number("b")
        self.string()
        root = self.value(tag)
        if self.stream.read(1):
            raise ValueError("Trailing NBT bytes")
        return root


@unittest.skipUnless(os.environ.get("MAW_COLONY_AUDIT_ROOT"), "private locked MineColonies root not selected")
class PlayerColonyBridgeAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = Path(os.environ["MAW_COLONY_AUDIT_ROOT"]) / "server"
        cls.mods = cls.server / "mods"
        cls.jar = cls.mods / "minecolonies-1.1.1319-1.21.1.jar"
        cls.java = Path(os.environ.get("MAW_COLONY_AUDIT_JAVA", "E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe"))
        spec = importlib.util.spec_from_file_location("colony_audit_cp", REPO / "world/botgate-src/build.py")
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        cls.cp = os.pathsep.join([helper.full_cp(cls.server / "libraries"),
                                 *(str(cls.mods / name) for name in (
                                     "minecolonies-1.1.1319-1.21.1.jar", "structurize-1.0.832-1.21.1.jar",
                                     "domum-ornamentum-1.0.231-main.jar", "blockui-1.0.209-1.21.1.jar"))])

    def run_java(self, arguments):
        result = subprocess.run(arguments, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90)
        self.assertEqual(result.returncode, 0, result.stderr[-4000:])
        return result.stdout

    def test_each_fixed_hut_is_the_real_original_blueprint_and_contains_its_hut(self):
        self.assertEqual(hashlib.sha256(self.jar.read_bytes()).hexdigest(), PIN)
        rules = (SOURCE / "ColonyConstructionRules.java").read_text(encoding="utf-8")
        specs = re.findall(r'new Hut\("([^"]+)", "([^"]+)", "([^"]+)"\)', rules)
        self.assertEqual({row[0] for row in specs}, {"townhall", "builder", "home", "farmer", "warehouse", "blacksmith", "cook", "deliveryman"})
        with zipfile.ZipFile(self.jar) as archive:
            for kind, item, path in specs:
                with self.subTest(hut=kind):
                    raw = archive.read("blueprints/minecolonies/original/" + path)
                    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as compressed:
                        data = compressed.read(8 * 1024 * 1024 + 1)
                    blueprint = NbtReader(data).root()
                    # Locked BlueprintUtil.convertSaveDataToBlocks: high/low shorts,
                    # then Y/Z/X order; check the actual anchor, not merely a palette entry.
                    anchor = blueprint["optional_data"]["structurize"]["primary_offset"]
                    index = (anchor["y"] * blueprint["size_z"] + anchor["z"]) * blueprint["size_x"] + anchor["x"]
                    packed = blueprint["blocks"][index // 2]
                    palette_index = ((packed >> 16) if index % 2 == 0 else packed) & 0xffff
                    self.assertEqual(blueprint["palette"][palette_index]["Name"], item)
                    tiles = [tile for tile in blueprint["tile_entities"] if all(tile.get(axis) == anchor[axis] for axis in ("x", "y", "z"))]
                    self.assertEqual([tile["id"] for tile in tiles], ["minecolonies:warehouse" if kind == "warehouse" else "minecolonies:colonybuilding"])
                    self.assertTrue(blueprint["tile_entities"], "Must contain native hut/tile data")
                    self.assertGreater(blueprint["size_x"] * blueprint["size_y"] * blueprint["size_z"], 1)

    def test_void_native_upgrade_really_has_rejection_paths_and_synchronous_work_registration(self):
        text = self.run_java([str(self.java.with_name("javap.exe")), "-classpath", self.cp, "-p", "-c",
                              "com.minecolonies.core.colony.buildings.AbstractBuilding"])
        upgrade = text.split("public void requestUpgrade(", 1)[1].split("\n  public ", 1)[0]
        self.assertIn("research.havetounlock", upgrade)
        self.assertIn("worker.noupgrade", upgrade)
        work = text.split("protected void requestWorkOrder(", 1)[1].split("\n  public ", 1)[0]
        self.assertLess(work.index("IWorkManager.addWorkOrder:"), work.index("WorkOrderBuilding.loadBlueprint:"))
        self.assertIn("WorkOrderBuilding.setClaimedBy:", work)

    def test_production_confirmation_never_confuses_refusal_existing_or_wrong_orders_with_success(self):
        harness = r'''
package dev.qiandeng.maw;
import java.util.List;
import java.util.Set;
public final class ColonyConstructionRulesTest {
    static final ColonyConstructionRules.Point SITE = new ColonyConstructionRules.Point(5,64,4);
    static final ColonyConstructionRules.Point BUILDER = new ColonyConstructionRules.Point(8,64,4);
    static ColonyConstructionRules.Order order(int id,String type,ColonyConstructionRules.Point pos,int level,boolean claimed,ColonyConstructionRules.Point owner) {
        return new ColonyConstructionRules.Order(id,type,pos,level,claimed,owner);
    }
    static void rejected(Set<Integer> before,List<ColonyConstructionRules.Order> after) {
        var result = ColonyConstructionRules.confirm(before,after,SITE,BUILDER);
        if(result.order()!=null || result.code().equals("build_requested")) throw new AssertionError("False native success");
    }
    public static void main(String[] args) {
        var build=order(4,"build",SITE,1,true,BUILDER);
        rejected(Set.of(),List.of()); // research/height/builder denial: native void returns normally
        rejected(Set.of(4),List.of(build)); // a previous order is not a newly accepted request
        rejected(Set.of(),List.of(order(4,"remove",SITE,1,true,BUILDER)));
        rejected(Set.of(),List.of(order(4,"build",BUILDER,1,true,BUILDER)));
        rejected(Set.of(),List.of(order(4,"build",SITE,0,true,BUILDER)));
        rejected(Set.of(),List.of(order(4,"build",SITE,1,false,null)));
        rejected(Set.of(),List.of(order(4,"build",SITE,1,true,SITE)));
        rejected(Set.of(),List.of(build,order(5,"upgrade",SITE,2,true,BUILDER)));
        for (String type:List.of("build","upgrade")) {
            var actual=order(4,type,SITE,type.equals("build")?1:2,true,BUILDER);
            var result=ColonyConstructionRules.confirm(Set.of(2),List.of(actual),SITE,BUILDER);
            if (!result.code().equals("build_requested") || result.order()!=actual) throw new AssertionError("Missing native receipt");
        }
        for (String invalid:List.of("townhall","minecolonies:blockhuthome","../fundamentals/home1.blueprint","HOME","home ","university",""))
            if(ColonyConstructionRules.hut(invalid)!=null) throw new AssertionError("Untrusted hut path/type admitted");
        if(ColonyConstructionRules.hut(null)!=null) throw new AssertionError("Null admitted");
        if(ColonyConstructionRules.hut("home")==null || ColonyConstructionRules.hut("builder")==null) throw new AssertionError("Missing real allowed hut");
        System.out.println("construction confirmation and allowlist passed");
    }
}
'''
        with tempfile.TemporaryDirectory(prefix="colony-rules-audit-") as temporary:
            file = Path(temporary) / "ColonyConstructionRulesTest.java"
            file.write_text(harness, encoding="utf-8")
            self.run_java([str(self.java.with_name("javac.exe")), "-proc:none", "--release", "21", "-d", temporary,
                           str(SOURCE / "ColonyConstructionRules.java"), str(file)])
            result = self.run_java([str(self.java), "-cp", temporary, "dev.qiandeng.maw.ColonyConstructionRulesTest"])
            self.assertIn("passed", result)

    def test_actual_bridge_compiles_against_locked_native_api_and_uses_permission_inventory_blueprint_paths(self):
        with tempfile.TemporaryDirectory(prefix="colony-native-api-audit-") as temporary:
            self.run_java([str(self.java.with_name("javac.exe")), "-proc:none", "--release", "21", "-encoding", "UTF-8", "-cp", self.cp,
                           "-d", temporary, str(SOURCE / "PlayerColonyBridge.java"), str(SOURCE / "ColonyConstructionRules.java"),
                           str(SOURCE / "ColonyActionReplay.java")])
            text = self.run_java([str(self.java.with_name("javap.exe")), "-classpath", temporary, "-p", "-c", "dev.qiandeng.maw.PlayerColonyBridge"])
            calls = re.findall(r"// (?:InterfaceMethod|Method) ([^\r\n]+)", text)
            for required in ("IPermissions.hasPermission:", "IRegisteredStructureManager.canPlaceAt:", "StructurePacks.getBlueprint:",
                             "IBuilding.requestUpgrade:", "ColonyConstructionRules.confirm:", "InventoryUtils.addItemStackToProviderWithResult:"):
                self.assertTrue(any(required in call for call in calls), required)
            self.assertFalse(any(re.search(r"(?:setBuildingLevel|addWorkOrder|addCitizen|opPlayer|dispatchCommand|performPrefixedCommand)", call) for call in calls),
                             "Bridge must not synthesize completion/citizens/work orders or invoke administrator commands")
            self.assertFalse(any("StructurePacks.findBlueprint:" in call for call in calls),
                             "Status discovery must not recursively scan/wait on the entire pack")

    def test_runtime_payload_fingerprint_and_receipt_ledger_bind_the_entire_action(self):
        sample = {"schemaVersion": 1, "kind": "found", "position": {"x": 600, "y": 64, "z": 600},
                  "name": "Test Colony", "inventorySlot": 9, "expectedSnbt": '{id:"minecolonies:blockhuttownhall",count:1,components:{"test:key":"a"}}'}
        reference = hashlib.sha256(json.dumps(sample, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
        harness = r'''
package dev.qiandeng.maw;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
public final class ColonyActionReplayTest {
    static JsonObject parse(String text) { return JsonParser.parseString(text).getAsJsonObject(); }
    static void check(boolean value,String message) { if(!value) throw new AssertionError(message); }
    static void conflict(ColonyActionReplay ledger,JsonObject changed,JsonObject original) {
        check(ledger.begin("same-request",changed).outcome()==ColonyActionReplay.Outcome.CONFLICT,"different payload must conflict");
        var replay=ledger.begin("same-request",original);
        check(replay.outcome()==ColonyActionReplay.Outcome.REPLAY && replay.response().equals("original-found-success"),"conflict changed original cache");
    }
    public static void main(String[] args) {
        JsonObject original=parse(args[0]); original.addProperty("requestId","same-request");
        check(ColonyActionReplay.fingerprint(original).equals(args[1]),"runtime SHA-256 differs from independent canonical reference");
        var ledger=new ColonyActionReplay();
        check(ledger.begin("same-request",original).outcome()==ColonyActionReplay.Outcome.NEW,"initial action");
        check(ledger.begin("same-request",original).outcome()==ColonyActionReplay.Outcome.IN_PROGRESS,"unknown pending outcome must not reapply");
        check(ledger.complete("same-request","original-found-success"),"complete original");
        check(!ledger.complete("same-request","replacement-success"),"completed cache is immutable");
        // Reproduce found-success -> different place_hut with the same ID.
        var changed=original.deepCopy(); changed.addProperty("kind","place_hut");changed.addProperty("hutType","warehouse");
        changed.getAsJsonObject("position").addProperty("x",603);conflict(ledger,changed,original);
        changed=original.deepCopy();changed.getAsJsonObject("position").addProperty("z",601);conflict(ledger,changed,original);
        changed=original.deepCopy();changed.addProperty("quantity",2);conflict(ledger,changed,original);
        changed=original.deepCopy();changed.addProperty("inventorySlot",10);conflict(ledger,changed,original);
        changed=original.deepCopy();changed.addProperty("expectedSnbt",original.get("expectedSnbt").getAsString().replace("\"a\"","\"b\""));conflict(ledger,changed,original);
        changed=original.deepCopy();changed.addProperty("expectedSnbt",original.get("expectedSnbt").getAsString()+" ");conflict(ledger,changed,original);
        changed=original.deepCopy();changed.addProperty("token","different-token");conflict(ledger,changed,original);
        changed=original.deepCopy();changed.remove("expectedSnbt");conflict(ledger,changed,original);
        changed=original.deepCopy();changed.add("expectedSnbt",com.google.gson.JsonNull.INSTANCE);conflict(ledger,changed,original);
        // Parsed object ordering and equivalent numeric spelling are irrelevant.
        var ordered=parse("{\"requestId\":\"other-id\",\"position\":{\"z\":600.0,\"y\":64,\"x\":600}}");
        for(var entry:original.entrySet()) if(!entry.getKey().equals("requestId") && !entry.getKey().equals("position")) ordered.add(entry.getKey(),entry.getValue());
        check(ColonyActionReplay.fingerprint(ordered).equals(ColonyActionReplay.fingerprint(original)),"object field order/requestId/number normalization");
        check(ledger.begin("same-request",ordered).outcome()==ColonyActionReplay.Outcome.REPLAY,"same parsed parameters replay");
        check(!ColonyActionReplay.fingerprint(parse("{\"v\":[1,2]}")).equals(ColonyActionReplay.fingerprint(parse("{\"v\":[2,1]}"))),"array order must remain significant");
        check(!ColonyActionReplay.fingerprint(parse("{\"v\":{\"requestId\":\"a\"}}")).equals(ColonyActionReplay.fingerprint(parse("{\"v\":{\"requestId\":\"b\"}}"))),"only root requestId is ignored");
        check(!ColonyActionReplay.fingerprint(parse("{\"quantity\":1}")).equals(ColonyActionReplay.fingerprint(parse("{\"quantity\":\"1\"}"))),"JSON types preserved");
        check(!ColonyActionReplay.fingerprint(parse("{\"s\":\"千灯纪\"}")).equals(ColonyActionReplay.fingerprint(parse("{\"s\":\"千灯记\"}"))),"full Unicode contents preserved");
        for(char surrogate:new char[]{(char)0xd800,(char)0xd801}) {
            var invalid=new JsonObject();invalid.addProperty("s",String.valueOf(surrogate));
            try {ColonyActionReplay.fingerprint(invalid);throw new AssertionError("malformed Unicode must not collide via replacement");}catch(IllegalArgumentException expected){}
        }
        check(new ColonyActionReplay().begin("same-request",changed).outcome()==ColonyActionReplay.Outcome.NEW,"different player ledger isolation");
        var bounded=new ColonyActionReplay();
        for(int i=0;i<33;i++) {check(bounded.begin("id"+i,original).outcome()==ColonyActionReplay.Outcome.NEW,"new bounded entry");bounded.complete("id"+i,"r"+i);}
        check(bounded.begin("id1",original).outcome()==ColonyActionReplay.Outcome.REPLAY,"32 retained entries");
        check(bounded.begin("id0",original).outcome()==ColonyActionReplay.Outcome.NEW,"oldest entry evicted");
        var nested=new JsonObject();var current=nested;
        for(int i=0;i<34;i++){var child=new JsonObject();current.add("child",child);current=child;}
        try {ColonyActionReplay.fingerprint(nested);throw new AssertionError("depth budget missing");}catch(IllegalArgumentException expected){}
        System.out.println("runtime payload binding and bounded replay passed");
    }
}
'''
        with tempfile.TemporaryDirectory(prefix="colony-replay-audit-") as temporary:
            file = Path(temporary) / "ColonyActionReplayTest.java"
            file.write_text(harness, encoding="utf-8")
            self.run_java([str(self.java.with_name("javac.exe")), "-proc:none", "--release", "21", "-encoding", "UTF-8", "-cp", self.cp,
                           "-d", temporary, str(SOURCE / "ColonyActionReplay.java"), str(file)])
            result = self.run_java([str(self.java), "-cp", temporary + os.pathsep + self.cp, "dev.qiandeng.maw.ColonyActionReplayTest",
                                    json.dumps(sample, ensure_ascii=False), reference])
            self.assertIn("bounded replay passed", result)

    def test_capabilities_query_reaches_native_read_only_response_with_and_without_colony(self):
        harness = r'''
package dev.qiandeng.maw;
import com.google.gson.JsonObject;
public final class ColonyCapabilitiesTest {
    static void check(boolean value,String message) {if(!value) throw new AssertionError(message);}
    public static void main(String[] args) {
        var options=new JsonObject();options.addProperty("structurePack","Minecolonies Original");
        options.addProperty("hireAvailable",false);options.addProperty("placeHutsPermission",false);
        var absent=PlayerColonyBridge.capabilitiesResult("cap-without-colony",options,null);
        check(absent.get("ok").getAsBoolean(),"capability discovery must work before founding");
        check(absent.get("readOnly").getAsBoolean() && absent.get("query").getAsString().equals("capabilities"),"query identity");
        check(absent.get("kind").getAsString().equals("colony_receipt") && absent.get("schemaVersion").getAsInt()==1,"receipt envelope");
        check(absent.get("colony").isJsonNull(),"absence must remain explicit");
        check(absent.get("constructionOptions")==options && !options.get("placeHutsPermission").getAsBoolean(),"native permission/options must be preserved");
        var colony=new JsonObject();colony.addProperty("id",7);colony.addProperty("member",false);
        var present=PlayerColonyBridge.capabilitiesResult("cap-with-colony",options,colony);
        check(present.get("colony")==colony && !present.getAsJsonObject("colony").get("member").getAsBoolean(),"visitor must not gain membership");
        check(!present.has("citizens") && !present.has("buildings") && !present.has("requests") && !present.has("workOrders"),"capabilities query must not expand into colony inventory/state scans");
        System.out.println("capabilities native response branch passed");
    }
}
'''
        with tempfile.TemporaryDirectory(prefix="colony-capabilities-audit-") as temporary:
            file = Path(temporary) / "ColonyCapabilitiesTest.java"
            file.write_text(harness, encoding="utf-8")
            self.run_java([str(self.java.with_name("javac.exe")), "-proc:none", "--release", "21", "-encoding", "UTF-8", "-cp", self.cp,
                           "-d", temporary, *(str(SOURCE / name) for name in ("PlayerColonyBridge.java", "ColonyConstructionRules.java", "ColonyActionReplay.java")), str(file)])
            result = self.run_java([str(self.java), "-cp", temporary + os.pathsep + self.cp, "dev.qiandeng.maw.ColonyCapabilitiesTest"])
            self.assertIn("native response branch passed", result)
            bytecode = self.run_java([str(self.java.with_name("javap.exe")), "-classpath", temporary, "-p", "-c", "dev.qiandeng.maw.PlayerColonyBridge"])
            handler = bytecode.split("private static void handle(", 1)[1].split("\n  private static ", 1)[0]
            self.assertIn("// String capabilities", handler, "actual handler must accept the client query kind")
            self.assertIn("Method capabilitiesResult:", handler, "actual handler must dispatch the native response")
            early = handler.split("Method capabilitiesResult:", 1)[1].split("IColony.getCitizenManager:", 1)[0]
            self.assertIn("Method send:", early, "capabilities must use the private, byte-budgeted native send path")
            self.assertRegex(early, r"\n\s*\d+: return\b", "capabilities must return before status enumeration")
            self.assertIn("// String unsupported_query", handler, "unknown query kinds remain rejected")


if __name__ == "__main__":
    unittest.main()
