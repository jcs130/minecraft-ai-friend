package org.afuhome.agentfriend;

import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.levelgen.structure.Structure;
import net.minecraft.world.level.levelgen.structure.StructureStart;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.craftbukkit.CraftWorld;
import org.bukkit.craftbukkit.generator.structure.CraftStructure;
import org.bukkit.entity.Hanging;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.*;
import org.bukkit.event.entity.EntityBreakDoorEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.hanging.HangingBreakEvent;
import org.bukkit.event.player.PlayerBucketEmptyEvent;
import org.bukkit.event.player.PlayerBucketFillEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.world.ChunkUnloadEvent;
import org.bukkit.event.world.StructureGrowEvent;

/** Native 1.20.6 structure references; getChunkNow never loads/generates a start chunk. */
final class GeneratedStructureProtection implements Listener {
    private record ChunkKey(UUID world, long position) { }
    private record StartKey(ChunkKey chunk, String structure) { }
    private record Building(ProtectionArea envelope, List<ProtectionArea> pieces) { }
    private record Hit(ProtectionArea area, boolean unknown) { }
    private record Cached(List<Building> buildings, boolean unknown, long at) { }
    private final AgentFriendPlugin plugin;
    private final File file;
    private final Map<ChunkKey, Cached> chunks = new LinkedHashMap<>(32, .75f, true);
    private final Map<StartKey, Building> starts = new LinkedHashMap<>(32, .75f, true);
    private Set<String> namespaces = Set.of(), structures = Set.of();
    private boolean enabled = true, crops = true;
    private long reads, unresolved, errors, lastWarning;

