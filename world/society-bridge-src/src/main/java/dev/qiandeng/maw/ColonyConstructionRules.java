package dev.qiandeng.maw;

import java.util.List;
import java.util.Set;

/** Fixed original MineColonies resources; caller strings never become registry or file paths. */
final class ColonyConstructionRules {
    static final String PACK = "Minecolonies Original";
    record Hut(String type, String itemId, String blueprintPath) {}
    static final Hut TOWN_HALL = new Hut("townhall", "minecolonies:blockhuttownhall", "fundamentals/townhall1.blueprint");
    static final List<Hut> HUTS = List.of(
            new Hut("builder", "minecolonies:blockhutbuilder", "fundamentals/builder1.blueprint"),
            new Hut("home", "minecolonies:blockhutcitizen", "fundamentals/residence1.blueprint"),
            new Hut("farmer", "minecolonies:blockhutfarmer", "agriculture/horticulture/farmer1.blueprint"),
            new Hut("warehouse", "minecolonies:blockhutwarehouse", "craftsmanship/storage/warehouse1.blueprint"),
            new Hut("blacksmith", "minecolonies:blockhutblacksmith", "craftsmanship/metallurgy/blacksmith1.blueprint"),
            new Hut("university", "minecolonies:blockhutuniversity", "education/university1.blueprint"),
            new Hut("cook", "minecolonies:blockhutcook", "fundamentals/cook1.blueprint"),
            new Hut("deliveryman", "minecolonies:blockhutdeliveryman", "craftsmanship/storage/deliveryman1.blueprint"));

    static Hut hut(String type) {
        return HUTS.stream().filter(hut -> hut.type().equals(type)).findFirst().orElse(null);
    }

    record Point(int x, int y, int z) {}
    record Order(int id, String type, Point position, int targetLevel, boolean claimed, Point claimedBy) {}
    record Confirmation(String code, Order order) {}

    /** A void native request may refuse; only one newly registered matching order confirms it. */
    static Confirmation confirm(Set<Integer> before, List<Order> after, Point target, Point builder) {
        List<Order> matches = after.stream().filter(order -> order.id() > 0 && !before.contains(order.id())
                && (order.type().equals("build") || order.type().equals("upgrade"))
                && order.position().equals(target) && order.targetLevel() > 0
                && order.claimed() && builder.equals(order.claimedBy())).toList();
        if (matches.isEmpty()) return new Confirmation("native_build_request_not_accepted", null);
        if (matches.size() != 1) return new Confirmation("construction_outcome_unknown_check_world", null);
        return new Confirmation("build_requested", matches.getFirst());
    }

    private ColonyConstructionRules() {}
}
