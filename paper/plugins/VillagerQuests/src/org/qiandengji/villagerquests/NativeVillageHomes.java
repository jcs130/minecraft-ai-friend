package org.qiandengji.villagerquests;

import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Registry;
import org.bukkit.Tag;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.Waterlogged;
import org.bukkit.block.data.type.Bed;
import org.bukkit.block.data.type.Door;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Villager;

/** Logical household identity is independent of the current Bukkit entity UUID. */
final class NativeVillageHomes {
    private static final Set<Material> HAZARDS = Set.of(Material.FIRE, Material.SOUL_FIRE, Material.SWEET_BERRY_BUSH,
            Material.WITHER_ROSE, Material.CACTUS, Material.MAGMA_BLOCK, Material.CAMPFIRE, Material.SOUL_CAMPFIRE,
            Material.POWDER_SNOW, Material.POINTED_DRIPSTONE, Material.NETHER_PORTAL, Material.END_PORTAL,
            Material.END_GATEWAY, Material.LAVA, Material.WATER);
    private static final Map<Villager.Profession, Material> WORKSTATIONS = Map.ofEntries(
            Map.entry(Villager.Profession.ARMORER, Material.BLAST_FURNACE),
            Map.entry(Villager.Profession.BUTCHER, Material.SMOKER),
            Map.entry(Villager.Profession.CARTOGRAPHER, Material.CARTOGRAPHY_TABLE),
            Map.entry(Villager.Profession.CLERIC, Material.BREWING_STAND),
            Map.entry(Villager.Profession.FARMER, Material.COMPOSTER),
            Map.entry(Villager.Profession.FISHERMAN, Material.BARREL),
            Map.entry(Villager.Profession.FLETCHER, Material.FLETCHING_TABLE),
            Map.entry(Villager.Profession.LEATHERWORKER, Material.CAULDRON),
            Map.entry(Villager.Profession.LIBRARIAN, Material.LECTERN),
            Map.entry(Villager.Profession.MASON, Material.STONECUTTER),
            Map.entry(Villager.Profession.SHEPHERD, Material.LOOM),
            Map.entry(Villager.Profession.TOOLSMITH, Material.SMITHING_TABLE),
            Map.entry(Villager.Profession.WEAPONSMITH, Material.GRINDSTONE));
    private static final BlockFace[] NEIGHBORS = {
        BlockFace.NORTH, BlockFace.EAST, BlockFace.SOUTH, BlockFace.WEST
    };

    private NativeVillageHomes() {}

    record Point(int x, int y, int z) {
        Point move(BlockFace side) {
            return new Point(x + side.getModX(), y, z + side.getModZ());
        }
        Point up(int delta) { return new Point(x, y + delta, z); }
        int distance(Point to) { return Math.abs(x - to.x) + Math.abs(z - to.z); }
    }

    record Home(String id, UUID characterId, String address, String worldName, Point standing,
                Point bedHead, Point entrance, Point jobSite, Villager.Profession profession) {
        Location spawn() { return location(standing, .5); }
        Location bed() { return location(bedHead, 0); }
        Location door() { return location(entrance, 0); }
        Location work() { return location(jobSite, 0); }

        private Location location(Point point, double center) {
            return new Location(Bukkit.getWorld(worldName), point.x + center, point.y, point.z + center);
        }
    }

    private record Anchor(String world, Point point) {}

    static Map<String, Home> load(ConfigurationSection households) {
        if (households == null) return Map.of();
        Map<String, Home> result = new LinkedHashMap<>();
        Set<UUID> characters = new HashSet<>();
        Set<String> addresses = new HashSet<>();
        Set<Anchor> anchors = new HashSet<>();
        for (String id : households.getKeys(false)) {
            ConfigurationSection row = households.getConfigurationSection(id);
            if (!id.matches("[a-z][a-z0-9_-]{1,47}") || row == null ||
                    !row.getKeys(false).equals(Set.of("characterId", "address", "home", "bed", "door", "work", "profession"))) {
                throw invalid(id);
            }
            String rawId = string(row, "characterId", id);
            UUID character = UUID.fromString(rawId);
            String address = string(row, "address", id);
            String world = string(row, "home.world", id);
            if (!character.toString().equals(rawId) || character.equals(new UUID(0, 0)) || !characters.add(character) ||
                    address.length() > 70 || !addresses.add(address) ||
                    !world.matches("[a-zA-Z0-9_.-]{1,80}")) throw invalid(id);
            Point standing = point(row, "home", id, true);
            Point bed = point(row, "bed", id, false);
            Point door = point(row, "door", id, false);
            Point work = point(row, "work", id, false);
            Villager.Profession profession = Registry.VILLAGER_PROFESSION.get(
                    NamespacedKey.minecraft(string(row, "profession", id)));
            for (Point p : new Point[] {standing, bed, door, work}) {
                if (!anchors.add(new Anchor(world, p)) || p.y != standing.y || standing.distance(p) > 14)
                    throw invalid(id);
            }
            if (profession == null || !WORKSTATIONS.containsKey(profession)) throw invalid(id);
            result.put(id, new Home(id, character, address, world, standing, bed, door, work, profession));
        }
        return Map.copyOf(result);
    }

    private static IllegalArgumentException invalid(String id) {
        return new IllegalArgumentException("Invalid, duplicate or unsupported household: " + id);
    }

