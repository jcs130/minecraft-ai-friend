package org.afuhome.agentfriend;

import java.util.List;

public final class TaskRouteCatalogTest {
    private static int checks;
    private static void check(String name, boolean value) { if (!value) throw new AssertionError(name); checks++; }
    public static void main(String[] args) {
        check("six parallel routes", TaskRouteCatalog.ROUTES.size() == 6);
        check("nearby exploration first", TaskRouteCatalog.ROUTES.getFirst().id().equals("exploration"));
        check("unfinished daily is not a gate", TaskRouteCatalog.discoveryOrder("in_progress", true, false) < TaskRouteCatalog.discoveryOrder("available", false, true));
        check("new discovery before repeat", TaskRouteCatalog.discoveryOrder("available", false, false) < TaskRouteCatalog.discoveryOrder("available", true, true));
        check("available before locked", TaskRouteCatalog.discoveryOrder("available", true, false) < TaskRouteCatalog.discoveryOrder("rank_required", false, true));
        check("completed once at end", TaskRouteCatalog.discoveryOrder("completed_once", true, true) > TaskRouteCatalog.discoveryOrder("available", false, false));
        check("preview next tasks while slot occupied", TaskRouteCatalog.discoveryOrder("another_contract_active", false, true) < TaskRouteCatalog.discoveryOrder("another_contract_active", true, true));
        var full = new com.google.gson.JsonObject(); full.addProperty("id", "tm_example"); full.addProperty("detailCommand", "/mycli tasks info tm_example");
        full.addProperty("description", "long terms are queried on demand");
        var brief = TaskRouteCatalog.boardSummary(full);
        check("board preserves discovery ID and detail command", brief.has("id") && brief.has("detailCommand"));
        check("board avoids duplicated terms", !brief.has("description") && full.has("description"));
        check("human status in Chinese", TaskRouteCatalog.stateText("in_progress").equals("进行中"));
        check("slot gate explicit", TaskRouteCatalog.stateText("another_contract_active").contains("在途"));
        var guidance = new com.google.gson.JsonObject(); guidance.addProperty("nextAction", "去 world(1,64,2) 补种");
        guidance.addProperty("nextCommand", "/mycli tasks status");
        var positions = new com.google.gson.JsonArray(); var position = new com.google.gson.JsonObject();
        position.addProperty("world", "world"); position.addProperty("x", 1); position.addProperty("y", 64); position.addProperty("z", 2); positions.add(position);
        guidance.add("replantTargets", positions); var text = TaskRouteCatalog.guidanceText(guidance);
        check("brief text retains exact positions", text.size() == 3 && text.get(1).contains("world(1,64,2)"));
        check("brief text retains next command", text.getLast().contains("/mycli tasks status"));
        check("brief text is not JSON", text.stream().noneMatch(s -> s.contains("{\"") || s.contains("sessionId")));
        check("combat", TaskRouteCatalog.route("", List.of("KILLS")).equals("combat"));
        check("equipment", TaskRouteCatalog.route("", List.of("CRAFT")).equals("crafting"));
        check("expedition", TaskRouteCatalog.route("", List.of("DIMENSION", "RETURN")).equals("exploration"));
        check("restock", TaskRouteCatalog.route("", List.of("CRAFT", "DONATE")).equals("supply"));
        check("farm remains life", TaskRouteCatalog.route("", List.of("HARVEST", "REPLANT", "DONATE")).equals("life"));
        check("project", TaskRouteCatalog.route("", List.of("CRAFT", "BUILD")).equals("engineering"));
        check("explicit supply fish", TaskRouteCatalog.route("supply", List.of("FISH", "DONATE")).equals("supply"));
        check("newbie can graduate by any commission", TaskRouteCatalog.graduated(true, true, true, true));
        check("catalog proof required", !TaskRouteCatalog.graduated(true, false, true, true));
        check("query alone is not graduation", !TaskRouteCatalog.graduated(true, true, false, false));
        check("partial contract is not graduation", !TaskRouteCatalog.graduated(true, true, true, false));
        check("no retroactive enrollment", !TaskRouteCatalog.graduated(false, true, true, true));
        try { TaskRouteCatalog.route("comabt", List.of("KILLS")); throw new AssertionError("unknown route accepted"); }
        catch (IllegalArgumentException expected) { checks++; }
        System.out.println("TaskRouteCatalogTest: " + checks + " passed");
    }
}
