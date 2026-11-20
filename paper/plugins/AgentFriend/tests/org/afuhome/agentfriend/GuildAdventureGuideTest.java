package org.afuhome.agentfriend;

import java.io.File;
import java.util.List;
import java.util.Set;
import org.bukkit.configuration.file.YamlConfiguration;

public final class GuildAdventureGuideTest {
    private static void check(boolean result, String label) {
        if (!result) throw new AssertionError(label);
    }

    public static void main(String[] args) throws Exception {
        var silver = PromotionHistory.forRank(2);
        var missing = silver.progress(Set.of("camp_scout"), Set.of(0), List.of("0,2", "2,1"));
        check(!missing.complete() && silver.offers("deep_explorer", missing) && silver.offers("pilgrimage", missing),
                "silver prerequisites remain obtainable outside the daily rotation");
        var milestone = silver.progress(Set.of("deep_explorer"), Set.of(1), List.of("0,3"));
        check(!milestone.complete() && !silver.offers("deep_explorer", milestone) && silver.offers("pilgrimage", milestone),
                "only outstanding steps are pinned");
        var category = silver.progress(Set.of("deep_explorer", "tm_new"), Set.of(1), List.of("0,2,5"));
        check(category.complete() && !silver.offers("pilgrimage", category), "settled daily category counts");
        check(silver.progress(Set.of("deep_explorer", "stone_only"), Set.of(1,5), List.of()).complete(),
                "old ledgers with no daily category retain credit");
        check(silver.categoryChoices().containsAll(List.of("pilgrimage","stone_only")) &&
                silver.offers("stone_only",milestone) && !silver.offers("stone_only",category),
                "black iron may choose a walking survey or a combat loadout until either is delivered");
        check(!PilgrimageRoute.reachedTurn(159,true) && PilgrimageRoute.reachedTurn(160,true),
                "survey turn requires both the boundary and an actual outward leg");
        check(!PilgrimageRoute.reachedTurn(499,false) && PilgrimageRoute.reachedTurn(500,false),
                "long walk from a single biome reaches the turn at the advertised distance");
        var walk=PilgrimageRoute.guide("world",-500,70,30,true,90,false,false,"minecraft:river",false);
        check(walk.get("phase").getAsString().equals("outbound") && walk.get("nextAction").getAsString().contains("70格")
                && walk.get("originX").getAsInt()==-500,"survey describes its actual anchor and remaining distance");
        var interrupted=PilgrimageRoute.guide("world",-500,70,30,false,10000,true,false,"",false);
        check(interrupted.get("phase").getAsString().equals("restart_at_origin")&&!interrupted.has("distanceFromOrigin"),
                "cross-dimensional positions never report a fictitious travel distance");
        check(PilgrimageRoute.guide("world",0,70,0,true,400,false,true,"",false).get("phase").getAsString().equals("return"),
                "a previously saved outward checkpoint resumes on the return leg");
        check(PilgrimageRoute.guide("world",0,70,0,false,400,true,false,"",true).get("phase").getAsString().equals("ready_to_submit"),
                "once the walk completed, later travel leaves the hand-in ready");
        var platinum = PromotionHistory.forRank(4);
        var delivered = new java.util.HashSet<String>(Set.of("treasure_vault", "db_20261118_clue", "db_20261119_clue"));
        for (int i=0; i<17; i++) delivered.add("tm_route_"+i);
        var tooFew = platinum.progress(delivered, Set.of(), List.of(4));
        check(tooFew.distinct() == 19 && !tooFew.complete(), "dated repeats count as one template");
        delivered.add("tm_final_route");
        check(platinum.progress(delivered, Set.of(), List.of(4)).complete(), "twenty distinct settled contracts qualify");
        check(!silver.progress(Set.of("tm_similar"), Set.of(5), List.of()).complete(), "category alone cannot replace milestone");
        check(PromotionHistory.forRank(1) == null && PromotionHistory.forRank(6) == null, "no invented ranks");
        var known = Set.of("tm_local_mine_journal", "tm_cave_lantern_survey",
                "tm_mineshaft_echoes", "tm_ruined_portal_runes");
        var rank = GuildAdventureGuide.next(0, true, true, true, true, known::contains);
        check(rank.hint().command().equals("/mycli guild exam promotion"), "rank uses actual promotion query");
        var training = GuildAdventureGuide.next(rank.nextIndex(), true, true, true, true, known::contains);
        check(training.hint().command().endsWith("tm_local_mine_journal"), "beginner starts at surveyed stairs");
        var cave = GuildAdventureGuide.cave(Set.of("tm_cave_lantern_survey", "tm_mineshaft_echoes")::contains);
        check(cave.command().endsWith("tm_cave_lantern_survey"), "completed training advances to natural cave");
        var survey = GuildAdventureGuide.next(training.nextIndex(), true, true, true, true, known::contains);
        check(survey.hint().command().endsWith("tm_ruined_portal_runes"), "natural survey has its own route");
        var dungeon = GuildAdventureGuide.next(survey.nextIndex(), true, true, true, true, known::contains);
        check(dungeon.hint().command().equals("/mycli dungeon list"), "dungeon discovery does not start a run");
        var photo = GuildAdventureGuide.next(dungeon.nextIndex(), true, true, true, true, known::contains);
        check(photo.hint().command().contains("--story") && photo.hint().message().contains("默认私有"), "optional private photo");
        var unavailable = GuildAdventureGuide.next(1, false, false, false, false, id -> false);
        check(unavailable.hint().command().equals("/mycli guild join"), "skip unavailable activities");

        var catalog = new YamlConfiguration();
        catalog.load(new File(args[0], "route-contracts.yml"));
        var task = catalog.getConfigurationSection("tasks.cave_lantern_survey");
        check(task != null && task.getString("repeat").equals("once"), "cave has a stable one-time catalog entry");
        var stages = task.getMapList("steps");
        check(stages.size() == 2 && stages.getFirst().get("goal").equals("biome")
                && stages.getFirst().get("biomes").equals(List.of("minecraft:lush_caves", "minecraft:dripstone_caves"))
                && stages.getLast().get("goal").equals("return"), "real cave coverage and return are separate stages");
        var returnStage = new YamlConfiguration().createSection("return", stages.getLast());
        var area = SurveyArea.parse(returnStage);
        check(area.contains("world", -541, 67, -435) && !area.contains("aincrad", -541, 67, -435), "return checks actual world");
        System.out.println("GuildAdventureGuideTest passed");
    }
}
