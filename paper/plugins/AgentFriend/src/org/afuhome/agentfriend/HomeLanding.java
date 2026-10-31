package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.Lightable;
import org.bukkit.block.data.Waterlogged;
import org.bukkit.entity.Player;
import org.bukkit.util.BoundingBox;

/** Public home only: bounded native collision checks, no terrain edits or chunk generation. */
final class HomeLanding {
    static final int RADIUS = 3, VERTICAL = 2, MAX_READS = 512;
    private static final double EPS = 1e-5;
    private static final EnumSet<Material> HAZARDS = EnumSet.of(Material.LAVA, Material.FIRE,
            Material.SOUL_FIRE, Material.MAGMA_BLOCK, Material.CACTUS, Material.SWEET_BERRY_BUSH,
            Material.POWDER_SNOW, Material.WITHER_ROSE, Material.POINTED_DRIPSTONE,
            Material.CAMPFIRE, Material.SOUL_CAMPFIRE, Material.NETHER_PORTAL,
            Material.END_PORTAL, Material.END_GATEWAY);
    record Issue(String code, String description) {}
    record Selection(Location destination, Issue originalIssue, int blockReads) {
        boolean found() { return destination != null; }
        boolean alternate() { return found() && originalIssue != null; }
    }
    private record Key(int x, int y, int z) {}
    private record Cell(Block block, List<BoundingBox> boxes) {}
    private final Location anchor;
    private final World world;
    private final double halfWidth, height;
    private final Map<Key, Cell> cells = new HashMap<>();

    HomeLanding(Player player, Location anchor) {
        this.anchor = anchor == null ? null : anchor.clone();
        world = anchor == null ? null : anchor.getWorld();
        halfWidth = Math.max(.3, player.getWidth() / 2);
        height = Math.max(1.8, player.getHeight());
    }

    Selection select() {
        if (world == null || !finite(anchor)) return new Selection(null, new Issue("world_unavailable", "村庄传送点未就绪"), 0);
        int cx = anchor.getBlockX() >> 4, cz = anchor.getBlockZ() >> 4;
        // At most the original generated chunk may load; never load all search columns.
        if (!world.isChunkLoaded(cx, cz) && (!world.isChunkGenerated(cx, cz) || !world.loadChunk(cx, cz, false)))
            return new Selection(null, new Issue("chunk_unavailable", "村庄区块未就绪"), 0);
        Issue original;
        try {
            original = inspect(anchor);
            if (original == null) return new Selection(anchor.clone(), null, cells.size());
            List<Location> candidates = new ArrayList<>();
            for (int dx = -RADIUS; dx <= RADIUS; dx++) for (int dz = -RADIUS; dz <= RADIUS; dz++) {
                double x = anchor.getBlockX() + dx + .5, z = anchor.getBlockZ() + dz + .5;
                if (Math.pow(x - anchor.getX(), 2) + Math.pow(z - anchor.getZ(), 2) > RADIUS * RADIUS + EPS) continue;
                for (int y = (int)Math.floor(anchor.getY() - VERTICAL) - 1; y <= (int)Math.floor(anchor.getY() + VERTICAL); y++) {
                    Cell cell = cell((int)Math.floor(x), y, (int)Math.floor(z));
                    if (cell == null || dangerous(cell.block())) continue;
                    for (BoundingBox box : cell.boxes()) {
                        double top = box.getMaxY();
                        if (Math.abs(top - anchor.getY()) > VERTICAL + EPS || x < box.getMinX() || x > box.getMaxX()
                                || z < box.getMinZ() || z > box.getMaxZ()) continue;
                        candidates.add(new Location(world, x, top, z, anchor.getYaw(), anchor.getPitch()));
                    }
                }
            }
            candidates.sort(Comparator.comparingDouble((Location p) -> p.distanceSquared(anchor))
                    .thenComparingDouble(p -> Math.abs(p.getY() - anchor.getY()))
                    .thenComparingDouble(Location::getX).thenComparingDouble(Location::getZ).thenComparingDouble(Location::getY));
            for (Location at : candidates) if (inspect(at) == null) return new Selection(at, original, cells.size());
        } catch (ScanLimit limit) {
            return new Selection(null, new Issue("scan_limit", "附近安全检查达到上限，不能确认可用落点"), cells.size());
        }
        return new Selection(null, original, cells.size());
    }

    /** Fresh checks for teleport redirections: no stale cache or additional chunk load. */
    static boolean accepts(Player player, Location anchor, Location at) {
        try { return new HomeLanding(player, anchor).inspect(at) == null; }
        catch (ScanLimit limit) { return false; }
    }

    /** An exact personal bookmark uses the same native shape checks without searching or loading a neighbor. */
    static Issue exactIssue(Player player, Location at) {
        try { return new HomeLanding(player, at).inspect(at); }
        catch (ScanLimit limit) { return new Issue("scan_limit", "落点安全检查达到上限"); }
    }

