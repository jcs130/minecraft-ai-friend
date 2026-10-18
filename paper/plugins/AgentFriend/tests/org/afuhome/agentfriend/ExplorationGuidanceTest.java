package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.util.List;

public final class ExplorationGuidanceTest {
    private static int checks;
    private static void check(String name, boolean ok) { if (!ok) throw new AssertionError(name); checks++; }
    private static JsonObject json(String raw) { return JsonParser.parseString(raw).getAsJsonObject(); }
    private static ExplorationObjectives.Target temple() {
        return new ExplorationObjectives.Target(GuildManager.Goal.STRUCTURE, "overworld", List.of("minecraft:jungle_pyramid"), 4, 32, 20, 1, 1, 5);
    }
    private static JsonObject guide(JsonObject nav, JsonObject e, String reason, List<ExplorationGuidance.Landmark> places) {
        return ExplorationGuidance.guide(temple(), 6, nav, e, reason, places, -580, -476);
    }
    public static void main(String[] args) throws Exception {
        var places = ExplorationGuidance.load(java.nio.file.Path.of(args[0]));
        check("original verified destinations retained", places.size() >= 3);
        var nav = json("{\"dimensionMatches\":true,\"requiredDimension\":\"minecraft:overworld\"}");
        var empty = json("{\"ready\":false,\"validCurrentTarget\":false,\"distinctZones\":0}");
        var g = guide(nav, empty, "structure_unobserved_or_start_unloaded", places);
        check("zero progress means find target", g.get("phase").getAsString().equals("find_target"));
        var hint = g.getAsJsonObject("landmark");
        check("match exact structure not named ruins", hint.get("structureKey").getAsString().equals("minecraft:jungle_pyramid"));
        check("fully generated verified coordinate", hint.get("x").getAsInt() == 1607 && hint.get("z").getAsInt() == 2357);
        check("long journey explicitly indicated", hint.get("horizontalDistance").getAsInt() > 3500 && g.get("nextAction").getAsString().contains("直线约"));
        check("no invented safe entrance or Y", !hint.has("y") && !hint.get("entranceVerified").getAsBoolean());
        check("catalog is not arrival evidence", !g.get("targetMatch").getAsBoolean() && !g.get("ready").getAsBoolean());
        check("one missing arrival rather than six zero counters", g.getAsJsonArray("missingConditions").size() == 1);
        check("unknown target never invented", !guide(nav, empty, "", List.of()).has("landmark"));
        var unknown = guide(nav, empty, "", List.of());
        check("unknown location explicit instead of asking an uninformed NPC", unknown.get("reason").getAsString().equals("TARGET_LOCATION_UNKNOWN")
                && unknown.get("nextAction").getAsString().contains("暂未核实") && !unknown.get("nextAction").getAsString().contains("向女神"));
        check("reference does not invite vertical digging", g.get("nextAction").getAsString().contains("不沿坐标竖挖"));
        var wrong = nav.deepCopy(); wrong.addProperty("dimensionMatches", false);
        g = guide(wrong, empty, "outside_survey_target", places);
        check("return dimension first", g.get("phase").getAsString().equals("return_to_required_dimension") && !g.has("landmark"));
        check("wrong mode has corrective step", guide(nav, empty, "outside_survey_target", places).get("phase").getAsString().equals("resume_survival"));
        check("unloaded evidence is not failure", guide(nav, empty, "current_chunk_unloaded", places).get("phase").getAsString().equals("wait_for_terrain"));
        var partial = json("{\"ready\":false,\"validCurrentTarget\":false,\"distinctZones\":4,\"structureInstance\":\"world:jungle:123\",\"lastSurveyPosition\":{\"world\":\"world\",\"x\":1602,\"y\":88,\"z\":2356}}");
        g = guide(nav, partial, "different_structure_or_world", places);
        check("resume original structure", g.get("phase").getAsString().equals("resume_same_structure") && g.has("resumePosition") && !g.has("landmark"));
        check("do not advise destructive reset", g.get("nextAction").getAsString().contains("不必放弃重接"));
        var heightOnly = json("{\"ready\":false,\"validCurrentTarget\":true,\"distinctZones\":6,\"distance\":40,\"movingSeconds\":25,\"distinctSections\":1,\"biomes\":[\"minecraft:jungle\"],\"heightSpan\":2}");
        String before = nav + "|" + heightOnly;
        g = guide(nav, heightOnly, "survey_incomplete", places);
        check("only unsatisfied height shown", g.getAsJsonArray("missingConditions").size() == 1 && g.getAsJsonArray("missingConditions").get(0).getAsString().contains("上下高差还缺3格"));
        check("give actual action instead of query loop", g.get("nextAction").getAsString().contains("上下通道"));
        check("explain zones are not six temples", g.get("nextAction").getAsString().contains("不是多座建筑"));
        check("read-only inputs", before.equals(nav + "|" + heightOnly));
        check("no premature claim", g.get("nextCommand").getAsString().equals("/mycli tasks status"));
        heightOnly.addProperty("ready", true); heightOnly.addProperty("validCurrentTarget", false);
        g = guide(wrong, heightOnly, "ready", places);
        check("ready survives departure", g.get("phase").getAsString().equals("ready_to_submit") && g.get("nextCommand").getAsString().equals("/mycli guild claim"));
        check("completed stages not entire multi-stage task", g.get("nextAction").getAsString().contains("多阶段"));
        check("frozen stage description retained", TaskGuidance.step(GuildManager.Goal.STRUCTURE, "旧规则").equals("旧规则"));
        check("conditions use human world and zone explanation", temple().conditions(6).contains("主世界") && temple().conditions(6).contains("同一座建筑"));
        var forest=new ExplorationObjectives.Target(GuildManager.Goal.BIOME,"nether",List.of("minecraft:crimson_forest"),16,128,30,1,1,0);
        var nether=json("{\"dimensionMatches\":true,\"requiredDimension\":\"minecraft:the_nether\"}");
        var biomeGuide=ExplorationGuidance.guide(forest,6,nether,empty,"outside_survey_biome",places,0,0);
        check("wrong biome names target and an explicit search phase",biomeGuide.get("reason").getAsString().equals("TARGET_BIOME_NOT_ENTERED")&&biomeGuide.get("nextAction").getAsString().contains("minecraft:crimson_forest"));
        check("structure coordinates cannot masquerade as a biome destination",!biomeGuide.has("landmark")&&biomeGuide.get("nextAction").getAsString().contains("暂未登记"));
        var city=new ExplorationObjectives.Target(GuildManager.Goal.STRUCTURE,"overworld",List.of("minecraft:ancient_city"),4,128,75,4,1,0);
        var longTrip=ExplorationGuidance.guide(city,12,nav,empty,"structure_unobserved_or_start_unloaded",places,-544,-438);
        check("distant city is optional, not a mandatory blind journey",longTrip.get("phase").getAsString().equals("plan_optional_expedition")&&longTrip.get("optionalExpedition").getAsBoolean());
        check("offer nearby alternative with canonical entry",longTrip.get("nextCommand").getAsString().equals("/mycli tasks info tm_local_mine_journal")&&longTrip.get("nextAction").getAsString().contains("暂存"));
        check("optional does not count as completed",!longTrip.get("ready").getAsBoolean()&&!longTrip.get("targetMatch").getAsBoolean());
        var part=empty.deepCopy();part.addProperty("distinctZones",1);part.addProperty("structureInstance","original_city");
        var resumeCity=ExplorationGuidance.guide(city,12,nav,part,"different_structure_or_world",places,-544,-438);
        check("existing remote evidence still resumes same city",resumeCity.get("phase").getAsString().equals("resume_same_structure"));
        var area=new SurveyArea("矿棚入口",-666,65,-496,-642,76,-472);
        var local=new ExplorationObjectives.Target(GuildManager.Goal.DIMENSION,"overworld",List.of(),4,8,5,0,1,0,area);
        var near=ExplorationGuidance.guide(local,2,nav,empty,"outside_survey_area",places,-544,-438);
        check("wrong local place gives actual stage boundaries",near.get("phase").getAsString().equals("travel_to_stage_area")&&near.get("nextAction").getAsString().contains("-666..-642"));
        check("no survey credit from an area hint",!near.get("ready").getAsBoolean()&&!near.get("targetMatch").getAsBoolean());
        var temporary = Files.createTempFile("guidance-catalog-", ".json");
        try {
            String original = Files.readString(java.nio.file.Path.of(args[0]));
            for (String invalid : List.of("{broken", " ".repeat(16385), original.replaceAll("\"x\"\\s*:\\s*1607", "\"x\":1607.5"), original.replaceAll("\"entranceVerified\"\\s*:\\s*false", "\"entranceVerified\":true"), original.replaceAll("\"x\"\\s*:\\s*1607", "\"y\":80,\"x\":1607"))) {
                Files.writeString(temporary, invalid);
                try { ExplorationGuidance.load(temporary); throw new AssertionError("invalid catalog accepted"); }
                catch (RuntimeException expected) { checks++; }
            }
            check("missing optional catalog is safe", ExplorationGuidance.load(temporary.resolveSibling("missing-"+System.nanoTime()+".json")).isEmpty());
        } finally { Files.deleteIfExists(temporary); }
        System.out.println("ExplorationGuidanceTest: " + checks + " passed");
    }
}
