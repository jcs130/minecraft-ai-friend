package org.afuhome.agentfriend;

public final class BiomeBorderTest {
    private static int checks;
    private static BiomeBorder.Point point(String world, double x, double y, String biome) {
        return new BiomeBorder.Point(world, x, y, -460, biome);
    }
    private static void check(String label, boolean ok) {
        if (!ok) throw new AssertionError(label);
        checks++;
    }
    public static void main(String[] args) {
        var shrub = point("overworld-uuid", -530.1, 68, "terralith:shrubland");
        var forest = point("overworld-uuid", -529.9, 68, "terralith:temperate_highlands");
        check("distinct datapack biomes", BiomeBorder.crossed(shrub, forest, false));
        check("vanilla/custom boundary", BiomeBorder.crossed(shrub, point("overworld-uuid", -530.2, 68, "minecraft:forest"), false));
        check("same biome is not a crossing", !BiomeBorder.crossed(shrub, point("overworld-uuid", -531, 68, "terralith:shrubland"), false));
        check("old CUSTOM cannot count", !BiomeBorder.crossed(point("overworld-uuid", -530, 68, "CUSTOM"), forest, false));
        check("old Bukkit key cannot count", !BiomeBorder.crossed(point("overworld-uuid", -530, 68, "minecraft:custom"), forest, false));
        check("unloaded chunk cannot count", !BiomeBorder.crossed(point("overworld-uuid", -530, 68, "unknown"), forest, false));
        check("teleport cannot count", !BiomeBorder.crossed(shrub, forest, true));
        check("world change cannot count", !BiomeBorder.crossed(shrub, point("nether-uuid", -530, 68, "minecraft:nether_wastes"), false));
        check("worlds with same dimension still differ", !BiomeBorder.crossed(shrub, point("other-overworld-uuid", -530, 68, "minecraft:forest"), false));
        check("distant samples cannot count", !BiomeBorder.crossed(shrub, point("overworld-uuid", -400, 68, "minecraft:forest"), false));
        check("vertical crossing works", BiomeBorder.crossed(shrub, point("overworld-uuid", -530.1, 67.9, "minecraft:lush_caves"), false));
        check("no movement cannot count", !BiomeBorder.crossed(shrub, point("overworld-uuid", -530.1, 68, "minecraft:forest"), false));
        check("invalid coordinates cannot count", !BiomeBorder.crossed(shrub, point("overworld-uuid", Double.NaN, 68, "minecraft:forest"), false));
        check("any distance from acceptance is allowed", BiomeBorder.crossed(point("overworld-uuid", 18000, 68, "terralith:shrubland"), point("overworld-uuid", 18000.2, 68, "terralith:temperate_highlands"), false));
        System.out.println("BiomeBorderTest: " + checks + " passed");
    }
}
