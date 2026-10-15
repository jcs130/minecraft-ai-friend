package org.afuhome.agentfriend;

import java.util.List;
import java.util.Set;

/** Small discovery vocabulary; task contents/rewards/conditions remain editable YAML. */
final class TaskRouteCatalog {
    record Route(String id, String title, String icon, String description) { }
    static final List<Route> ROUTES = List.of(
            new Route("combat", "战斗讨伐", "IRON_SWORD", "按怪物种类、数量和武器完成讨伐，积累声望与装备。"),
            new Route("crafting", "装备制造", "ANVIL", "从基础武器、防具和工具制作起步，亲手合成才计数。"),
            new Route("exploration", "探索跑图", "COMPASS", "调查真实路线、地形与遗迹；只到坐标不等于完成探索。"),
            new Route("supply", "后勤补给", "CHEST", "制作并交付口粮、照明或装备，物资真正进入公共箱。"),
            new Route("engineering", "建造工程", "BRICKS", "按场地建房、修路、架桥或调试机关，验收真实结构。"),
            new Route("life", "田园与生活", "WHEAT", "自由选择种植、钓鱼、烹饪、写作、摄影和居民事务。"));
    private TaskRouteCatalog() { }
    static Route find(String id) { return ROUTES.stream().filter(r -> r.id.equals(id)).findFirst().orElse(null); }
    static String route(String configured, List<String> goals) {
        if (!configured.isEmpty()) {
            if (find(configured) == null) throw new IllegalArgumentException("unknown route " + configured);
            return configured;
        }
        if (goals.stream().anyMatch(Set.of("BRIDGE", "ROAD", "BUILD", "REDSTONE")::contains)) return "engineering";
        if (goals.stream().anyMatch(Set.of("KILLS", "WITCH_KILLS", "MELEE_KILLS", "PARRY", "MARK_KILLS", "HEALING", "FLOOR", "PARTY_FLOOR", "SITE_CLEAR")::contains)) return "combat";
        if (goals.stream().anyMatch(Set.of("EXPLORER", "EXPLORE", "PEAK", "DIMENSION", "STRUCTURE", "BIOME", "RETURN", "MAP_HUNT")::contains)) return "exploration";
        if (goals.stream().anyMatch(Set.of("HARVEST", "REPLANT", "FISH", "PHOTO", "PHOTO_HANG", "TRADE")::contains)) return "life";
        if (goals.contains("DONATE")) return "supply";
        if (goals.contains("CRAFT")) return "crafting";
        return "life";
    }
    static boolean graduated(boolean started, boolean catalog, boolean cast, boolean anyCommission) {
        return started && catalog && cast && anyCommission;
    }
}
