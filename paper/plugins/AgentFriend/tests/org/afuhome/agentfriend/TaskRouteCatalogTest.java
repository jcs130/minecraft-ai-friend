package org.afuhome.agentfriend;

import java.util.List;

public final class TaskRouteCatalogTest {
    private static int checks;
    private static void check(String name, boolean value) { if (!value) throw new AssertionError(name); checks++; }
    public static void main(String[] args) {
        check("six parallel routes", TaskRouteCatalog.ROUTES.size() == 6);
        check("no first farming default", TaskRouteCatalog.ROUTES.getFirst().id().equals("combat"));
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
