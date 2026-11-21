package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Stable activity routes. A route describes actions for the recipient to choose. */
final class WorldActivityGuide {
    private static final Map<String, String> SITES = Map.of(
            "qd-undead-crypt-gather", "undead_crypt",
            "qd-illager-camp-gather", "illager_camp",
            "qd-corsair-cove-gather", "corsair_cove");
    private static final Set<String> GATHERINGS = Set.of("qd-trial-gather", "qd-ruins-gather", "qd-explorers-gather");

    static String site(String event) { return SITES.getOrDefault(event, ""); }
    static boolean gathering(String event) { return GATHERINGS.contains(event) || SITES.containsKey(event); }
    static String info(String site) { return "/mycli dungeon info " + site; }

    static String instruction(String event) {
        return switch (event) {
            case "qd-trial-gather" -> "从罗盘的公共地点选择试炼场，或用 /mycli goto arena（6魔力）。按提示进入围墙内集合平台，查战备后由一人免费开场。";
            case "qd-ruins-gather" -> "选一处遗迹预览路线和装备要求，再传送到外围，沿通道进入首室；战备齐全后由一人开场。";
            case "qd-explorers-gather" -> "用 /mycli waypoint 选择已登记的地点，再用 /mycli goto 对应ID（6魔力）。到达后探索或用 /mycli photo take 旅途留影，成片去个人箱查看。";
            case "qd-clear-sight" -> "夜视期间可结伴探索。选一处遗迹，按地点详情确认入口和首室，前往前先检查装备。";
            case "qd-traveler" -> "在地标目录选地点；确认维度，使用 /mycli goto 对应ID（6魔力）或沿现有道路前往。";
            case "qd-harvest" -> "查看 /mycli world board 中的农事委托，到许可的农田收成熟作物，随后原地补种；按委托详情交付。";
            default -> "";
        };
    }

    static JsonObject siteRoute(String id, String firstRoom, String approachHint, Map<String, Object> advice) {
        var route = new JsonObject();
        route.addProperty("dungeonId", id);
        route.addProperty("siteName", advice.get("name").toString());
        route.addProperty("firstRoom", firstRoom);
        if (!approachHint.isBlank()) route.addProperty("approachHint", approachHint);
        route.addProperty("readCommand", info(id));
        route.addProperty("statusCommand", "/mycli dungeon status " + id);
        route.addProperty("available", Boolean.TRUE.equals(advice.get("available")));
        for (String key : List.of("state", "reason", "nextAction", "nextCommand"))
            route.addProperty(key, advice.get(key).toString());
        if (Boolean.TRUE.equals(advice.get("available"))) {
            route.addProperty("travelCommand", "/mycli dungeon travel " + id);
            route.addProperty("travelManaOnSuccess", 8);
            route.addProperty("startCommand", "/mycli dungeon start " + id + " normal");
            route.addProperty("claimCommand", "/mycli dungeon claim " + id);
        }
        return route;
    }
}
