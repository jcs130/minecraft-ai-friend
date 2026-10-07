package org.afuhome.agentfriend;

import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;

/** Compare the production scan against the pre-optimization scan, without a server. */
public final class ProspectingScanRegression {
    private record Point(int x, int y, int z) { }
    private record Hit(Point point, Material material) { }
    private static final Material[] ORES = { Material.COAL_ORE, Material.DEEPSLATE_COAL_ORE,
            Material.IRON_ORE, Material.DEEPSLATE_IRON_ORE, Material.COPPER_ORE, Material.DEEPSLATE_COPPER_ORE,
            Material.GOLD_ORE, Material.DEEPSLATE_GOLD_ORE, Material.LAPIS_ORE, Material.DEEPSLATE_LAPIS_ORE,
            Material.DIAMOND_ORE, Material.DEEPSLATE_DIAMOND_ORE, Material.REDSTONE_ORE, Material.DEEPSLATE_REDSTONE_ORE,
            Material.ANCIENT_DEBRIS, Material.EMERALD_ORE, Material.DEEPSLATE_EMERALD_ORE,
            Material.NETHER_GOLD_ORE, Material.NETHER_QUARTZ_ORE };

    public static void main(String[] args) {
        for (int range : new int[] {24, 48}) {
            Probe probe = new Probe(-64, 320, false, Map.of());
            long start = System.nanoTime();
            Hit original = original(probe, 0, 64, 0, range, "all");
            long oldNs = System.nanoTime() - start;
            long count = probe.queries, hash = probe.orderHash;
            probe.reset();
            start = System.nanoTime();
            var result = ProspectingSpell.findClosestOre(new Location(probe.world, .5, 64.5, .5), range, "all");
            long newNs = System.nanoTime() - start;
            check(original == null && result == null, "missing ore became a hit");
            check(probe.queries == count && probe.orderHash == hash, "no-hit block-query order changed");
            long expectedQueries = spherePoints(range);
            check(count == expectedQueries, "no-hit query count differs from the integer sphere");
            long n = range + 1L;
            long oldVisits = n * n * (2 * n * n - 1);
            long surfaceVisits = (2L * range + 1) * (2L * range + 1) * (2L * range + 1);
            System.out.printf("range=%d no-hit: loop bound %d -> %d; actual block queries=%d unchanged;"
                    + " old=%.3fms new=%.3fms (informational)%n", range, oldVisits, surfaceVisits,
                    count, oldNs / 1_000_000.0, newNs / 1_000_000.0);
        }
        Map<Point, Material> ties = Map.of(new Point(-1, 64, 0), Material.DIAMOND_ORE,
                new Point(1, 64, 0), Material.DEEPSLATE_DIAMOND_ORE,
                new Point(0, 64, -1), Material.IRON_ORE);
        compare(new Probe(-64, 320, false, ties), 0, 64, 0, 24, "diamond", new Point(-1, 64, 0));
        compare(new Probe(-64, 320, false, Map.of(new Point(48, 64, 0), Material.DIAMOND_ORE,
                new Point(49, 64, 0), Material.DIAMOND_ORE)), 0, 64, 0, 48, "diamond", new Point(48, 64, 0));
        // The nearer ore is in a missing chunk; the farther loaded ore must win.
        compare(new Probe(-64, 320, true, Map.of(new Point(16, 64, 0), Material.GOLD_ORE,
                new Point(-17, 64, 0), Material.GOLD_ORE)), 15, 64, 0, 48, "gold", new Point(-17, 64, 0));
        // Negative coordinates and height clipping must retain original query order.
        compare(new Probe(-64, -55, false, Map.of(new Point(-20, -64, -18), Material.IRON_ORE,
                new Point(-18, -54, -18), Material.IRON_ORE)), -18, -63, -18, 24, "iron", new Point(-20, -64, -18));
        Random random = new Random(0x5144);
        String[] categories = {"all", "coal", "iron", "copper", "gold", "gems", "diamond", "redstone", "ancient"};
        for (int scenario = 0; scenario < 30; scenario++) {
            Map<Point, Material> ores = new HashMap<>();
            for (int ore = 0; ore < 35; ore++)
                ores.put(new Point(random.nextInt(31) - 15, random.nextInt(25) - 12,
                        random.nextInt(31) - 15), ORES[random.nextInt(ORES.length)]);
            for (String category : categories)
                compare(new Probe(-10, 10, scenario % 2 == 0, ores), 0, 0, 0, 16, category, null);
        }
        System.out.println("PASS: production/original nearest ore, tie order, all categories, world heights,"
                + " unloaded chunks and exact block-query sequence matched (276 scenarios).");
    }

