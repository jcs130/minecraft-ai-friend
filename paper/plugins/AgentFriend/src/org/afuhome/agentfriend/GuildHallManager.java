package org.afuhome.agentfriend;

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
import org.bukkit.ChatColor;
import org.bukkit.HeightMap;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.TileState;
import org.bukkit.block.data.Rotatable;
import org.bukkit.block.data.type.Stairs;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
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
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;

/** A one-time, guarded vanilla guild hall and physical quest board. */
final class GuildHallManager implements Listener {
    private static final int HALF_X = 8, HALF_Z = 6;
    private record Box(int minX, int maxX, int minZ, int maxZ) {
        boolean near(int x, int z) {
            return x >= minX - 2 && x <= maxX + 2 && z >= minZ - 2 && z <= maxZ + 2;
        }
    }
    private record Site(int y, int logs, int leaves, String error) {
        boolean valid() { return error == null; }
    }

    private final AgentFriendPlugin plugin;
    private final World world;
    private final Map<String, Material> fabric = new HashMap<>();
    private final List<Box> houses = new ArrayList<>();
    private boolean ready;
    private boolean built;
    private int x, y, z;

    GuildHallManager(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        world = Bukkit.getWorld("world");
        built = plugin.getConfig().getBoolean("guild-hall.built", false);
        x = plugin.getConfig().getInt("guild-hall.x");
        y = plugin.getConfig().getInt("guild-hall.y");
        z = plugin.getConfig().getInt("guild-hall.z");
        if (world != null) {
            try {
                readHouseBounds();
                if (built) readMask();
                ready = true;
            } catch (Exception error) {
                plugin.getLogger().severe("Guild hall protection unavailable; hall edits fail closed: " + error);
            }
        }
        if (plugin.getConfig().getBoolean("guild-hall.building", false))
            plugin.getLogger().severe("Interrupted guild hall construction: inspect or restore backup before retrying.");
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }

    boolean isBuilt() { return built; }
    int protectedCount() { return fabric.size(); }
    private static String key(int x, int y, int z) { return x + "," + y + "," + z; }
    private static String key(Block b) { return key(b.getX(), b.getY(), b.getZ()); }
    private Path maskPath() { return plugin.getDataFolder().toPath().resolve("guild-hall-mask.tsv"); }

    private void readHouseBounds() throws IOException {
        Path path = world.getWorldFolder().toPath().getParent().resolve("plugins/WorldGuard/worlds/world/regions.yml");
        if (!Files.isRegularFile(path)) throw new IOException("WorldGuard regions missing");
        ConfigurationSection regions = YamlConfiguration.loadConfiguration(path.toFile()).getConfigurationSection("regions");
        if (regions == null) throw new IOException("WorldGuard regions missing");
        for (String id : regions.getKeys(false)) {
            if (!id.matches("afu_house_\\d{2}")) continue;
            ConfigurationSection region = regions.getConfigurationSection(id);
            if (region == null) throw new IOException("invalid house region " + id);
            ConfigurationSection min = region.getConfigurationSection("min"), max = region.getConfigurationSection("max");
            if (min == null || max == null) throw new IOException("house bounds missing: " + id);
            houses.add(new Box(min.getInt("x"), max.getInt("x"), min.getInt("z"), max.getInt("z")));
        }
        if (houses.size() != 23) throw new IOException("expected 23 original village houses, found " + houses.size());
    }

    private void readMask() throws IOException {
        List<String> lines = Files.readAllLines(maskPath(), StandardCharsets.UTF_8);
        if (lines.size() < 200 || !lines.get(0).equals("world=" + world.getUID()))
            throw new IOException("guild hall mask missing, too small, or wrong world");
        for (int i = 1; i < lines.size(); i++) {
            String[] row = lines.get(i).split("\\t", 2);
            if (row.length != 2) throw new IOException("invalid guild hall mask row " + i);
            Material material = Material.matchMaterial(row[1]);
            if (material == null) throw new IOException("unknown guild hall material " + row[1]);
            fabric.put(row[0], material);
        }
    }

