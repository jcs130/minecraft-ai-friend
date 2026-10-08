package org.afuhome.agentfriend;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockState;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockFromToEvent;
import org.bukkit.event.block.BlockMultiPlaceEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityExplodeEvent;

/** Protects a one-time snapshot of original house fabric, not whole house volumes. */
final class VillageStructureProtection implements Listener {
    private record Box(int minX, int minY, int minZ, int maxX, int maxY, int maxZ) {
        boolean contains(Location at) {
            return at.getBlockX() >= minX && at.getBlockX() <= maxX
                    && at.getBlockY() >= minY && at.getBlockY() <= maxY
                    && at.getBlockZ() >= minZ && at.getBlockZ() <= maxZ;
        }
    }

    private final AgentFriendPlugin plugin;
    private final World world;
    private final List<Box> houses = new ArrayList<>();
    private final Map<String, Material> original = new HashMap<>();
    private boolean ready;

    VillageStructureProtection(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        this.world = Bukkit.getWorld("world");
        if (world != null) {
            try {
                readHouses();
                readOrCapture();
                ready = true;
                plugin.getLogger().info("Village structure mask ready: " + houses.size()
                        + " houses, " + original.size() + " original building blocks");
            } catch (Exception error) {
                plugin.getLogger().severe("Village structure mask unavailable; village edits fail closed: " + error);
            }
        }
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }

    boolean isReady() { return ready; }
    int protectedCount() { return original.size(); }

    private void readHouses() throws IOException {
        File serverRoot = world.getWorldFolder().getParentFile();
        File regions = new File(serverRoot, "plugins/WorldGuard/worlds/world/regions.yml");
        if (!regions.isFile()) throw new IOException("WorldGuard regions.yml missing");
        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(regions);
        ConfigurationSection all = yaml.getConfigurationSection("regions");
        if (all == null) throw new IOException("WorldGuard regions section missing");
        for (String id : all.getKeys(false)) {
            if (!id.matches("afu_house_\\d{2}")) continue;
            ConfigurationSection region = all.getConfigurationSection(id);
            if (region == null || !"afu_village".equals(region.getString("parent")))
                throw new IOException(id + " has an unexpected parent");
            ConfigurationSection min = region.getConfigurationSection("min");
            ConfigurationSection max = region.getConfigurationSection("max");
            if (min == null || max == null) throw new IOException(id + " has no bounds");
            Box box = new Box(min.getInt("x"), min.getInt("y"), min.getInt("z"),
                    max.getInt("x"), max.getInt("y"), max.getInt("z"));
            if (box.minX > box.maxX || box.minY > box.maxY || box.minZ > box.maxZ
                    || box.minX < -650 || box.maxX > -430 || box.minZ < -550 || box.maxZ > -330)
                throw new IOException(id + " bounds outside the known village");
            houses.add(box);
        }
        if (houses.size() != 23) throw new IOException("expected 23 houses, found " + houses.size());
    }

    private static String key(int x, int y, int z) { return x + "," + y + "," + z; }
    private static String key(Block block) { return key(block.getX(), block.getY(), block.getZ()); }

    private static boolean building(Material type) {
        String name = type.name();
        if (name.endsWith("_LEAVES") || name.endsWith("_SAPLING")) return false;
        return name.endsWith("_PLANKS") || name.endsWith("_LOG") || name.endsWith("_WOOD")
                || name.endsWith("_STAIRS") || name.endsWith("_SLAB")
                || name.endsWith("_FENCE") || name.endsWith("_FENCE_GATE")
                || name.endsWith("_DOOR") || name.endsWith("_TRAPDOOR")
                || name.endsWith("_WALL") || name.endsWith("_PANE")
                || name.endsWith("_GLASS") || name.endsWith("_BRICKS")
                || name.endsWith("_TERRACOTTA") || name.endsWith("_BED")
                || name.endsWith("_CARPET") || name.endsWith("_SIGN")
                || name.endsWith("_HANGING_SIGN") || name.endsWith("_BUTTON")
                || name.equals("COBBLESTONE") || name.equals("MOSSY_COBBLESTONE")
                || name.equals("BRICKS") || name.equals("BARREL") || name.equals("CHEST")
                || name.equals("CRAFTING_TABLE") || name.equals("FURNACE")
                || name.equals("BLAST_FURNACE") || name.equals("SMOKER")
                || name.equals("LANTERN") || name.equals("SOUL_LANTERN")
                || name.equals("TORCH") || name.equals("WALL_TORCH")
                || name.equals("CAMPFIRE") || name.equals("BELL")
                || name.equals("CAULDRON") || name.equals("IRON_BARS");
    }

    private Path maskPath() { return plugin.getDataFolder().toPath().resolve("village-structure-mask.tsv"); }

