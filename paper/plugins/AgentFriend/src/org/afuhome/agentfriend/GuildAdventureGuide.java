package org.afuhome.agentfriend;

import java.util.List;
import java.util.function.Predicate;

/** Discovery only. The guild, survey and dungeon managers still own eligibility and progress. */
final class GuildAdventureGuide {
    record Hint(String message, String command) { }
    record Rotation(Hint hint, int nextIndex) { }

    private static final int ROUTE_COUNT = 5;
    private static final List<String> CAVE_TASKS = List.of(
            "tm_local_mine_journal", "tm_cave_lantern_survey", "tm_mineshaft_echoes");
    private static final List<String> RUIN_TASKS = List.of(
            "tm_ruined_portal_runes", "tm_desert_pyramid_archive", "tm_jungle_temple_puzzle");

    static Hint cave(Predicate<String> available) {
        return firstOffer(CAVE_TASKS, available,
                "想下洞？从灯阶实练到天然洞穴、废弃矿井，带照明并记好退路。");
    }

    static Hint photo(String occasion) {
        return new Hint(occasion + "。若想留念，找安全处拍照并写一句见闻；成片入个人箱，默认私有。",
                "/mycli photo take <新照片名> third 1 --story <见闻>");
    }

    private static Hint firstOffer(List<String> ids, Predicate<String> available, String message) {
        for (String id : ids) {
            if (available.test(id)) return new Hint(message, "/mycli tasks info " + id);
        }
        return null;
    }

    static Rotation next(int cursor, boolean joined, boolean promotions, boolean ruins,
                         boolean camera, Predicate<String> available) {
        for (int offset = 0; offset < ROUTE_COUNT; offset++) {
            int route = (Math.floorMod(cursor, ROUTE_COUNT) + offset) % ROUTE_COUNT;
            Hint hint = switch (route) {
                case 0 -> joined
                        ? new Hint("委托交付积累公会声望；到下一阶前先查实际晋级条件。公会段位与职业等级分开。",
                                promotions ? "/mycli guild exam promotion" : "/mycli guild status")
                        : new Hint("想积累冒险履历，可以免费登记冒险者公会。", "/mycli guild join");
                case 1 -> cave(available);
                case 2 -> firstOffer(RUIN_TASKS, available,
                        "想调查自然遗迹？挑一处实地踏查，记录路径与机关，按本人的委托条件交付。");
                case 3 -> ruins ? new Hint("想打逐室遗迹？单人或结伴都可；查开放地点和装备要求，遇到占用就换目标。",
                        "/mycli dungeon list") : null;
                case 4 -> camera ? photo("沿途看到值得记录的景物") : null;
                default -> throw new AssertionError(route);
            };
            if (hint != null) return new Rotation(hint, (route + 1) % ROUTE_COUNT);
        }
        throw new AssertionError("The guild route is always available");
    }
}