    private Site inspect(int cx, int cz, boolean entities) {
        if (!ready || world == null) return new Site(0, 0, 0, "保护数据未就绪");
        if (cx - HALF_X - 1 < -630 || cx + HALF_X + 1 > -470
                || cz - HALF_Z - 1 < -530 || cz + HALF_Z + 1 > -380)
            return new Site(0, 0, 0, "须在村庄安全区内部");
        for (int bx = cx - HALF_X - 2; bx <= cx + HALF_X + 2; bx++)
            for (int bz = cz - HALF_Z - 2; bz <= cz + HALF_Z + 2; bz++)
                for (Box house : houses) if (house.near(bx, bz)) return new Site(0, 0, 0, "距原房屋不足 2 格");
        if (Math.abs(cx + 543) <= 12 && Math.abs(cz + 439) <= 12)
            return new Site(0, 0, 0, "距离出生落点太近");
        int low = Integer.MAX_VALUE, high = Integer.MIN_VALUE, logs = 0, leaves = 0;
        for (int bx = cx - HALF_X - 1; bx <= cx + HALF_X + 1; bx++)
            for (int bz = cz - HALF_Z - 1; bz <= cz + HALF_Z + 1; bz++) {
                int top = world.getHighestBlockYAt(bx, bz, HeightMap.WORLD_SURFACE);
                Block ground = world.getBlockAt(bx, top, bz);
                while (ground.getY() > 50 && (clearable(ground.getType()) || naturalTree(ground.getType())))
                    ground = world.getBlockAt(bx, ground.getY() - 1, bz);
                Material type = ground.getType();
                if (type != Material.GRASS_BLOCK && type != Material.DIRT && type != Material.COARSE_DIRT
                        && type != Material.PODZOL)
                    return new Site(0, 0, 0, "地表不是自然土壤：" + bx + "," + bz + "=" + type);
                if (ground.getState() instanceof TileState) return new Site(0, 0, 0, "地面有容器或牌子");
                low = Math.min(low, ground.getY()); high = Math.max(high, ground.getY());
                for (int by = ground.getY() + 1; by <= ground.getY() + 11; by++) {
                    Block above = world.getBlockAt(bx, by, bz);
                    if (above.getState() instanceof TileState || !(clearable(above.getType()) || naturalTree(above.getType())))
                        return new Site(0, 0, 0, "上方有方块：" + bx + "," + by + "," + bz + "=" + above.getType());
                    if (above.getType().name().endsWith("_LOG")) logs++;
                    if (above.getType().name().endsWith("_LEAVES")) leaves++;
                }
            }
        if (high - low > 2) return new Site(0, logs, leaves, "地面高差 " + (high - low) + " > 2");
        if (logs > 35) return new Site(0, logs, leaves, "需清理的树干过多");
        if (entities) for (Entity entity : world.getNearbyEntities(new Location(world, cx + .5, high + 3, cz + .5),
                HALF_X + 1, 5, HALF_Z + 1))
            if (entity instanceof LivingEntity) return new Site(0, logs, leaves, "施工区内有生物：" + entity.getType());
        return new Site(high + 1, logs, leaves, null);
    }

    private static boolean naturalTree(Material m) {
        String name = m.name();
        return name.endsWith("_LOG") || name.endsWith("_LEAVES");
    }

    private static boolean clearable(Material m) {
        return m.isAir() || m == Material.SHORT_GRASS || m == Material.TALL_GRASS
                || m == Material.FERN || m == Material.LARGE_FERN || m == Material.DEAD_BUSH
                || m == Material.DANDELION || m == Material.POPPY || m == Material.CORNFLOWER
                || m == Material.OXEYE_DAISY || m == Material.AZURE_BLUET || m == Material.ALLIUM
                || m == Material.BLUE_ORCHID || m == Material.LILY_OF_THE_VALLEY
                || m == Material.SUNFLOWER || m == Material.LILAC || m == Material.ROSE_BUSH
                || m == Material.PEONY || m == Material.PINK_PETALS || m == Material.SNOW;
    }

    void survey(CommandSender sender, int cx, int cz) {
        Site site = inspect(cx, cz, false);
        sender.sendMessage(site.valid() ? "公会大厅候选地可建：x=" + cx + " z=" + cz + " floorY=" + site.y()
                        + " logs=" + site.logs() + " leaves=" + site.leaves()
                : "公会大厅候选地不可建：x=" + cx + " z=" + cz + "；" + site.error());
    }

