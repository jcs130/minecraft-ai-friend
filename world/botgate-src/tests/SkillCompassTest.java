import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.god.botgate.chest.SkillChestIO;
import dev.god.botgate.chest.SkillChestLayout;
import dev.god.botgate.chest.SkillChestLayout.Entry;
import dev.god.botgate.chest.SkillChestLayout.Kind;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

/** Pure fixture tests: no server/world launch, production reads or player mutations. */
public class SkillCompassTest {
    static int assertions;
    static void check(boolean condition, String message) { assertions++; if (!condition) throw new AssertionError(message); }
    static void put(Path dir, String file, String value) throws Exception { Files.writeString(dir.resolve(file), value, StandardCharsets.UTF_8); }
    static SkillChestIO.PanelData load(Path dir) { return SkillChestIO.load(dir.resolve("state.json"), dir.resolve("atoms.json"),
            dir.resolve("waypoints.json"), dir.resolve("panel.json"), dir.resolve("catalog.json"), "TestPlayer"); }
    static List<String> ids(List<SkillChestLayout.SkillInfo> list) { return list.stream().map(s -> s.id).toList(); }
    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("qiandeng-compass-test-");
        try {
            String state = """
                    {"players":{"TestPlayer":{"mana":73,"maxMana":112,"level":2,
                    "learned":["home","give","old_fire","passive_power","missing",{},null,true,72,"home"],"innateSkill":"spring"}}}
                    """;
            put(dir,"state.json", state);
            put(dir,"atoms.json", """
                    {"atoms":[{"id":"home","name":"归途","cost":{"mana":20,"hp":0,"food":0},"requiredLevel":2},
                    {"id":"give","name":"造物","cost":{"mana":20}},
                    {"id":"spring","name":"泉水","cost":{"mana":12}},
                    {"id":"old_fire","name":"旧火","cost":{"mana":5}},
                    {"id":"passive_power","name":"旧天赋","type":"passive"}]}
                    """);
            put(dir,"panel.json", """
                    {"icons":{"more":"minecraft:paper","skill":{"home":"minecraft:paper"}},
                    "chantAlias":{"home":"/op TestPlayer"},"items":[{"cn":"火把","icon":"torch","count":4}]}
                    """);
            String catalog = """
                    {"featured":["spring","home","give","passive_power","home",{},null,true,72],
                    "icons":{"home":"minecraft:compass","give":"minecraft:crafting_table","spring":"minecraft:water_bucket"},
                    "archived":{"old_fire":{"reason":"改用原生法术","nativeHints":["irons_spellbooks:firebolt"]}}}
                    """;
            put(dir,"catalog.json",catalog);
            put(dir,"waypoints.json","{}");
            var data = load(dir);
            check(ids(data.skills).equals(List.of("spring","home","give")), "catalog order, innate union, active only, strict identifiers");
            check(ids(data.archivedSkills).equals(List.of("old_fire","missing")), "old active records retained, passive not castable");
            check(data.mana == 73 && data.maxMana == 112, "real state snapshot");
            check(data.config.stateSummary.contains("同步快照"), "snapshot clearly labelled");
            check(data.config.skillLore.get("home").contains("20 秘术魔力") && data.config.skillLore.get("home").contains("需要等级：2"), "cost and native level requirements");
            var main = SkillChestLayout.build(data.config, data.skills, data.waypoints, 0);
            check(main.size()==27 && main.get(0).kind == Kind.NATIVE && main.get(0).command.equals("qdspell self menu"), "fixed native entry");
            check(main.get(8).kind==Kind.WARP_HUB && main.get(8).command==null, "warp hub opens without teleport");
            check(main.get(10).icon.equals("minecraft:compass") && main.get(10).command.equals("/mycli cast home"), "catalog icon override, canonical cast no arbitrary alias");
            check(main.get(11).kind==Kind.SKILL && main.get(11).command==null && main.get(11).actionable(), "give opens choices first");
            check(main.get(18).kind==Kind.INFO && !main.get(18).actionable() && main.get(26).kind==Kind.INFO, "disabled boundary controls");
            check(main.get(20).kind==Kind.ARCHIVE_HUB && main.get(22).kind==Kind.CLOSE && main.get(24).kind==Kind.REFRESH, "fixed footer");
            var archive = SkillChestLayout.buildArchive(data.config,data.archivedSkills,0);
            check(archive.get(9).kind==Kind.ARCHIVED && archive.get(9).command==null && !archive.get(9).actionable(), "archive never casts");
            check(archive.get(9).lore.contains("irons_spellbooks:firebolt") && archive.get(9).lore.contains("改用原生法术"), "archive replacement help");
            check(archive.get(22).kind==Kind.HOME, "archive return");
            check(Files.readString(dir.resolve("state.json")).equals(state), "learned and passive records unchanged");

            Files.delete(dir.resolve("catalog.json")); data=load(dir);
            check(data.skills.isEmpty() && !data.config.catalogAvailable && data.archivedSkills.size()==5, "missing catalog fails closed, no 72-skill fallback");
            put(dir,"catalog.json","{ malformed"); check(load(dir).skills.isEmpty(), "malformed catalog fails closed");
            put(dir,"catalog.json",catalog); put(dir,"state.json","[]"); data=load(dir);
            check(data.mana==null && data.maxMana==null && data.skills.isEmpty(), "no state not fabricated zero");
            put(dir,"state.json",state);

            JsonObject root=new JsonObject(); JsonArray shared=new JsonArray(), personal=new JsonArray();
            for(int i=0;i<23;i++) { JsonObject w=new JsonObject(); w.addProperty("id",100+i); w.addProperty("name","地点"+i);
                w.addProperty("dim","minecraft:overworld"); w.addProperty("x",i); w.addProperty("y",64); w.addProperty("z",-i);
                (i<21?shared:personal).add(w); }
            root.add("shared",shared); JsonObject players=new JsonObject(); players.add("TestPlayer",personal); root.add("players",players);
            put(dir,"waypoints.json",root.toString()); data=load(dir);
            check(data.waypoints.size()==23 && SkillChestLayout.waypointPagesFor(data.waypoints)==2, "all waypoints including more than 18");
            HashSet<String> refs=new HashSet<>();
            for(int page=0;page<2;page++) {
                var grid=SkillChestLayout.buildWaypoints(data.config,data.waypoints,page);
                for(Entry e:grid) if(e.kind==Kind.WAYPOINT) { check(e.command.equals("/mycli goto "+e.id),"stable ref command"); refs.add(e.id); }
                check(grid.get(22).kind==Kind.HOME && grid.get(24).kind==Kind.REFRESH && grid.get(20).kind==Kind.NATIVE,"waypoint persistent navigation");
            }
            check(refs.size()==23 && refs.contains("shared:108") && refs.contains("personal:122"),"ninth and personal destination reachable");
            check(SkillChestLayout.buildWaypoints(data.config,data.waypoints,999).get(0).id.equals("shared:118"),"page overflow clamped");
            JsonObject duplicate=shared.get(0).getAsJsonObject().deepCopy();shared.add(duplicate);
            JsonObject absent=new JsonObject(); absent.addProperty("name","旧点无ID"); shared.add(absent);
            JsonObject stringId=new JsonObject(); stringId.addProperty("id","108");shared.add(stringId);
            JsonObject unsafe=new JsonObject(); unsafe.addProperty("id",9007199254740992L);shared.add(unsafe);
            put(dir,"waypoints.json",root.toString()); data=load(dir);
            check(data.waypoints.get(0).reference==null && data.waypoints.get(21).reference==null,"duplicate same-scope IDs disabled");
            check(data.waypoints.get(22).reference==null && data.waypoints.get(23).reference==null && data.waypoints.get(24).reference==null,"missing/string/unsafe ID never use sequence number");
            check(SkillChestLayout.buildWaypoints(data.config,data.waypoints,0).get(0).kind==Kind.INFO,"invalid destination visibly read-only");
            check(!SkillChestLayout.validWaypointRef("personal:1 /op x") && !SkillChestLayout.validWaypointRef("shared:1:extra"),"stable ref grammar");

            List<SkillChestLayout.SkillInfo> many=new ArrayList<>();for(int i=0;i<25;i++)many.add(new SkillChestLayout.SkillInfo("skill_"+i));
            check(SkillChestLayout.pagesFor(many)==3,"nine skills per page");
            for(int page=0;page<3;page++) { var grid=SkillChestLayout.buildWheel(data.config,many,page);
                check(grid.get(0).kind==Kind.NATIVE && grid.get(8).kind==Kind.WARP_HUB,"fixed entries every skill page");
                check(grid.get(9).id.equals("skill_"+(page*9)),"skill pagination"); }
            var items=new ArrayList<SkillChestLayout.GiveItem>(); for(int i=0;i<20;i++)items.add(new SkillChestLayout.GiveItem("物品"+i,"torch",4));
            items.add(new SkillChestLayout.GiveItem("一把\"特殊\\火把","minecraft:torch",4));
            items.add(new SkillChestLayout.GiveItem("火把\n/op TestPlayer","torch",4));
            var itemGrid=SkillChestLayout.buildItemGrid(data.config,items,1);
            check(itemGrid.get(2).command.equals("/mycli cast give item=\"一把\\\"特殊\\\\火把\""),"quote/backslash stay one named item argument");
            check(itemGrid.get(3).kind==Kind.EMPTY && itemGrid.get(22).kind==Kind.HOME,"control characters rejected and item return preserved");
            var gate=new SkillChestLayout.ActionGate();
            check(!gate.accept(false,true,true,true),"wrong actor");check(!gate.accept(true,false,true,true),"stale menu");
            check(!gate.accept(true,true,false,true),"shift/drag/drop/right click");check(!gate.accept(true,true,true,false),"archive/info");
            check(gate.accept(true,true,true,true),"first authorized primary click");
            for(int i=0;i<30;i++)check(!gate.accept(true,true,true,true),"repeat click never redispatches");
            put(dir,"atoms.json","{\"atoms\":[{\"id\":\"home\",\"cost\":{\"mana\":-15,\"hp\":6}}]}");
            check(load(dir).config.skillLore.get("home").contains("恢复：15 秘术魔力 / 6 生命"),"negative mana cost shown as recovery");
            System.out.println("SkillCompassTest: "+assertions+" assertions passed");
        } finally {
            try(var files=Files.list(dir)) { for(Path file:files.toList()) Files.delete(file); } Files.delete(dir);
        }
    }
}
