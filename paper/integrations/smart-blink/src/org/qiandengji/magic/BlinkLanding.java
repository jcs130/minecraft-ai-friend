// SPDX-License-Identifier: GPL-3.0-or-later
package org.qiandengji.magic;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.bukkit.FluidCollisionMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Lightable;
import org.bukkit.block.data.Waterlogged;
import org.bukkit.entity.Player;
import org.bukkit.util.BoundingBox;
import org.bukkit.util.RayTraceResult;
import org.bukkit.util.Vector;

/** Bounded selection over loaded native collision shapes. No chunk loads or terrain edits. */
public final class BlinkLanding {
    public record Selection(Location destination, String mode, String reason, int blockReads) {
        public boolean found() { return destination != null; }
    }
    private record Key(int x, int y, int z) {}
    private record Cell(Block block, List<BoundingBox> boxes) {}
    private static final double EPS = 1e-5, STEP = .5, MIN_MOVE = .75;
    private static final int MAX_READS = 4096;
    private static final EnumSet<Material> HAZARDS = EnumSet.of(Material.LAVA, Material.FIRE,
            Material.SOUL_FIRE, Material.MAGMA_BLOCK, Material.CACTUS, Material.SWEET_BERRY_BUSH,
            Material.POWDER_SNOW, Material.WITHER_ROSE, Material.POINTED_DRIPSTONE,
            Material.CAMPFIRE, Material.SOUL_CAMPFIRE, Material.NETHER_PORTAL,
            Material.END_PORTAL, Material.END_GATEWAY);
    private final World world;
    private final Location origin, eye;
    private final double range, halfWidth, height;
    private final Map<Key, Cell> cells = new HashMap<>();
    private boolean unloaded;

    public BlinkLanding(Player player, double range) {
        world = player.getWorld(); origin = player.getLocation().clone(); eye = player.getEyeLocation();
        this.range = Math.max(1, Math.min(64, range));
        halfWidth = Math.max(.3, player.getWidth() / 2); height = Math.max(1.8, player.getHeight());
    }

    public Selection select() {
        try {
            RayTraceResult aimed = trace(eye, eye.getDirection(), range);
            if (aimed != null && aimed.getHitBlock() != null) {
                // An explicit target is never silently replaced by a different distant target.
                if (aimed.getHitBlockFace() == BlockFace.DOWN) return result(null, "aimed", "blocked_ceiling");
                Vector hit = aimed.getHitPosition(); Block block = aimed.getHitBlock();
                List<Location> targets = new ArrayList<>(tops(block.getX(), block.getY(), block.getZ(), hit.getX(), hit.getZ()));
                targets.addAll(tops(block.getX(), block.getY(), block.getZ(), block.getX() + .5, block.getZ() + .5));
                targets.sort(Comparator.comparingDouble(at -> at.toVector().distanceSquared(hit)));
                for (Location at : targets) if (safe(at) && clear(eye, at.clone().add(0, eye.getY() - origin.getY(), 0)))
                    return result(at, "aimed", null);
                if (aimed.getHitBlockFace() == BlockFace.UP) return result(null, "aimed", "unsafe_target");
                // A wall face is not a grounded landing. Continue forward only up to its near side.
            }
            // Pitch chooses an explicit target. With no target, yaw selects grounded forward travel.
            double yaw = Math.toRadians(origin.getYaw());
            Vector forward = new Vector(-Math.sin(yaw), 0, Math.cos(yaw));
            double maximum = loadedDistance(eye, forward, range);
            RayTraceResult wall = trace(eye, forward, maximum);
            if (wall != null) maximum = Math.min(maximum, wall.getHitPosition().distance(eye.toVector()) - halfWidth - .02);
            for (double distance = maximum; distance >= MIN_MOVE; distance -= STEP) {
                double x = origin.getX() + forward.getX() * distance;
                double z = origin.getZ() + forward.getZ() * distance;
                double vertical = Math.sqrt(Math.max(0, range * range - distance * distance));
                int low = Math.max(world.getMinHeight(), (int)Math.floor(origin.getY() - vertical) - 2);
                int high = Math.min(world.getMaxHeight() - 1, (int)Math.floor(origin.getY() + vertical));
                List<Location> targets = new ArrayList<>();
                for (int y = low; y <= high; y++) targets.addAll(tops((int)Math.floor(x), y, (int)Math.floor(z), x, z));
                targets.sort(Comparator.comparingDouble(at -> Math.abs(at.getY() - origin.getY())));
                for (Location at : targets) if (safe(at) && clear(eye, at.clone().add(0, eye.getY() - origin.getY(), 0)))
                    return result(at, "forward", null);
            }
            return result(null, "forward", unloaded ? "unloaded_path" : "no_safe_landing");
        } catch (ScanLimit limit) { return result(null, "forward", "scan_limit"); }
    }

    public boolean accepts(Location at) {
        try { return at != null && at.getWorld() == world && safe(at)
                && clear(eye, at.clone().add(0, eye.getY() - origin.getY(), 0)); }
        catch (ScanLimit limit) { return false; }
    }

    private Selection result(Location at, String mode, String reason) {
        if (at != null) { at.setYaw(origin.getYaw()); at.setPitch(origin.getPitch()); }
        return new Selection(at, mode, reason, cells.size());
    }

    private Cell cell(int x, int y, int z) {
        if (y < world.getMinHeight() || y >= world.getMaxHeight()) return null;
        Key key = new Key(x, y, z); Cell known = cells.get(key); if (known != null) return known;
        if (!world.isChunkLoaded(x >> 4, z >> 4)) { unloaded = true; return null; }
        if (cells.size() >= MAX_READS) throw new ScanLimit();
        Block block = world.getBlockAt(x, y, z);
        // Bukkit VoxelShape boxes are block-local; convert once into world coordinates.
        List<BoundingBox> boxes = block.getCollisionShape().getBoundingBoxes().stream()
                .map(box -> box.clone().shift(x, y, z)).toList();
        Cell value = new Cell(block, boxes); cells.put(key, value); return value;
    }