    void build(CommandSender sender, int cx, int cz) {
        if (built || plugin.getConfig().getBoolean("guild-hall.building", false) || Files.exists(maskPath())) {
            sender.sendMessage("大厅已建、施工曾中断或保护快照已存在；拒绝覆盖。"); return;
        }
        Site site = inspect(cx, cz, true);
        if (!site.valid()) { sender.sendMessage("未施工：" + site.error()); return; }
        x = cx; y = site.y(); z = cz;
        plugin.getConfig().set("guild-hall.building", true);
        plugin.getConfig().set("guild-hall.x", x);
        plugin.getConfig().set("guild-hall.y", y);
        plugin.getConfig().set("guild-hall.z", z);
        plugin.saveConfig();
        try {
            construct();
            writeMask();
            built = true;
            plugin.getConfig().set("guild-hall.built", true);
            plugin.getConfig().set("guild-hall.building", false);
            plugin.saveConfig();
            sender.sendMessage("冒险者公会大厅建成：" + x + "," + y + "," + z
                    + "；右键任务牌，或 /mycli guild menu。保护方块 " + fabric.size());
            plugin.getLogger().info("Guild hall built at " + x + "," + y + "," + z
                    + "; protected blocks=" + fabric.size());
        } catch (Exception error) {
            plugin.getLogger().severe("Guild hall build interrupted; restore world backup before retrying: " + error);
            sender.sendMessage("施工中断；不得重试，须先核对或恢复备份。" + error.getMessage());
        }
    }

    private void put(int dx, int dy, int dz, Material type) {
        Block block = world.getBlockAt(x + dx, y + dy, z + dz);
        block.setType(type, false);
        if (!type.isAir()) fabric.put(key(block), type);
    }
    private void stairs(int dx, int dy, int dz, org.bukkit.block.BlockFace face) {
        Block block = world.getBlockAt(x + dx, y + dy, z + dz);
        Stairs data = (Stairs) Bukkit.createBlockData(Material.CHERRY_STAIRS);
        data.setFacing(face);
        block.setBlockData(data, false);
        fabric.put(key(block), Material.CHERRY_STAIRS);
    }
    private void sign(int dx, int dy, int dz, String... lines) {
        Block block = world.getBlockAt(x + dx, y + dy, z + dz);
        Rotatable data = (Rotatable) Bukkit.createBlockData(Material.OAK_SIGN);
        data.setRotation(org.bukkit.block.BlockFace.SOUTH);
        block.setBlockData(data, false);
        if (block.getState() instanceof Sign sign) {
            for (int i = 0; i < Math.min(4, lines.length); i++) sign.setLine(i, lines[i]);
            sign.update(true, false);
        }
        fabric.put(key(block), Material.OAK_SIGN);
    }
    private void wallSign(int dx, int dy, int dz, String... lines) {
        Block block = world.getBlockAt(x + dx, y + dy, z + dz);
        org.bukkit.block.data.Directional data =
                (org.bukkit.block.data.Directional) Bukkit.createBlockData(Material.OAK_WALL_SIGN);
        data.setFacing(org.bukkit.block.BlockFace.SOUTH);
        block.setBlockData(data, false);
        if (block.getState() instanceof Sign sign) {
            for (int i = 0; i < Math.min(4, lines.length); i++) sign.setLine(i, lines[i]);
            sign.update(true, false);
        }
        fabric.put(key(block), Material.OAK_WALL_SIGN);
    }