    private static Point point(ConfigurationSection row, String key, String id, boolean includesWorld) {
        ConfigurationSection value = row.getConfigurationSection(key);
        Set<String> expected = includesWorld ? Set.of("world", "x", "y", "z") : Set.of("x", "y", "z");
        if (value == null || !expected.equals(value.getKeys(false)) ||
                !value.isInt("x") || !value.isInt("y") || !value.isInt("z")) throw invalid(id);
        Point result = new Point(value.getInt("x"), value.getInt("y"), value.getInt("z"));
        if (Math.abs((long) result.x) > 29_999_984 || Math.abs((long) result.z) > 29_999_984 ||
                result.y < -63 || result.y > 315) throw invalid(id);
        return result;
    }

    private static String string(ConfigurationSection row, String key, String id) {
        String value = row.getString(key);
        if (!row.isString(key) || value == null || value.isBlank() || !value.strip().equals(value) ||
                value.codePoints().anyMatch(Character::isISOControl)) throw invalid(id);
        return value;
    }

    /** Checks real blocks on the main thread without loading or generating chunks. */
    static boolean ready(Home home) {
        World world = Bukkit.getWorld(home.worldName());
        if (world == null || !world.getWorldBorder().isInside(home.spawn()) ||
                !standable(world, home.standing()) || !roofed(world, home.standing())) return false;
        Block lower = block(world, home.entrance());
        Block upper = block(world, home.entrance().up(1));
        Block bed = block(world, home.bedHead());
        Block work = block(world, home.jobSite());
        if (lower == null || upper == null || bed == null || work == null ||
                !Tag.WOODEN_DOORS.isTagged(lower.getType()) || lower.getType() != upper.getType() ||
                !(lower.getBlockData() instanceof Door door) || door.getHalf() != Bisected.Half.BOTTOM ||
                !(upper.getBlockData() instanceof Door top) || top.getHalf() != Bisected.Half.TOP ||
                top.getFacing() != door.getFacing() || top.isOpen() != door.isOpen() ||
                !(bed.getBlockData() instanceof Bed head) || head.getPart() != Bed.Part.HEAD ||
                work.getType() != WORKSTATIONS.get(home.profession()) || !roofed(world, home.bedHead())) return false;
        Point bedFoot = home.bedHead().move(head.getFacing().getOppositeFace());
        Block foot = block(world, bedFoot);
        if (foot == null || foot.getType() != bed.getType() ||
                !(foot.getBlockData() instanceof Bed other) || other.getPart() != Bed.Part.FOOT ||
                other.getFacing() != head.getFacing() || !supported(world, bedFoot) ||
                !supported(world, home.bedHead()) || !supported(world, home.entrance()) ||
                !safeAir(block(world, bedFoot.up(1))) || !safeAir(block(world, home.bedHead().up(1)))) return false;
        Point sideA = home.entrance().move(door.getFacing());
        Point sideB = home.entrance().move(door.getFacing().getOppositeFace());
        if (!standable(world, sideA) || !standable(world, sideB)) return false;
        Set<Point> reachable = room(world, home.standing(), home.entrance());
        return (reachable.contains(sideA) || reachable.contains(sideB)) &&
                adjacent(reachable, home.bedHead(), bedFoot) && adjacent(reachable, home.jobSite(), home.jobSite());
    }

    private static boolean adjacent(Set<Point> reachable, Point first, Point second) {
        for (BlockFace face : NEIGHBORS)
            if (reachable.contains(first.move(face)) || reachable.contains(second.move(face))) return true;
        return false;
    }

    private static Set<Point> room(World world, Point start, Point entrance) {
        Set<Point> visited = new HashSet<>();
        ArrayDeque<Point> queue = new ArrayDeque<>();
        visited.add(start);
        queue.addLast(start);
        while (!queue.isEmpty()) {
            Point here = queue.removeFirst();
            for (BlockFace face : NEIGHBORS) {
                Point next = here.move(face);
                if (next.distance(start) <= 16 && !next.equals(entrance) && !visited.contains(next) &&
                        roofed(world, next) && standable(world, next)) {
                    visited.add(next);
                    queue.addLast(next);
                }
            }
        }
        return visited;
    }

    private static boolean roofed(World world, Point at) {
        for (int delta = 2; delta <= 6; delta++) {
            Block above = block(world, at.up(delta));
            if (above == null) return false;
            if (above.getType().isSolid() && !HAZARDS.contains(above.getType())) return true;
        }
        return false;
    }

    private static boolean standable(World world, Point at) {
        return safeAir(block(world, at)) && safeAir(block(world, at.up(1))) && supported(world, at);
    }

    private static boolean safeAir(Block block) {
        return block != null && block.isPassable() && !block.isLiquid() && !HAZARDS.contains(block.getType()) &&
                (!(block.getBlockData() instanceof Waterlogged water) || !water.isWaterlogged());
    }

    private static boolean supported(World world, Point at) {
        Block down = block(world, at.up(-1));
        return down != null && down.getType().isSolid() && !HAZARDS.contains(down.getType());
    }

    private static Block block(World world, Point at) {
        if (at.y < world.getMinHeight() || at.y >= world.getMaxHeight() ||
                !world.isChunkLoaded(at.x >> 4, at.z >> 4)) return null;
        return world.getBlockAt(at.x, at.y, at.z);
    }
}
