package org.afuhome.agentfriend;

import java.util.List;
import java.util.Set;

/** Small discovery vocabulary; task contents/rewards/conditions remain editable YAML. */
final class TaskRouteCatalog {
    record Route(String id, String title, String icon, String description) { }
    static final List<Route> ROUTES = List.of(
            new Route("exploration", "探索与发现", "COMPASS", "先走附近村路、画廊和矿棚，再调查遗迹与异世界；看阶段指引逐段返程。"),
            new Route("combat", "讨伐与副本", "IRON_SWORD", "野外讨伐、普通试炼塔按层挑战、遗迹地下城逐室探险；出发前查公共补给。"),
            new Route("crafting", "装备制造", "ANVIL", "从基础武器、防具和工具制作起步，亲手合成才计数。"),
            new Route("supply", "后勤补给", "CHEST", "制作并交付口粮、照明或装备，物资真正进入公共箱。"),
            new Route("engineering", "建造工程", "BRICKS", "按场地建房、修路、架桥或调试机关，验收真实结构。"),
            new Route("life", "田园与生活", "WHEAT", "自由选择种植、钓鱼、烹饪、写作、摄影和居民事务。"));
    private TaskRouteCatalog() { }
    static String stateText(String state) {
        return switch (state) {
            case "available" -> "可接";
            case "in_progress" -> "进行中";
            case "another_contract_active" -> "先完成在途委托";
            case "done_today" -> "今日已完成";
            case "completed_once" -> "已完成";
            case "paused" -> "已暂存";
            case "rank_required" -> "等级不足";
            default -> "条件未满足：" + state;
        };
    }
    static List<String> guidanceText(com.google.gson.JsonObject guide) {
        var lines = new java.util.ArrayList<String>();
        if (guide.has("nextAction")) lines.add("§a下一步：" + guide.get("nextAction").getAsString());
        if (guide.has("replantTargets") && !guide.getAsJsonArray("replantTargets").isEmpty()) {
            var targets = new java.util.ArrayList<String>();
            for (var value : guide.getAsJsonArray("replantTargets")) {
                var p = value.getAsJsonObject(); targets.add(p.get("world").getAsString() + "(" + p.get("x").getAsInt() + "," + p.get("y").getAsInt() + "," + p.get("z").getAsInt() + ")");
            }
            lines.add("§e待补种原格：" + String.join("、", targets));
        }
        if (guide.has("nextCommand")) lines.add("§7命令：" + guide.get("nextCommand").getAsString());
        return List.copyOf(lines);
    }
    static com.google.gson.JsonObject boardSummary(com.google.gson.JsonObject full) {
        var out = new com.google.gson.JsonObject();
        for (String key : List.of("id", "title", "state", "route", "icon", "detailCommand"))
            if (full.has(key)) out.add(key, full.get(key).deepCopy());
        if (out.has("id")) out.addProperty("detailCommand", "/mycli tasks info " + out.get("id").getAsString());
        return out;
    }
    /** Keep actual eligibility, first discoveries and ongoing work ahead of daily repeats. */
    static int discoveryOrder(String state, boolean completedBefore, boolean beginner) {
        int order = switch (state) {
            case "in_progress" -> 0;
            case "available" -> 10;
            case "another_contract_active" -> 20;
            case "done_today" -> 60;
            case "completed_once" -> 70;
            default -> 40;
        };
        return order + (completedBefore ? 5 : 0) + (beginner ? 0 : 2);
    }
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