    GeneratedStructureProtection(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        file = new File(plugin.getDataFolder(), "structure-protection.yml");
        if (!file.exists()) plugin.saveResource(file.getName(), false);
        if (!reload().equals("success")) throw new IllegalStateException("Structure protection configuration unavailable");
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }
    String reload() {
        try {
            YamlConfiguration c = new YamlConfiguration(); c.load(file);
            List<String> nextNamespaces = c.getStringList("namespaces"), nextStructures = c.getStringList("structures");
            if (c.getInt("schema-version") != 1 || !c.isBoolean("enabled") || !c.isBoolean("allow-crops")
                    || !c.isList("namespaces") || !c.isList("structures")
                    || c.getList("namespaces").stream().anyMatch(s -> !(s instanceof String))
                    || c.getList("structures").stream().anyMatch(s -> !(s instanceof String))
                    || nextNamespaces.size() > 64 || nextStructures.size() > 256
                    || nextNamespaces.stream().anyMatch(s -> !s.matches("[a-z0-9_.-]+") || s.equals("minecraft"))
                    || nextStructures.stream().anyMatch(s -> !s.matches("[a-z0-9_.-]+:[a-z0-9_./-]+")))
                throw new IllegalArgumentException("structure_rules");
            namespaces = Set.copyOf(nextNamespaces); structures = Set.copyOf(nextStructures);
            enabled = c.getBoolean("enabled"); crops = c.getBoolean("allow-crops");
            chunks.clear(); starts.clear(); return "success";
        } catch (Exception error) {
            plugin.getLogger().warning("Structure rules retained: " + error.getClass().getSimpleName());
            return "invalid_configuration";
        }
    }
    void admin(CommandSender sender, String action) {
        if (action.equals("reload")) sender.sendMessage("Structure rules: " + reload());
        sender.sendMessage("Generated structures enabled=" + enabled + " namespaces=" + namespaces + " ids=" + structures.size()
                + " chunkCache=" + chunks.size() + "/256 startCache=" + starts.size() + "/128 reads=" + reads
                + " unresolved=" + unresolved + " errors=" + errors + " loadPolicy=loaded_only");
    }
    private boolean selected(String key) { return structures.contains(key) || namespaces.contains(key.split(":", 2)[0]); }
    private static ProtectionArea area(String id, String name, World world, net.minecraft.world.level.levelgen.structure.BoundingBox b, String shape) {
        // Native bounds are inclusive. CraftStructurePiece's Bukkit BoundingBox also contains these raw max values.
        return new ProtectionArea(id, name, world, b.minX(), b.minY(), b.minZ(), b.maxX(), b.maxY(), b.maxZ(), shape);
    }
    private Building building(World world, String key, StructureStart start) {
        var b = start.getBoundingBox();
        String id = "generated:" + key + ":" + b.minX() + ":" + b.minY() + ":" + b.minZ();
        List<ProtectionArea> pieces = new ArrayList<>();
        if (start.getPieces().size() > 512) throw new IllegalStateException("structure_piece_limit");
        int index = 0;
        for (var piece : start.getPieces()) pieces.add(area(id + ":" + index++, "遗迹建筑 " + key, world, piece.getBoundingBox(), "cuboid"));
        if (pieces.isEmpty()) throw new IllegalStateException("structure_pieces_missing");
        return new Building(area(id, "遗迹建筑 " + key, world, b, "structure_piece_envelope"), List.copyOf(pieces));
    }
    private Cached read(World world, int x, int z) {
        ChunkKey chunkKey = new ChunkKey(world.getUID(), ChunkPos.asLong(x, z));
        Cached cached = chunks.get(chunkKey);
        if (cached != null && (!cached.unknown || System.currentTimeMillis() - cached.at < 1000)) return cached;
        var level = ((CraftWorld) world).getHandle();
        LevelChunk chunk = level.getChunkSource().getChunkNow(x, z);
        if (chunk == null) return new Cached(List.of(), true, System.currentTimeMillis());
        reads++;
        Map<String, Building> found = new LinkedHashMap<>();
        boolean unknown = false;
        Map<Structure, it.unimi.dsi.fastutil.longs.LongSet> references = new LinkedHashMap<>();
        chunk.getAllReferences().forEach((structure, positions) -> references.put(structure, new it.unimi.dsi.fastutil.longs.LongOpenHashSet(positions)));
        for (var entry : chunk.getAllStarts().entrySet()) {
            if (entry.getValue().isValid()) references.computeIfAbsent(entry.getKey(), s -> new it.unimi.dsi.fastutil.longs.LongOpenHashSet()).add(chunkKey.position);
        }
        for (var entry : references.entrySet()) {
            // Use Craft's keyed wrapper: the legacy plugin remapper confuses the two NMS Registry types.
            String key = CraftStructure.minecraftToBukkit(entry.getKey()).getKey().toString();
            if (!selected(key)) continue;
            if (entry.getValue().size() > 64) throw new IllegalStateException("structure_reference_limit");
            for (long position : entry.getValue()) {
                StartKey startKey = new StartKey(new ChunkKey(world.getUID(), position), key);
                Building building = starts.get(startKey);
                if (building == null) {
                    LevelChunk origin = level.getChunkSource().getChunkNow(ChunkPos.getX(position), ChunkPos.getZ(position));
                    StructureStart start = origin == null ? null : origin.getStartForStructure(entry.getKey());
                    if (start == null || !start.isValid()) { unknown = true; unresolved++; continue; }
                    building = building(world, key, start); starts.put(startKey, building);
                    while (starts.size() > 128) starts.remove(starts.keySet().iterator().next());
                }
                found.put(building.envelope.id(), building);
            }
        }
        Cached result = new Cached(List.copyOf(found.values()), unknown, System.currentTimeMillis());
        chunks.put(chunkKey, result);
        while (chunks.size() > 256) chunks.remove(chunks.keySet().iterator().next());
        return result;
    }
    private Hit hit(Location at) {
        if (!enabled || at == null || at.getWorld() == null) return new Hit(null, false);
        try {
            Cached cached = read(at.getWorld(), at.getBlockX() >> 4, at.getBlockZ() >> 4);
            for (Building b : cached.buildings) {
                if (!b.envelope.contains(at)) continue;
                for (ProtectionArea piece : b.pieces) if (piece.contains(at)) return new Hit(b.envelope, false);
            }
            return new Hit(null, cached.unknown);
        } catch (RuntimeException | LinkageError failure) {
            errors++;
            if (System.currentTimeMillis() - lastWarning > 60000) {
                lastWarning = System.currentTimeMillis(); plugin.getLogger().log(java.util.logging.Level.WARNING, "Native structure bounds unavailable", failure);
            }
            return new Hit(null, true);
        }
    }
    String reason(Location at) { Hit h = hit(at); return h.area != null ? "generated_structure" : h.unknown ? "unknown_generated_structure_bounds" : null; }
    ProtectionArea protectionArea(Location at) { return hit(at).area; }
    private boolean crop(Material type) { return crops && (Tag.CROPS.isTagged(type) || Set.of(Material.SUGAR_CANE, Material.BAMBOO, Material.CACTUS, Material.MELON, Material.PUMPKIN).contains(type)); }
    private boolean plant(Material type) { return crops && (Tag.CROPS.isTagged(type) || type == Material.SUGAR_CANE || type == Material.BAMBOO_SAPLING); }
    boolean deniesEdit(Block block) { return !crop(block.getType()) && reason(block.getLocation()) != null; }
    private void deny(Player player, String action, Block block) {
        String reason = reason(block.getLocation());
        if (reason != null) plugin.protectionAdvisor().denied(player, action, block.getLocation(), reason, protectionArea(block.getLocation()));
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void damage(BlockDamageEvent e) { if (deniesEdit(e.getBlock())) { e.setCancelled(true); deny(e.getPlayer(), "break", e.getBlock()); } }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void broken(BlockBreakEvent e) { if (deniesEdit(e.getBlock())) { e.setCancelled(true); deny(e.getPlayer(), "break", e.getBlock()); } }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void placed(BlockPlaceEvent e) {
        if ((!plant(e.getBlock().getType()) || !crop(e.getBlockReplacedState().getType()) && !e.getBlockReplacedState().getType().isAir()) && reason(e.getBlock().getLocation()) != null) {
            e.setCancelled(true); deny(e.getPlayer(), "place", e.getBlock());
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void multi(BlockMultiPlaceEvent e) {
        for (var state : e.getReplacedBlockStates()) if (reason(state.getLocation()) != null) { e.setCancelled(true); deny(e.getPlayer(), "place", state.getBlock()); return; }
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void empty(PlayerBucketEmptyEvent e) {
        Block b = e.getBlock();
        if (reason(b.getLocation()) == null) b = e.getBlockClicked().getRelative(e.getBlockFace());
        if (reason(b.getLocation()) != null) { e.setCancelled(true); deny(e.getPlayer(), "bucket", b); }
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void fill(PlayerBucketFillEvent e) {
        Block b = e.getBlock(); if (reason(b.getLocation()) != null) { e.setCancelled(true); deny(e.getPlayer(), "bucket", b); }
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void tool(PlayerInteractEvent e) {
        Block b = e.getClickedBlock(); if (b == null || e.getAction() != Action.RIGHT_CLICK_BLOCK || e.getItem() == null || crop(b.getType())) return;
        String tool = e.getItem().getType().name();
        boolean changes = tool.endsWith("_AXE") || tool.endsWith("_SHOVEL") || tool.endsWith("_HOE") || tool.equals("HONEYCOMB") || tool.equals("SHEARS");
        // An axe in hand must still be able to use a door, button or chest.
        String target = b.getType().name();
        boolean surface = Tag.LOGS.isTagged(b.getType()) || target.contains("COPPER") || Set.of(Material.GRASS_BLOCK, Material.DIRT, Material.ROOTED_DIRT, Material.COARSE_DIRT, Material.PODZOL, Material.MYCELIUM, Material.CAMPFIRE, Material.SOUL_CAMPFIRE, Material.VINE).contains(b.getType());
        // Ignition has its own authoritative event; a flint in hand may still open a wooden door.
        if (changes && surface && reason(b.getLocation()) != null) {
            e.setUseInteractedBlock(org.bukkit.event.Event.Result.DENY); e.setUseItemInHand(org.bukkit.event.Event.Result.DENY); deny(e.getPlayer(), "place", b);
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void explode(EntityExplodeEvent e) { e.blockList().removeIf(this::deniesEdit); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void explode(BlockExplodeEvent e) { e.blockList().removeIf(this::deniesEdit); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void burn(BlockBurnEvent e) { if (deniesEdit(e.getBlock())) e.setCancelled(true); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void ignite(BlockIgniteEvent e) { if (reason(e.getBlock().getLocation()) != null) { e.setCancelled(true); if (e.getPlayer() != null) deny(e.getPlayer(), "place", e.getBlock()); } }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void flow(BlockFromToEvent e) {
        Hit to = hit(e.getToBlock().getLocation()); if (to.area == null && !to.unknown) return;
        Hit from = hit(e.getBlock().getLocation());
        boolean internal = from.area != null && to.area != null && from.area.id().equals(to.area.id());
        if (!internal || !(e.getToBlock().getType().isAir() || e.getToBlock().isLiquid() || crop(e.getToBlock().getType()))) e.setCancelled(true);
    }
    private boolean piston(Block piston, List<Block> blocks, org.bukkit.block.BlockFace direction) {
        // Sticky retract events supply the movement direction, opposite to the piston's facing.
        var facing = ((org.bukkit.block.data.Directional) piston.getBlockData()).getFacing();
        Hit origin = hit(piston.getLocation()), head = hit(piston.getRelative(facing).getLocation());
        if (origin.unknown || head.unknown) return false;
        boolean internal = origin.area != null;
        if (head.area != null && (!internal || !head.area.id().equals(origin.area.id()))) return false;
        for (Block b : blocks) {
            Hit from = hit(b.getLocation()), to = hit(b.getRelative(direction).getLocation());
            if (from.unknown || to.unknown) return false;
            if (from.area != null || to.area != null) {
                if (!internal || from.area == null || to.area == null || !from.area.id().equals(origin.area.id()) || !to.area.id().equals(origin.area.id())) return false;
            }
        }
        return true;
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void extend(BlockPistonExtendEvent e) { if (!piston(e.getBlock(), e.getBlocks(), e.getDirection())) e.setCancelled(true); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void retract(BlockPistonRetractEvent e) { if (!piston(e.getBlock(), e.getBlocks(), e.getDirection())) e.setCancelled(true); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void change(EntityChangeBlockEvent e) { if (deniesEdit(e.getBlock())) e.setCancelled(true); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void door(EntityBreakDoorEvent e) { if (deniesEdit(e.getBlock())) e.setCancelled(true); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void grow(StructureGrowEvent e) { if (e.getBlocks().stream().anyMatch(s -> reason(s.getLocation()) != null)) e.setCancelled(true); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void fertilize(BlockFertilizeEvent e) {
        for (var s : e.getBlocks()) if (reason(s.getLocation()) != null && !(crop(s.getBlock().getType()) && crop(s.getType()))) { e.setCancelled(true); if (e.getPlayer() != null) deny(e.getPlayer(), "fertilize", s.getBlock()); return; }
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void spread(BlockSpreadEvent e) { if (reason(e.getBlock().getLocation()) != null && !crop(e.getNewState().getType())) e.setCancelled(true); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void hanging(HangingBreakEvent e) { if (reason(e.getEntity().getLocation()) != null) e.setCancelled(true); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void hangingDamage(EntityDamageEvent e) { if (e.getEntity() instanceof Hanging && reason(e.getEntity().getLocation()) != null) e.setCancelled(true); }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true) public void unloaded(ChunkUnloadEvent e) { chunks.remove(new ChunkKey(e.getWorld().getUID(), ChunkPos.asLong(e.getChunk().getX(), e.getChunk().getZ()))); }
}
