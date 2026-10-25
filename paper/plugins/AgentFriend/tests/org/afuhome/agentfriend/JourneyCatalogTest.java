package org.afuhome.agentfriend;

import java.io.File;
import java.util.HashSet;
import org.bukkit.configuration.file.YamlConfiguration;

public final class JourneyCatalogTest {
    private static int checks;
    private static void check(String name, boolean value) { if (!value) throw new AssertionError(name); checks++; }
    public static void main(String[] args) throws Exception {
        File root = new File(args[0]); var ids = new HashSet<String>();
        for (String file : new String[]{"task-market.yml", "route-contracts.yml", "resident-contracts.yml"}) {
            var yaml = new YamlConfiguration(); yaml.load(new File(root, file));
            for (String key : yaml.getConfigurationSection("tasks").getKeys(false)) check("unique task " + key, ids.add("tm_" + key));
        }
        check("within task budget", ids.size() <= 64);
        var board = new YamlConfiguration(); board.load(new File(root, "world-life.yml"));
        var cards = board.getStringList("contracts");
        check("nearby discoveries first", cards.getFirst().equals("tm_local_village_notes"));
        check("trial is discoverable", cards.contains("tm_starter_tower"));
        check("dungeon is discoverable", cards.contains("tm_crypt_report"));
        check("farming offers withdrawn", !cards.contains("tm_field_cycle") && !cards.contains("tm_vegetable_cycle"));
        check("board bounded and unique", cards.size() <= 36 && new HashSet<>(cards).size() == cards.size());
        for (String id : cards) check("real task " + id, ids.contains(id));
        var routes = new YamlConfiguration(); routes.load(new File(root, "route-contracts.yml"));
        var tower = routes.getConfigurationSection("tasks.starter_tower");
        check("trial once not daily grind", tower.getString("repeat").equals("once"));
        check("trial real floor goal", tower.getMapList("steps").getFirst().get("goal").equals("floor"));
        check("floor two not full tower", ((Number) tower.getMapList("steps").getFirst().get("floor")).intValue() == 2);
        check("supplies available without farming", tower.getString("description").contains("guild shared"));
        var onboarding = new YamlConfiguration(); onboarding.load(new File(root, "onboarding.yml"));
        String complete = onboarding.getString("steps.complete.message");
        check("graduate has dungeon and trial entrances", complete.contains("dungeon list") && complete.contains("arena status"));
        check("one welcome not repeat spam", onboarding.getInt("welcome-revision") == 15);
        System.out.println("JourneyCatalogTest: " + checks + " passed");
    }
}