    private void construct() {
        // Clear only the vegetation and tree blocks accepted by inspect(), across the full roof overhang.
        for (int dx = -HALF_X - 1; dx <= HALF_X + 1; dx++)
            for (int dz = -HALF_Z - 1; dz <= HALF_Z + 1; dz++)
                for (int dy = 1; dy <= 11; dy++) {
                    Block block = world.getBlockAt(x + dx, y + dy, z + dz);
                    if (clearable(block.getType()) || naturalTree(block.getType())) block.setType(Material.AIR, false);
                }
        for (int dx = -HALF_X; dx <= HALF_X; dx++)
            for (int dz = -HALF_Z; dz <= HALF_Z; dz++) {
                for (int by = y - 2; by < y; by++) {
                    Block b = world.getBlockAt(x + dx, by, z + dz);
                    if (b.getType().isAir()) put(dx, by - y, dz, Material.COBBLESTONE);
                }
                put(dx, 0, dz, Math.abs(dx) == HALF_X || Math.abs(dz) == HALF_Z
                        ? Material.STONE_BRICKS : Material.SPRUCE_PLANKS);
                for (int dy = 1; dy <= 4; dy++) {
                    boolean wall = Math.abs(dx) == HALF_X || Math.abs(dz) == HALF_Z;
                    if (!wall) { put(dx, dy, dz, Material.AIR); continue; }
                    boolean entrance = dz == HALF_Z && Math.abs(dx) <= 1 && dy <= 3;
                    if (entrance) { put(dx, dy, dz, Material.AIR); continue; }
                    boolean pillar = Math.abs(dx) == HALF_X && (Math.abs(dz) == HALF_Z || dz == 0)
                            || Math.abs(dz) == HALF_Z && (Math.abs(dx) == 4 || dx == 0);
                    boolean window = dy == 2 || dy == 3;
                    if (window && !pillar && (Math.abs(dx) == HALF_X && Math.abs(dz) >= 2 && Math.abs(dz) <= 4
                            || Math.abs(dz) == HALF_Z && Math.abs(dx) >= 2 && Math.abs(dx) <= 6))
                        put(dx, dy, dz, Material.GLASS_PANE);
                    else put(dx, dy, dz, pillar ? Material.SPRUCE_LOG
                            : dy == 1 ? Material.STONE_BRICKS : Material.SPRUCE_PLANKS);
                }
            }
        // Stepped cherry roof with a spruce ridge and solid gables.
        for (int dz = -7; dz <= 7; dz++) for (int dx = -9; dx <= 9; dx++) {
            int tier = (9 - Math.abs(dx)) / 2;
            int height = 5 + tier;
            if (Math.abs(dx) <= 1) put(dx, 9, dz, Material.CHERRY_PLANKS);
            else if (dx < 0) stairs(dx, height, dz, org.bukkit.block.BlockFace.EAST);
            else stairs(dx, height, dz, org.bukkit.block.BlockFace.WEST);
        }
        for (int dz : new int[]{-6, 6}) for (int dx = -7; dx <= 7; dx++)
            for (int dy = 5; dy <= 8 - Math.abs(dx) / 2; dy++)
                put(dx, dy, dz, Material.SPRUCE_PLANKS);
        for (int dz = -6; dz <= 6; dz++) put(0, 10, dz, Material.SPRUCE_SLAB);
        // Lobby furniture and warm lighting. The board is outside the open archway.
        for (int dz = -3; dz <= -1; dz++) {
            put(-5, 1, dz, Material.BARREL);
            put(-4, 1, dz, Material.SPRUCE_SLAB);
        }
        put(-5, 1, -4, Material.BOOKSHELF);
        put(-4, 1, -4, Material.BOOKSHELF);
        put(5, 1, -4, Material.BOOKSHELF);
        put(4, 1, -4, Material.BOOKSHELF);
        put(-6, 1, 3, Material.CRAFTING_TABLE);
        put(6, 1, 3, Material.SMITHING_TABLE);
        for (int dx : new int[]{-6, 6}) for (int dz : new int[]{-4, 4})
            put(dx, 4, dz, Material.LANTERN);
        put(0, 4, 0, Material.SEA_LANTERN);
        put(3, 1, 7, Material.SPRUCE_FENCE);
        sign(3, 2, 7, "§6冒险者公会", "§e右键任务板", "§a接取 · 交付", "§b个人奖励箱");
        sign(4, 1, -2, "§6今日委托", "§e右键查看", "§a每人独立", "§b地下城试炼");
        wallSign(0, 4, 7, "§6千灯纪", "§e冒险者公会", "§a欢迎归来", "");
    }

    private void writeMask() throws IOException {
        Path target = maskPath();
        Files.createDirectories(target.getParent());
        List<String> lines = new ArrayList<>(fabric.size() + 1);
        lines.add("world=" + world.getUID());
        fabric.entrySet().stream().sorted(Map.Entry.comparingByKey())
                .forEach(entry -> lines.add(entry.getKey() + "\t" + entry.getValue().name()));
        Path pending = target.resolveSibling(target.getFileName() + ".pending");
        Files.write(pending, lines, StandardCharsets.UTF_8);
        try { Files.move(pending, target, StandardCopyOption.ATOMIC_MOVE); }
        catch (IOException unavailable) { Files.move(pending, target, StandardCopyOption.REPLACE_EXISTING); }
    }