    private List<Location> tops(int x, int y, int z, double px, double pz) {
        Cell value = cell(x, y, z); if (value == null || dangerous(value.block())) return List.of();
        List<Location> result = new ArrayList<>();
        for (BoundingBox box : value.boxes()) if (px >= box.getMinX() - EPS && px <= box.getMaxX() + EPS
                && pz >= box.getMinZ() - EPS && pz <= box.getMaxZ() + EPS)
            result.add(new Location(world, px, box.getMaxY(), pz, origin.getYaw(), origin.getPitch()));
        return result;
    }

    private boolean safe(Location at) {
        if (at.getWorld() != world || !finite(at) || at.getY() < world.getMinHeight()
                || at.getY() + height > world.getMaxHeight()) return false;
        double distance = at.distanceSquared(origin);
        if (distance < MIN_MOVE * MIN_MOVE || distance > range * range + EPS) return false;
        BoundingBox body = new BoundingBox(at.getX() - halfWidth + EPS, at.getY() + EPS, at.getZ() - halfWidth + EPS,
                at.getX() + halfWidth - EPS, at.getY() + height - EPS, at.getZ() + halfWidth - EPS);
        var border = world.getWorldBorder(); Location center = border.getCenter(); double half = border.getSize() / 2;
        // Some kernels round isInside(Location) to block coordinates, accepting half a body outside.
        if (body.getMinX() < center.getX() - half || body.getMaxX() > center.getX() + half
                || body.getMinZ() < center.getZ() - half || body.getMaxZ() > center.getZ() + half) return false;
        for (int x = (int)Math.floor(body.getMinX()); x <= (int)Math.floor(body.getMaxX()); x++)
            for (int z = (int)Math.floor(body.getMinZ()); z <= (int)Math.floor(body.getMaxZ()); z++)
                for (int y = (int)Math.floor(body.getMinY()) - 1; y <= (int)Math.floor(body.getMaxY()); y++) {
                    Cell value = cell(x, y, z); if (value == null) return false;
                    if (value.boxes().stream().anyMatch(body::overlaps)) return false;
                    if (dangerous(value.block()) && body.overlaps(new BoundingBox(x, y, z, x + 1, y + 1, z + 1))) return false;
                }
        int supportY = (int)Math.floor(at.getY() - EPS);
        for (int y = supportY; y >= supportY - 1; y--) {
            Cell support = cell(at.getBlockX(), y, at.getBlockZ());
            if (support != null && !dangerous(support.block()) && support.boxes().stream().anyMatch(box ->
                    Math.abs(box.getMaxY() - at.getY()) < EPS * 2 && at.getX() >= box.getMinX() - EPS
                    && at.getX() <= box.getMaxX() + EPS && at.getZ() >= box.getMinZ() - EPS && at.getZ() <= box.getMaxZ() + EPS)) return true;
        }
        return false;
    }

    private static boolean finite(Location at) {
        return Double.isFinite(at.getX()) && Double.isFinite(at.getY()) && Double.isFinite(at.getZ());
    }

    private static boolean dangerous(Block block) {
        if (block.isLiquid() || block.getBlockData() instanceof Waterlogged water && water.isWaterlogged()) return true;
        if (!HAZARDS.contains(block.getType())) return false;
        return !(block.getBlockData() instanceof Lightable light) || light.isLit();
    }

    private double loadedDistance(Location start, Vector direction, double distance) {
        int x = start.getBlockX() >> 4, z = start.getBlockZ() >> 4;
        double dx = direction.getX(), dz = direction.getZ();
        int sx = dx > EPS ? 1 : dx < -EPS ? -1 : 0;
        int sz = dz > EPS ? 1 : dz < -EPS ? -1 : 0;
        double tx = sx == 0 ? Double.POSITIVE_INFINITY : ((sx > 0 ? (x + 1) * 16.0 : x * 16.0) - start.getX()) / dx;
        double tz = sz == 0 ? Double.POSITIVE_INFINITY : ((sz > 0 ? (z + 1) * 16.0 : z * 16.0) - start.getZ()) / dz;
        double entry = 0;
        // Traverse every crossed chunk, including a final fractional segment and diagonal corners.
        while (entry <= distance + EPS) {
            if (!world.isChunkLoaded(x, z)) { unloaded = true; return Math.max(0, entry - EPS); }
            double next = Math.min(tx, tz); if (!Double.isFinite(next) || next > distance + EPS) break;
            if (tx == next) { x += sx; tx += 16 / Math.abs(dx); }
            if (tz == next) { z += sz; tz += 16 / Math.abs(dz); }
            entry = next;
        }
        return distance;
    }

    private RayTraceResult trace(Location start, Vector direction, double distance) {
        double length = loadedDistance(start, direction, distance);
        return length <= EPS ? null : world.rayTraceBlocks(start, direction, length, FluidCollisionMode.NEVER, true);
    }

    private boolean clear(Location start, Location end) {
        Vector delta = end.toVector().subtract(start.toVector()); double length = delta.length();
        if (length < EPS) return true;
        Vector direction = delta.multiply(1 / length);
        if (loadedDistance(start, direction, length) + EPS < length) return false;
        RayTraceResult hit = world.rayTraceBlocks(start, direction, Math.max(0, length - EPS), FluidCollisionMode.NEVER, true);
        return hit == null;
    }

    private static final class ScanLimit extends RuntimeException {}
}