    private void readOrCapture() throws IOException {
        Path mask = maskPath();
        UUID id = world.getUID();
        if (Files.exists(mask)) {
            List<String> lines = Files.readAllLines(mask, StandardCharsets.UTF_8);
            if (lines.isEmpty() || !lines.get(0).equals("world=" + id))
                throw new IOException("mask world UUID mismatch; do not overwrite an existing mask");
            for (int index = 1; index < lines.size(); index++) {
                String[] fields = lines.get(index).split("\\t", 2);
                if (fields.length != 2) throw new IOException("bad mask row " + index);
                Material material = Material.matchMaterial(fields[1]);
                if (material == null) throw new IOException("unknown mask material " + fields[1]);
                original.put(fields[0], material);
            }
            if (original.size() < 500) throw new IOException("mask unexpectedly small");
            return;
        }
        for (Box box : houses) {
            for (int x = box.minX; x <= box.maxX; x++)
                for (int z = box.minZ; z <= box.maxZ; z++)
                    for (int y = box.minY; y <= box.maxY; y++) {
                        Block block = world.getBlockAt(x, y, z);
                        if (building(block.getType())) original.put(key(x, y, z), block.getType());
                    }
        }
        if (original.size() < 500) throw new IOException("capture unexpectedly small");
        Files.createDirectories(mask.getParent());
        Path pending = mask.resolveSibling(mask.getFileName() + ".pending");
        List<String> lines = new ArrayList<>(original.size() + 1);
        lines.add("world=" + id);
        original.entrySet().stream().sorted(Map.Entry.comparingByKey())
                .forEach(entry -> lines.add(entry.getKey() + "\t" + entry.getValue().name()));
        Files.write(pending, lines, StandardCharsets.UTF_8);
        try { Files.move(pending, mask, StandardCopyOption.ATOMIC_MOVE); }
        catch (IOException unavailable) { Files.move(pending, mask, StandardCopyOption.REPLACE_EXISTING); }
    }

    private boolean inVillage(Location at) {
        return at.getWorld() == world && at.getBlockX() >= -650 && at.getBlockX() <= -430
                && at.getBlockZ() >= -550 && at.getBlockZ() <= -330;
    }

    private boolean house(Location at) {
        if (at.getWorld() != world) return false;
        for (Box box : houses) if (box.contains(at)) return true;
        return false;
    }

    private boolean protectedOriginal(Block block) {
        if (!house(block.getLocation())) return false;
        Material baseline = original.get(key(block));
        return baseline != null && baseline == block.getType();
    }

    private boolean protectedOriginal(BlockState state) {
        if (!house(state.getLocation())) return false;
        Material baseline = original.get(key(state.getX(), state.getY(), state.getZ()));
        return baseline != null && baseline == state.getType();
    }

    private boolean failClosed(Block block) { return !ready && inVillage(block.getLocation()); }

    boolean deniesEdit(Block block) { return failClosed(block) || protectedOriginal(block); }
    boolean deniesEdit(org.bukkit.entity.Player player, Block block) {
        return deniesEdit(block) && !(ready && plugin.lands() != null && plugin.lands().fabricAllowed(player, block));
    }

    @EventHandler(priority = EventPriority.HIGHEST) public void onBreak(BlockBreakEvent event) {
        if (deniesEdit(event.getPlayer(), event.getBlock())) {
            event.setCancelled(true);
            event.getPlayer().sendMessage("§e这块属于村庄原有建筑；旁边的树叶、草木和自己放的方块可以正常整理。");
        }
    }

    @EventHandler(priority = EventPriority.HIGHEST) public void onPlace(BlockPlaceEvent event) {
        if ((failClosed(event.getBlock()) || protectedOriginal(event.getBlockReplacedState()))
                && !(ready && plugin.lands() != null && plugin.lands().fabricAllowed(event.getPlayer(), event.getBlock())))
            event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.HIGHEST) public void onMultiPlace(BlockMultiPlaceEvent event) {
        for (BlockState replaced : event.getReplacedBlockStates())
            if ((failClosed(replaced.getBlock()) || protectedOriginal(replaced))
                    && !(ready && plugin.lands() != null && plugin.lands().fabricAllowed(event.getPlayer(), replaced.getBlock()))) {
                event.setCancelled(true);
                return;
            }
    }

    @EventHandler public void onBurn(BlockBurnEvent event) {
        if (protectedOriginal(event.getBlock()) || failClosed(event.getBlock())) event.setCancelled(true);
    }
    @EventHandler public void onFlow(BlockFromToEvent event) {
        if (protectedOriginal(event.getToBlock()) || failClosed(event.getToBlock())) event.setCancelled(true);
    }
    @EventHandler public void onEntityChange(EntityChangeBlockEvent event) {
        if (protectedOriginal(event.getBlock()) || failClosed(event.getBlock())) event.setCancelled(true);
    }
    @EventHandler public void onPistonExtend(BlockPistonExtendEvent event) {
        if (event.getBlocks().stream().anyMatch(this::protectedOriginal)) event.setCancelled(true);
    }
    @EventHandler public void onPistonRetract(BlockPistonRetractEvent event) {
        if (event.getBlocks().stream().anyMatch(this::protectedOriginal)) event.setCancelled(true);
    }
    @EventHandler public void onExplosion(EntityExplodeEvent event) {
        event.blockList().removeIf(block -> protectedOriginal(block) || failClosed(block));
    }
    @EventHandler public void onBlockExplosion(BlockExplodeEvent event) {
        event.blockList().removeIf(block -> protectedOriginal(block) || failClosed(block));
    }
}