    private Issue inspect(Location at) {
        if (world == null || at == null || at.getWorld() != world || !finite(at)) return new Issue("wrong_world", "目标世界或坐标无效");
        if (Math.pow(at.getX() - anchor.getX(), 2) + Math.pow(at.getZ() - anchor.getZ(), 2) > RADIUS * RADIUS + EPS
                || Math.abs(at.getY() - anchor.getY()) > VERTICAL + EPS) return new Issue("outside_search", "目标超出村庄安全搜索范围");
        if (at.getY() < world.getMinHeight() || at.getY() + height > world.getMaxHeight()) return new Issue("world_height", "目标高度不可用");
        BoundingBox body = new BoundingBox(at.getX() - halfWidth + EPS, at.getY() + EPS, at.getZ() - halfWidth + EPS,
                at.getX() + halfWidth - EPS, at.getY() + height - EPS, at.getZ() + halfWidth - EPS);
        var border = world.getWorldBorder(); var center = border.getCenter(); double half = border.getSize() / 2;
        if (body.getMinX() < center.getX() - half || body.getMaxX() > center.getX() + half
                || body.getMinZ() < center.getZ() - half || body.getMaxZ() > center.getZ() + half)
            return new Issue("outside_border", "目标身体越过世界边界");
        for (int x = (int)Math.floor(body.getMinX()); x <= (int)Math.floor(body.getMaxX()); x++)
            for (int z = (int)Math.floor(body.getMinZ()); z <= (int)Math.floor(body.getMaxZ()); z++)
                for (int y = (int)Math.floor(at.getY() - EPS); y <= (int)Math.floor(body.getMaxY()); y++) {
                    Cell cell = cell(x, y, z);
                    if (cell == null) return new Issue("chunk_unavailable", "附近区块未就绪，未强行加载");
                    if (cell.boxes().stream().anyMatch(body::overlaps)) return blocked(cell.block(), "body_blocked", "身体空间受阻");
                    if (dangerous(cell.block()) && body.overlaps(new BoundingBox(x, y, z, x + 1, y + 1, z + 1)))
                        return blocked(cell.block(), "hazard", "身体触及危险方块");
                }
        // All four footprint corners and the center need support at the exact feet height.
        double inset = halfWidth - .02;
        for (double[] point : new double[][]{{at.getX(), at.getZ()}, {at.getX()-inset, at.getZ()-inset},
                {at.getX()-inset, at.getZ()+inset}, {at.getX()+inset, at.getZ()-inset}, {at.getX()+inset, at.getZ()+inset}}) {
            boolean supported = false;
            for (int y = (int)Math.floor(at.getY() - EPS); y >= (int)Math.floor(at.getY() - EPS) - 1; y--) {
                Cell cell = cell((int)Math.floor(point[0]), y, (int)Math.floor(point[1]));
                if (cell == null) return new Issue("chunk_unavailable", "支撑区块未就绪");
                if (dangerous(cell.block()) && cell.boxes().stream().anyMatch(box -> Math.abs(box.getMaxY() - at.getY()) < EPS * 2))
                    return blocked(cell.block(), "hazard", "脚下是危险方块");
                if (cell.boxes().stream().anyMatch(box -> Math.abs(box.getMaxY() - at.getY()) < EPS * 2
                        && point[0] >= box.getMinX() - EPS && point[0] <= box.getMaxX() + EPS
                        && point[1] >= box.getMinZ() - EPS && point[1] <= box.getMaxZ() + EPS)) supported = true;
                if (supported) break;
            }
            if (!supported) return new Issue("no_support", "脚下缺少稳定支撑");
        }
        return null;
    }

    private Cell cell(int x, int y, int z) {
        if (y < world.getMinHeight() || y >= world.getMaxHeight() || !world.isChunkLoaded(x >> 4, z >> 4)) return null;
        Key key = new Key(x, y, z); Cell known = cells.get(key); if (known != null) return known;
        if (cells.size() >= MAX_READS) throw new ScanLimit();
        Block block = world.getBlockAt(x, y, z);
        Cell value = new Cell(block, block.getCollisionShape().getBoundingBoxes().stream().map(box -> box.clone().shift(x, y, z)).toList());
        cells.put(key, value); return value;
    }
    private static boolean finite(Location at) { return Double.isFinite(at.getX()) && Double.isFinite(at.getY()) && Double.isFinite(at.getZ()); }
    private static boolean dangerous(Block b) {
        if (b.isLiquid() || b.getBlockData() instanceof Waterlogged water && water.isWaterlogged()) return true;
        return HAZARDS.contains(b.getType()) && (!(b.getBlockData() instanceof Lightable light) || light.isLit());
    }
    private static Issue blocked(Block b, String code, String description) {
        return new Issue(code, description + "（" + b.getType().getKey() + "，" + b.getWorld().getKey() + " " + b.getX() + "," + b.getY() + "," + b.getZ() + "）");
    }
    private static final class ScanLimit extends RuntimeException {}
}