    void teleport(Player player) {
        if (!built || !ready) { player.sendMessage(ChatColor.RED + "公会大厅尚未开放。"); return; }
        Location landing = new Location(world, x + .5, y + 1, z + 4.5, 180, 0);
        if (!landing.getBlock().getType().isAir() || !landing.clone().add(0, 1, 0).getBlock().getType().isAir()) {
            player.sendMessage(ChatColor.RED + "公会大厅入口受阻，传送取消。"); return;
        }
        if (player.teleport(landing)) player.sendMessage(ChatColor.GOLD + "已到冒险者公会；右键任务牌查看今日委托。");
    }

    boolean handleInteract(PlayerInteractEvent event) {
        if (!built || !ready || event.getHand() != EquipmentSlot.HAND
                || event.getAction() != Action.RIGHT_CLICK_BLOCK) return false;
        Block b = event.getClickedBlock();
        if (b == null || b.getWorld() != world || b.getType() != Material.OAK_SIGN) return false;
        boolean board = b.getX() == x + 3 && b.getY() == y + 2 && b.getZ() == z + 7
                || b.getX() == x + 4 && b.getY() == y + 1 && b.getZ() == z - 2;
        if (!board) return false;
        event.setCancelled(true);
        plugin.openGuildMenu(event.getPlayer());
        return true;
    }

    private boolean inHall(Block b) {
        return built && b.getWorld() == world && b.getX() >= x - 9 && b.getX() <= x + 9
                && b.getY() >= y - 2 && b.getY() <= y + 10
                && b.getZ() >= z - 7 && b.getZ() <= z + 7;
    }
    private boolean protectedFabric(Block b) {
        return inHall(b) && fabric.get(key(b)) == b.getType();
    }
    private boolean protectedFabric(org.bukkit.block.BlockState b) {
        return inHall(b.getBlock()) && fabric.get(key(b.getX(), b.getY(), b.getZ())) == b.getType();
    }
    private boolean failClosed(Block b) { return built && !ready && inHall(b); }
    boolean deniesEdit(Block block) { return protectedFabric(block) || failClosed(block); }
    @EventHandler(priority = EventPriority.HIGHEST) public void onBreak(BlockBreakEvent event) {
        if (deniesEdit(event.getBlock())) {
            event.setCancelled(true);
            event.getPlayer().sendMessage("§e这是冒险者公会的建筑。周围的草木可以正常整理。");
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onPlace(BlockPlaceEvent event) {
        if (protectedFabric(event.getBlockReplacedState()) || failClosed(event.getBlock())) event.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onMultiPlace(BlockMultiPlaceEvent event) {
        for (org.bukkit.block.BlockState state : event.getReplacedBlockStates())
            if (protectedFabric(state) || failClosed(state.getBlock())) { event.setCancelled(true); return; }
    }
    @EventHandler public void onBurn(BlockBurnEvent event) {
        if (protectedFabric(event.getBlock()) || failClosed(event.getBlock())) event.setCancelled(true);
    }
    @EventHandler public void onFlow(BlockFromToEvent event) {
        if (protectedFabric(event.getToBlock()) || failClosed(event.getToBlock())) event.setCancelled(true);
    }
    @EventHandler public void onChange(EntityChangeBlockEvent event) {
        if (protectedFabric(event.getBlock()) || failClosed(event.getBlock())) event.setCancelled(true);
    }
    @EventHandler public void onExtend(BlockPistonExtendEvent event) {
        if (event.getBlocks().stream().anyMatch(b -> protectedFabric(b) || failClosed(b))) event.setCancelled(true);
    }
    @EventHandler public void onRetract(BlockPistonRetractEvent event) {
        if (event.getBlocks().stream().anyMatch(b -> protectedFabric(b) || failClosed(b))) event.setCancelled(true);
    }
    @EventHandler public void onExplosion(EntityExplodeEvent event) {
        event.blockList().removeIf(b -> protectedFabric(b) || failClosed(b));
    }
    @EventHandler public void onBlockExplosion(BlockExplodeEvent event) {
        event.blockList().removeIf(b -> protectedFabric(b) || failClosed(b));
    }
}