    private static void compare(Probe probe, int sx, int sy, int sz, int range, String category, Point expected) {
        Hit before = original(probe, sx, sy, sz, range, category);
        long count = probe.queries, hash = probe.orderHash, chunks = probe.chunkChecks;
        probe.reset();
        var after = ProspectingSpell.findClosestOre(new Location(probe.world, sx + .5, sy + .5, sz + .5), range, category);
        Hit actual = after == null ? null : new Hit(new Point(after.location().getBlockX(),
                after.location().getBlockY(), after.location().getBlockZ()), after.material());
        check(java.util.Objects.equals(before, actual), "nearest ore changed: " + before + " / " + actual);
        check(probe.queries == count && probe.orderHash == hash && probe.chunkChecks == chunks,
                "query count/order or loaded-only checks changed for " + category);
        if (expected != null) check(actual != null && actual.point.equals(expected), "fixture expected hit changed");
    }

    private static Hit original(Probe probe, int sx, int sy, int sz, int range, String category) {
        Hit closest = null;
        int best = range * range + 1;
        for (int shell = 0; shell <= range && shell * shell < best; shell++) {
            for (int dx = -shell; dx <= shell; dx++) for (int dz = -shell; dz <= shell; dz++) {
                if (!probe.world.isChunkLoaded((sx + dx) >> 4, (sz + dz) >> 4)) continue;
                for (int dy = -shell; dy <= shell; dy++) {
                    if (Math.max(Math.max(Math.abs(dx), Math.abs(dy)), Math.abs(dz)) != shell) continue;
                    int distance = dx * dx + dy * dy + dz * dz;
                    if (distance >= best || distance > range * range) continue;
                    int y = sy + dy;
                    if (y < probe.world.getMinHeight() || y >= probe.world.getMaxHeight()) continue;
                    Material material = probe.world.getBlockAt(sx + dx, y, sz + dz).getType();
                    if (!matches(material, category)) continue;
                    best = distance;
                    closest = new Hit(new Point(sx + dx, y, sz + dz), material);
                }
            }
        }
        return closest;
    }

    private static boolean matches(Material ore, String category) {
        if (!java.util.Arrays.asList(ORES).contains(ore)) return false;
        return switch (category) {
            case "all" -> true;
            case "gems" -> ore.name().contains("DIAMOND_ORE") || ore.name().contains("EMERALD_ORE") || ore.name().contains("LAPIS_ORE");
            case "ancient" -> ore == Material.ANCIENT_DEBRIS;
            default -> ore.name().contains(category.toUpperCase(java.util.Locale.ROOT) + "_ORE");
        };
    }

    private static long spherePoints(int range) {
        long count = 0;
        for (int x = -range; x <= range; x++) for (int y = -range; y <= range; y++)
            for (int z = -range; z <= range; z++) if (x*x + y*y + z*z <= range*range) count++;
        return count;
    }

    private static final class Probe {
        final int min, max;
        final boolean missingPositiveChunk;
        final Map<Point, Material> ores;
        final World world;
        final Block block;
        Point current;
        long queries, orderHash, chunkChecks;

        Probe(int min, int max, boolean missingPositiveChunk, Map<Point, Material> ores) {
            this.min = min; this.max = max; this.missingPositiveChunk = missingPositiveChunk; this.ores = ores;
            block = (Block) Proxy.newProxyInstance(Block.class.getClassLoader(), new Class<?>[] {Block.class},
                    (proxy, method, values) -> switch (method.getName()) {
                        case "getType" -> ores.getOrDefault(current, Material.STONE);
                        default -> throw new AssertionError("Unexpected block action: " + method.getName());
                    });
            world = (World) Proxy.newProxyInstance(World.class.getClassLoader(), new Class<?>[] {World.class},
                    (proxy, method, values) -> switch (method.getName()) {
                        case "getMinHeight" -> min;
                        case "getMaxHeight" -> max;
                        case "isChunkLoaded" -> { chunkChecks++; yield loaded((int) values[0]); }
                        case "getBlockAt" -> {
                            int x = (int) values[0], y = (int) values[1], z = (int) values[2];
                            check(y >= min && y < max && loaded(x >> 4), "queried an unloaded/out-of-height block");
                            current = new Point(x, y, z); queries++;
                            orderHash = (orderHash * 31 + x) * 31 + y; orderHash = orderHash * 31 + z;
                            yield block;
                        }
                        default -> throw new AssertionError("Unexpected world action, including chunk load: " + method.getName());
                    });
        }
        boolean loaded(int chunkX) { return !missingPositiveChunk || chunkX != 1; }
        void reset() { queries = orderHash = chunkChecks = 0; }
    }

    private static void check(boolean valid, String message) { if (!valid) throw new AssertionError(message); }
}
