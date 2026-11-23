package org.afuhome.agentfriend;

import java.util.Map;

final class WorldActivityGuideTest {
    private static int checks;

    public static void main(String[] args) {
        var destinations = Map.of("qd-undead-crypt-gather", "undead_crypt",
                "qd-illager-camp-gather", "illager_camp", "qd-corsair-cove-gather", "corsair_cove");
        destinations.forEach((event, site) -> {
            require(WorldActivityGuide.gathering(event), event + " wakes the existing gathering coach");
            require(WorldActivityGuide.site(event).equals(site), event + " maps to exact site ID");
            var advice = DungeonAdvice.evaluate(site, "测试遗迹", Map.of("configured", true));
            var route = WorldActivityGuide.siteRoute(site, "前哨", "沿道路进入", advice);
            require(route.get("readCommand").getAsString().equals("/mycli dungeon info " + site), "preview is read-only");
            require(route.get("nextCommand").getAsString().equals("/mycli dungeon travel " + site), "known travel, exact ID");
            require(route.get("travelManaOnSuccess").getAsInt() == 8, "charge on accepted travel");
            require(route.get("startCommand").getAsString().equals("/mycli dungeon start " + site + " normal"), "start has supported difficulty token");
            require(route.get("claimCommand").getAsString().equals("/mycli dungeon claim " + site), "claim takes the same ID");
        });
        require(WorldActivityGuide.gathering("qd-trial-gather"), "legacy trial still delivered");
        require(WorldActivityGuide.gathering("qd-ruins-gather"), "legacy expedition still delivered");
        require(!WorldActivityGuide.gathering("qd-clear-sight"), "night vision is not a muster");
        require(!WorldActivityGuide.gathering("unknown"), "unknown provider event doesn't enable the coach");
        require(WorldActivityGuide.site("qd-ruins-gather").isEmpty(), "generic expedition isn't bound to one hard-coded site");
        require(WorldActivityGuide.instruction("qd-explorers-gather").contains("/mycli goto"), "exploration shows transport command");

        String id = "undead_crypt";
        var unavailable = WorldActivityGuide.siteRoute(id, "前哨", "", DungeonAdvice.evaluate(id, "墓穴", Map.of()));
        require(!unavailable.get("available").getAsBoolean(), "unavailable site is explicit");
        require(!unavailable.has("startCommand") && !unavailable.has("travelCommand"), "no executable route advertised for unavailable site");
        var progress = WorldActivityGuide.siteRoute(id, "前哨", "", DungeonAdvice.evaluate(id, "墓穴",
                Map.of("configured", true, "pendingReward", true)));
        require(progress.get("nextCommand").getAsString().equals("/mycli dungeon claim undead_crypt"), "pending reward takes precedence over the invitation");
        var blocked = WorldActivityGuide.siteRoute(id, "前哨", "", DungeonAdvice.evaluate(id, "墓穴",
                Map.of("configured", true, "resetFailed", true)));
        require(blocked.get("nextCommand").getAsString().equals("/mycli dungeon list"), "failed reset is never presented as start now");
        System.out.println("PASS " + checks + " activity route checks");
    }

    private static void require(boolean condition, String detail) {
        checks++;
        if (!condition) throw new AssertionError(detail);
    }
}
