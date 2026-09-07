import dev.god.botgate.chest.SkillChestIO;
import dev.god.botgate.chest.SkillChestLayout;
import dev.god.botgate.chest.SkillChestLayout.Kind;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Read actual snapshot fixtures and click contracts without connecting to a game or rewriting state. */
public class SkillbarEditorTest {
    static int assertions;
    static void check(boolean value, String message) { assertions++; if (!value) throw new AssertionError(message); }
    static void put(Path dir, String file, String value) throws Exception { Files.writeString(dir.resolve(file), value, StandardCharsets.UTF_8); }
    static SkillChestIO.PanelData load(Path dir) { return SkillChestIO.load(dir.resolve("state.json"), dir.resolve("atoms.json"),
            dir.resolve("waypoints.json"), dir.resolve("panel.json"), dir.resolve("catalog.json"), "TestPlayer"); }
    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("qiandeng-skillbar-test-");
        try {
            put(dir, "state.json", """
                    {"players":{"TestPlayer":{"mana":70,"maxMana":100,"level":1,
                    "learned":["home","fireworks","old_fire","passive_power","missing"],"innateSkill":"spring",
                    "skillbar":["home","","old_fire",{},"passive_power","home","unlearned","fireworks","spring"],
                    "skillBar":["wrong_camel_case"]}}}
                    """);
            byte[] original = Files.readAllBytes(dir.resolve("state.json"));
            put(dir,"atoms.json", """
                    {"atoms":[{"id":"home","name":"归途","cost":{"mana":20}},
                    {"id":"fireworks","name":"烟花","cost":{"mana":5}},
                    {"id":"spring","name":"泉水","cost":{"mana":12}},
                    {"id":"old_fire","name":"旧火"},{"id":"passive_power","type":"passive"},
                    {"id":"unlearned","name":"未学"}]}
                    """);
            String catalog = """
                    {"featured":["spring","home","fireworks","passive_power","unlearned"],
                    "icons":{"home":"minecraft:compass","fireworks":"minecraft:firework_rocket"},
                    "archived":{"old_fire":{"reason":"旧档保留"}}}
                    """;
            put(dir,"catalog.json",catalog); put(dir,"waypoints.json","{}"); put(dir,"panel.json","{}");
            var data = load(dir);
            check(data.skillbarAvailable && data.skillbar.size() == 8,"lowercase original skillbar reads exactly eight positions");
            check(data.skillbar.get(1).isEmpty() && data.skillbar.get(7).equals("fireworks"),"holes do not collapse or shift slot eight");
            check(data.skillbar.get(2).equals("old_fire") && data.skillbar.get(3).equals("（记录异常）"),"archived and malformed raw slots displayed as disabled labels");
            check(data.skills.stream().map(s -> s.id).toList().equals(List.of("spring","home","fireworks")),"choices require learned or innate, featured, active and real definition");
            var main = SkillChestLayout.build(data.config,data.skills,data.waypoints,0);
            check(main.get(6).kind == Kind.SKILLBAR_HUB && main.get(6).command == null,"compass editor entry never casts");
            check(main.get(0).command.equals("qdspell self menu") && main.get(8).kind == Kind.WARP_HUB,"native and warp entries preserved");
            var editor = SkillChestLayout.buildSkillbar(data.config,data.skills,data.skillbar,data.skillbarAvailable);
            check(editor.size() == 27,"editor retains ordinary controller-compatible three-row chest");
            for (int slot=0;slot<8;slot++) {
                var entry=editor.get(9+slot);
                check(entry.kind==Kind.SKILLBAR_SLOT && entry.id.equals(String.valueOf(slot+1)) && entry.command==null,"every position opens its own slot and cannot cast");
            }
            check(editor.get(11).icon.equals("minecraft:barrier") && editor.get(11).lore.contains("原记录未改写"),"archived slot is visibly unavailable");
            check(editor.get(12).name.contains("记录异常") && editor.get(12).command==null,"malformed slot content is not a command");
            check(editor.get(20).command.equals("/mycli skillbar auto"),"recommendation uses existing world service");
            check(editor.get(22).kind==Kind.HOME && editor.get(24).kind==Kind.REFRESH,"editor has return and fresh snapshot actions");
            var choices=SkillChestLayout.buildSkillbarChoices(data.config,data.skills,data.skillbar,8,0);
            check(choices.get(0).command.equals("/mycli skillbar set 8 spring"),"innate assignment uses canonical ID and eighth position");
            check(choices.get(1).command.equals("/mycli skillbar set 8 home") && choices.get(1).lore.contains("从槽 1 移到此槽"),"rebinding explains core move semantics");
            check(choices.get(2).lore.contains("已在该槽"),"already bound skill is identified");
            check(choices.get(20).command.equals("/mycli skillbar clear 8") && choices.get(20).lore.contains("不会前移"),"clear preserves remaining slot positions");
            check(choices.get(22).kind==Kind.SKILLBAR_HUB,"back from choice page returns to editor");
            check(choices.stream().noneMatch(e -> e.command!=null && e.command.contains("cast")),"configuration has no direct or native cast commands");
            check(choices.stream().noneMatch(e -> e.command!=null && (e.command.contains("old_fire") || e.command.contains("passive_power") || e.command.contains("unlearned"))),"ineligible records cannot generate set commands");
            check(Arrays.equals(original,Files.readAllBytes(dir.resolve("state.json"))),"opening/editor construction does not rewrite earned state or bindings");
            put(dir,"catalog.json","{}"); data=load(dir);
            choices=SkillChestLayout.buildSkillbarChoices(data.config,data.skills,data.skillbar,3,0);
            check(choices.stream().noneMatch(e -> e.command!=null && e.command.contains("skillbar set")),"missing catalogue disables assignments");
            check(choices.get(20).command.equals("/mycli skillbar clear 3"),"clear remains bounded to one chosen slot even if catalog unavailable");
            put(dir,"catalog.json",catalog);
            put(dir,"state.json","{\"players\":{\"TestPlayer\":{\"learned\":[\"home\"],\"skillBar\":[\"fireworks\"]}}}");
            data=load(dir);
            check(!data.skillbarAvailable,"absent lowercase field does not accept invented camel-case storage");
            editor=SkillChestLayout.buildSkillbar(data.config,data.skills,data.skillbar,data.skillbarAvailable);
            check(editor.get(9).name.contains("尚未同步") && editor.get(4).lore.contains("尚未同步"),"missing snapshot never claims a real empty or recommended bar");
            for(int invalid : new int[]{-1,0,9,100}) {
                boolean refused=false;
                try { SkillChestLayout.buildSkillbarChoices(data.config,data.skills,data.skillbar,invalid,0); }
                catch(IllegalArgumentException expected){refused=true;}
                check(refused,"invalid slot cannot create a mutation command");
            }
            var cfg=new SkillChestLayout.Config();cfg.catalogAvailable=true;
            List<SkillChestLayout.SkillInfo> many=new ArrayList<>();
            for(int i=0;i<23;i++){String id="spell_"+i;cfg.featured.add(id);many.add(new SkillChestLayout.SkillInfo(id));}
            many.add(new SkillChestLayout.SkillInfo("home\n/op TestPlayer"));
            var page=SkillChestLayout.buildSkillbarChoices(cfg,many,List.of(),8,1);
            check(page.get(0).command.equals("/mycli skillbar set 8 spell_18") && page.get(4).command.endsWith("spell_22"),"selection pages preserve selected slot beyond eighteen skills");
            check(page.get(18).kind==Kind.BACK && page.get(26).kind==Kind.INFO,"selection navigation has exact page boundaries");
            check(page.stream().noneMatch(e->e.command!=null && e.command.contains("/op")),"malicious IDs cannot reach dispatch");
            var gate=new SkillChestLayout.ActionGate();
            check(!gate.accept(true,true,false,true),"shift/drag/drop cannot edit or take icons");
            check(!gate.accept(false,true,true,true) && !gate.accept(true,false,true,true),"another actor or closed menu cannot edit");
            check(gate.accept(true,true,true,true) && !gate.accept(true,true,true,true),"one legitimate click dispatches once even under repeated packets");
            System.out.println("SkillbarEditorTest: "+assertions+" assertions passed");
        } finally {
            try(var paths=Files.walk(dir)){for(var path:paths.sorted(java.util.Comparator.reverseOrder()).toList())Files.delete(path);}
        }
    }
}
