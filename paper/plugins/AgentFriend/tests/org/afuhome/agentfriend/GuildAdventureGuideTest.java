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
