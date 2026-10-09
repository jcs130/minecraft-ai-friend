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
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.Chest;
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
import org.bukkit.entity.Villager;
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
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;

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
    private final Map<String, Material> servicesFabric = new HashMap<>();
    private final Map<Inventory, UUID> receptionMenus = new HashMap<>();
    private final List<Box> houses = new ArrayList<>();
    private final NamespacedKey receptionistKey;
    private boolean ready;
    private boolean built;
    private boolean servicesBuilt;
    private int x, y, z;

    GuildHallManager(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        receptionistKey = new NamespacedKey(plugin, "guild_receptionist");
        world = Bukkit.getWorld("world");
        built = plugin.getConfig().getBoolean("guild-hall.built", false);
        servicesBuilt = plugin.getConfig().getBoolean("guild-hall.services-built", false);
        x = plugin.getConfig().getInt("guild-hall.x");
        y = plugin.getConfig().getInt("guild-hall.y");
        z = plugin.getConfig().getInt("guild-hall.z");
        if (world != null) {
            try {
                readHouseBounds();
                if (built) readMask();
                if (servicesBuilt) readServicesMask();
                ready = true;
            } catch (Exception error) {
                plugin.getLogger().severe("Guild hall protection unavailable; hall edits fail closed: " + error);
            }
        }
        if (plugin.getConfig().getBoolean("guild-hall.building", false))
            plugin.getLogger().severe("Interrupted guild hall construction: inspect or restore backup before retrying.");
        if (plugin.getConfig().getBoolean("guild-hall.services-building", false))
            plugin.getLogger().severe("Interrupted guild services construction: inspect or restore backup before retrying.");
        Bukkit.getPluginManager().registerEvents(this, plugin);
        if (servicesBuilt && ready) Bukkit.getScheduler().runTaskLater(plugin, this::ensureReceptionist, 40L);
    }

    boolean isBuilt() { return built; }
    int protectedCount() { return fabric.size(); }
    private static String key(int x, int y, int z) { return x + "," + y + "," + z; }
    private static String key(Block b) { return key(b.getX(), b.getY(), b.getZ()); }
    private Path maskPath() { return plugin.getDataFolder().toPath().resolve("guild-hall-mask.tsv"); }
    private Path servicesMaskPath() { return plugin.getDataFolder().toPath().resolve("guild-services-mask.tsv"); }

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
        readMask(maskPath(), fabric, 200);
    }
    private void readServicesMask() throws IOException {
        readMask(servicesMaskPath(), servicesFabric, 30);
    }
    private void readMask(Path path, Map<String, Material> target, int minimum) throws IOException {
        List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
        if (lines.size() < minimum || !lines.get(0).equals("world=" + world.getUID()))
            throw new IOException("guild hall mask missing, too small, or wrong world");
        for (int i = 1; i < lines.size(); i++) {
            String[] row = lines.get(i).split("\\t", 2);
            if (row.length != 2) throw new IOException("invalid guild hall mask row " + i);
            Material material = Material.matchMaterial(row[1]);
            if (material == null) throw new IOException("unknown guild hall material " + row[1]);
            target.put(row[0], material);
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
                : "公会大厅候选地不可建：x=" + cx + " z=" + cz + "；" + site.error() + "；按冲突原因另选空地后重新 survey，不清除既有村屋或容器来强建。");
    }

    void build(CommandSender sender, int cx, int cz) {
        if (built || plugin.getConfig().getBoolean("guild-hall.building", false) || Files.exists(maskPath())) {
            sender.sendMessage("大厅已建、施工曾中断或保护快照已存在；拒绝覆盖。请停止重建，先核对建成/施工标记、原保护快照和世界现状；中断施工须按维护流程备份现场再恢复，不清标记绕过保护。"); return;
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
        writeMask(maskPath(), fabric);
    }
    private void writeMask(Path target, Map<String, Material> blocks) throws IOException {
        Files.createDirectories(target.getParent());
        List<String> lines = new ArrayList<>(blocks.size() + 1);
        lines.add("world=" + world.getUID());
        blocks.entrySet().stream().sorted(Map.Entry.comparingByKey())
                .forEach(entry -> lines.add(entry.getKey() + "\t" + entry.getValue().name()));
        Path pending = target.resolveSibling(target.getFileName() + ".pending");
        Files.write(pending, lines, StandardCharsets.UTF_8);
        try { Files.move(pending, target, StandardCopyOption.ATOMIC_MOVE); }
        catch (IOException unavailable) { Files.move(pending, target, StandardCopyOption.REPLACE_EXISTING); }
    }

    private static final String[] SHARED_LABELS = {"武器", "护甲", "补给", "公共杂物"};
    private boolean inServices(Block b) {
        return built && servicesBuilt && b.getWorld() == world && b.getX() >= x + 13 && b.getX() <= x + 18
                && b.getY() >= y - 1 && b.getY() <= y + 4 && b.getZ() >= z + 7 && b.getZ() <= z + 13;
    }
    private boolean servicesBlock(Block b) {
        return inServices(b) && servicesFabric.get(key(b)) == b.getType();
    }
    private boolean servicesBlock(org.bukkit.block.BlockState b) {
        return inServices(b.getBlock()) && servicesFabric.get(key(b.getX(), b.getY(), b.getZ())) == b.getType();
    }
    private boolean servicesFailClosed(Block b) { return built && servicesBuilt && !ready && inServices(b); }

    boolean isSharedChest(Block b) {
        return servicesBuilt && b.getWorld() == world && (b.getX() == x + 16 || b.getX() == x + 17)
                && b.getY() == y + 1 && b.getZ() >= z + 7 && b.getZ() <= z + 13 && (b.getZ() - z - 7) % 2 == 0;
    }

    private String inspectServices() {
        if (!built || !ready || world == null) return "公会大厅或保护数据未就绪";
        if (x != -489 || y != 66 || z != -502) return "这套共享箱地基只适用于当前村庄公会坐标";
        for (int dx = 13; dx <= 18; dx++) for (int dz = 7; dz <= 13; dz++) {
            for (Box house : houses) if (house.near(x + dx, z + dz)) return "距离原村屋过近";
            Block floor = world.getBlockAt(x + dx, y, z + dz);
            if (floor.getState() instanceof TileState || !(floor.getType().isAir()
                    || floor.getType() == Material.GRASS_BLOCK || floor.getType() == Material.DIRT
                    || floor.getType() == Material.COARSE_DIRT || clearable(floor.getType())))
                return "地基有非自然方块：" + key(floor) + "=" + floor.getType();
            for (int dy = 1; dy <= 4; dy++) {
                Block above = world.getBlockAt(x + dx, y + dy, z + dz);
                if (above.getState() instanceof TileState || !(clearable(above.getType())
                        || dy <= 2 && (above.getType() == Material.GRASS_BLOCK
                        || above.getType() == Material.DIRT)))
                    return "上方有方块：" + key(above) + "=" + above.getType();
            }
        }
        Block feet = world.getBlockAt(x - 4, y + 1, z + 5);
        Block head = feet.getRelative(0, 1, 0);
        if (!feet.getType().isAir() || !head.getType().isAir()) return "入口接待位置被占用";
        return null;
    }

    void surveyServices(CommandSender sender) {
        String issue = inspectServices();
        sender.sendMessage(issue == null ? "公会服务区可建：四组 54 格原版共享双箱，入口接待员；地基 "
                + (x + 13) + ".." + (x + 18) + "," + y + "," + (z + 7) + ".." + (z + 13)
                : "公会服务区不可建：" + issue + "；保留现有箱体与建筑，请服主核对服务区方案和地形后再 survey，不直接覆盖。");
    }

    void buildServices(CommandSender sender) {
        if (servicesBuilt || plugin.getConfig().getBoolean("guild-hall.services-building", false)
                || Files.exists(servicesMaskPath())) {
            sender.sendMessage("公会服务区已建、施工曾中断或保护快照已存在；拒绝覆盖。请停止重建，先核对建成/施工标记、原保护快照和世界现状；中断施工须按维护流程备份现场再恢复，不清标记绕过保护。"); return;
        }
        String issue = inspectServices();
        if (issue != null) { sender.sendMessage("未施工：" + issue); return; }
        plugin.getConfig().set("guild-hall.services-building", true);
        plugin.saveConfig();
        try {
            constructServices();
            writeMask(servicesMaskPath(), servicesFabric);
            servicesBuilt = true;
            plugin.getConfig().set("guild-hall.services-built", true);
            plugin.getConfig().set("guild-hall.services-building", false);
            plugin.saveConfig();
            ensureReceptionist();
            sender.sendMessage("公会接待员与四组共享双箱建成；箱内物品由所有玩家共同存取。");
            plugin.getLogger().info("Guild services built; protected blocks=" + servicesFabric.size());
        } catch (Exception error) {
            plugin.getLogger().severe("Guild services build interrupted; restore world backup before retrying: " + error);
            sender.sendMessage("施工中断；请核对或恢复世界备份：" + error.getMessage());
        }
    }

    private void putService(int dx, int dy, int dz, Material type) {
        Block b = world.getBlockAt(x + dx, y + dy, z + dz);
        b.setType(type, false);
        if (!type.isAir()) servicesFabric.put(key(b), type);
    }
    private void constructServices() {
        for (int dx = 13; dx <= 18; dx++) for (int dz = 7; dz <= 13; dz++) {
            for (int dy = 1; dy <= 4; dy++) putService(dx, dy, dz, Material.AIR);
            putService(dx, 0, dz, Material.SPRUCE_PLANKS);
            Block support = world.getBlockAt(x + dx, y - 1, z + dz);
            if (support.getType().isAir()) putService(dx, -1, dz, Material.COBBLESTONE);
        }
        for (int i = 0; i < SHARED_LABELS.length; i++) {
            int dz = 7 + i * 2;
            for (int dx = 16; dx <= 17; dx++) {
                Block b = world.getBlockAt(x + dx, y + 1, z + dz);
                org.bukkit.block.data.type.Chest data =
                        (org.bukkit.block.data.type.Chest) Bukkit.createBlockData(Material.CHEST);
                data.setFacing(org.bukkit.block.BlockFace.NORTH);
                data.setType(dx == 16 ? org.bukkit.block.data.type.Chest.Type.LEFT
                        : org.bukkit.block.data.type.Chest.Type.RIGHT);
                b.setBlockData(data, false);
                servicesFabric.put(key(b), Material.CHEST);
            }
            Block label = world.getBlockAt(x + 18, y + 1, z + dz);
            Rotatable sign = (Rotatable) Bukkit.createBlockData(Material.OAK_SIGN);
            sign.setRotation(org.bukkit.block.BlockFace.WEST);
            label.setBlockData(sign, false);
            if (label.getState() instanceof Sign state) {
                state.setLine(0, "§6公会共享箱");
                state.setLine(1, "§e" + SHARED_LABELS[i]);
                state.setLine(2, "§a可取 · 可存");
                state.setLine(3, "§7所有人共用");
                state.update(true, false);
            }
            servicesFabric.put(key(label), Material.OAK_SIGN);
        }
    }

    void storageInfo(Player player) {
        if (!servicesBuilt || !ready) { player.sendMessage("§e公会共享箱尚未开放；/mycli guild shared 查询现有箱体，持续未开放请联系服主；不要取大厅私产。"); return; }
        player.sendMessage("§c公会门内实体储物和展示物归" + plugin.guildStorage().ownerLabel() + "所有，未授权的人无权取放；需要物资装备请使用门口东南侧公共箱。");
        player.sendMessage("§6公会东南侧有四类公共双箱；上层扩容箱同样可存取。所有玩家可像普通箱子一样使用；不是个人奖励箱。");
        for (int i = 0; i < SHARED_LABELS.length; i++) {
            int dz = 7 + i * 2;
            player.sendMessage("MC_GUILD_SHARED id=" + new String[]{"weapons", "armor", "supplies", "misc"}[i]
                    + " name=" + SHARED_LABELS[i] + " dimension=minecraft:overworld x=" + (x + 16)
                    + " y=" + (y + 1) + " z=" + (z + dz) + " scope=public slots=54");
        }
        if (plugin.guildShared() != null) plugin.guildShared().storageInfo(player);
    }

    Inventory sharedInventory(int category) {
        if (category < 0 || category >= SHARED_LABELS.length || !servicesBuilt || !ready || world == null)
            return null;
        int chestZ = z + 7 + category * 2;
        Block left = world.getBlockAt(x + 16, y + 1, chestZ);
        Block right = world.getBlockAt(x + 17, y + 1, chestZ);
        if (!servicesBlock(left) || !servicesBlock(right) || !(left.getState() instanceof Chest chest))
            return null;
        Inventory inventory = chest.getInventory();
        return inventory.getSize() == 54 ? inventory : null;
    }

    void traderInfo(Player player) {
        if (!servicesBuilt || !ready) { player.sendMessage("§e公会接待员尚未到岗；可用 /mycli guild board 查看委托，交易服务请联系服主检查接待员。"); return; }
        player.sendMessage("MC_GUILD_TRADER dimension=minecraft:overworld x=" + (x - 4)
                + " y=" + (y + 1) + " z=" + (z + 5) + " scope=public");
        player.sendMessage("§e右键公会接待员查看任务、购买和回收；Agent 可用"
                + " /mycli arena shop list、/mycli arena recycle list、/mycli arena wallet。");
    }

    boolean nearTrader(Player player) {
        return servicesBuilt && ready && player.getWorld() == world
                && player.getLocation().distanceSquared(new Location(world, x - 3.5, y + 1, z + 4.5)) <= 64;
    }

    Villager receptionist() {
        if (!servicesBuilt || !ready) return null;
        return ensureReceptionist();
    }

    private Villager ensureReceptionist() {
        if (!servicesBuilt || !ready || world == null) return null;
        Location at = new Location(world, x - 3.5, y + 1, z + 4.5, 20, 0);
        world.getChunkAt(at);
        Villager found = null;
        for (Entity entity : world.getNearbyEntities(at, 2, 3, 2)) {
            if (!(entity instanceof Villager villager)
                    || !villager.getPersistentDataContainer().has(receptionistKey, PersistentDataType.BYTE)) continue;
            if (found == null) found = villager;
            else villager.remove();
        }
        if (found == null) {
            found = world.spawn(at, Villager.class);
            found.getPersistentDataContainer().set(receptionistKey, PersistentDataType.BYTE, (byte) 1);
        }
        found.setProfession(Villager.Profession.WEAPONSMITH);
        found.setVillagerLevel(5);
        found.setCustomName("§6公会接待员·阿莉娅");
        found.setCustomNameVisible(true);
        found.setAI(false);
        found.setInvulnerable(true);
        found.setRemoveWhenFarAway(false);
        found.setRecipes(plugin.dungeon().merchantRecipes());
        return found;
    }

    private static ItemStack menuItem(Material type, String title, String hint) {
        ItemStack item = new ItemStack(type);
        ItemMeta meta = item.getItemMeta();
        meta.setDisplayName(title);
        meta.setLore(List.of(hint));
        item.setItemMeta(meta);
        return item;
    }

    void openReceptionMenu(Player player) {
        if (!servicesBuilt || !ready) { player.sendMessage("§e公会接待员尚未到岗；可用 /mycli guild board 查看委托，交易服务请联系服主检查接待员。"); return; }
        Inventory menu = Bukkit.createInventory(null, 27, "冒险者公会 · 接待员阿莉娅");
        menu.setItem(10, menuItem(Material.WRITABLE_BOOK, "§e聊聊公会任务", "§7查看今日委托和冒险者等级"));
        menu.setItem(12, menuItem(Material.EMERALD, "§a购买装备与补给", "§7用个人绿宝石余额结算"));
        menu.setItem(14, menuItem(Material.HOPPER, "§6回收多余装备", "§7从背包或个人奖励箱选取并确认"));
        menu.setItem(16, menuItem(Material.CHEST, "§b公会共享箱", "§7大厅东南侧，四类箱与上层扩容，可存可取"));
        menu.setItem(22, menuItem(Material.EMERALD_BLOCK, "§a实体绿宝石交易", "§7原版村民交易界面"));
        receptionMenus.put(menu, player.getUniqueId());
        player.openInventory(menu);
    }

    @EventHandler(priority = EventPriority.HIGHEST) public void onReceptionist(PlayerInteractEntityEvent event) {
        if (event.getHand() != EquipmentSlot.HAND || !servicesBuilt || !ready) return;
        if (!event.getRightClicked().getPersistentDataContainer().has(receptionistKey, PersistentDataType.BYTE)) return;
        event.setCancelled(true);
        openReceptionMenu(event.getPlayer());
    }
    @EventHandler public void onReceptionClick(InventoryClickEvent event) {
        UUID owner = receptionMenus.get(event.getView().getTopInventory());
        if (owner == null) return;
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player) || !owner.equals(player.getUniqueId())) return;
        int slot = event.getRawSlot();
        if (slot < 0 || slot >= event.getView().getTopInventory().getSize()) return;
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (!player.isOnline()) return;
            switch (slot) {
                case 10 -> plugin.openGuildMenu(player);
                case 12 -> plugin.dungeon().openGuildShop(player);
                case 14 -> plugin.dungeon().openGuildRecycle(player);
                case 16 -> { player.closeInventory(); storageInfo(player); }
                case 22 -> plugin.dungeon().openLegacyMerchant(player);
                default -> { }
            }
        });
    }
    @EventHandler public void onReceptionDrag(InventoryDragEvent event) {
        if (receptionMenus.containsKey(event.getView().getTopInventory())) event.setCancelled(true);
    }
    @EventHandler public void onReceptionClose(InventoryCloseEvent event) {
        receptionMenus.remove(event.getInventory());
    }

    void teleport(Player player) {
        if (!built || !ready) { player.sendMessage(ChatColor.RED + "公会大厅尚未开放；可用 /mycli guild board 查询任务，或联系服主核对大厅状态。"); return; }
        Location landing = new Location(world, x + .5, y + 1, z + 4.5, 180, 0);
        if (!landing.getBlock().getType().isAir() || !landing.clone().add(0, 1, 0).getBlock().getType().isAir()) {
            player.sendMessage(ChatColor.RED + "公会大厅入口受阻，传送取消。"); return;
        }
        if (plugin.travelMagic().teleport(player, landing, "guild", "公会传送术", TravelMagic.LOCAL_MANA)) player.sendMessage(ChatColor.GOLD
                + "已到冒险者公会；右键任务牌查看今日委托。 " + LocationOutput.fields(landing));
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

    boolean containsProperty(Location at) {
        return built && at != null && at.getWorld() == world && at.getBlockX() >= x - 9 && at.getBlockX() <= x + 9
                && at.getBlockY() >= y - 2 && at.getBlockY() <= y + 10
                && at.getBlockZ() >= z - 7 && at.getBlockZ() <= z + 7;
    }
    ProtectionArea propertyArea() {
        return !built || world == null ? null : ProtectionArea.box("guild_property", "冒险者公会私产", world,
                x - 9, y - 2, z - 7, x + 9, y + 10, z + 7);
    }
    ProtectionArea protectionArea(Location at) {
        if (containsProperty(at)) return propertyArea();
        if (at == null || at.getWorld() != world || !inServices(at.getBlock())) return null;
        return new ProtectionArea("guild_services", "公会门口公共服务设施", world,
                x + 13, y - 1, z + 7, x + 18, y + 4, z + 13, "structure_mask_envelope");
    }
    private boolean inHall(Block b) { return containsProperty(b.getLocation()); }
    private boolean protectedFabric(Block b) {
        return inHall(b) && fabric.get(key(b)) == b.getType() || servicesBlock(b);
    }
    private boolean protectedFabric(org.bukkit.block.BlockState b) {
        return inHall(b.getBlock()) && fabric.get(key(b.getX(), b.getY(), b.getZ())) == b.getType()
                || servicesBlock(b);
    }
    private boolean failClosed(Block b) { return built && !ready && inHall(b) || servicesFailClosed(b); }
    boolean deniesEdit(Block block) { return protectedFabric(block) || failClosed(block); }
    boolean deniesEdit(Player player, Block block) {
        return deniesEdit(block) && !(ready && plugin.lands() != null && plugin.lands().fabricAllowed(player, block));
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onBreak(BlockBreakEvent event) {
        if (deniesEdit(event.getPlayer(), event.getBlock())) {
            event.setCancelled(true);
            plugin.protectionAdvisor().denied(event.getPlayer(), "break", event.getBlock().getLocation(), "guild_hall", protectionArea(event.getBlock().getLocation()));
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onPlace(BlockPlaceEvent event) {
        if ((protectedFabric(event.getBlockReplacedState()) || failClosed(event.getBlock()))
                && !(ready && plugin.lands() != null && plugin.lands().fabricAllowed(event.getPlayer(), event.getBlock()))) {
            event.setCancelled(true);
            plugin.protectionAdvisor().denied(event.getPlayer(), "place", event.getBlock().getLocation(), "guild_hall", protectionArea(event.getBlock().getLocation()));
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onMultiPlace(BlockMultiPlaceEvent event) {
        for (org.bukkit.block.BlockState state : event.getReplacedBlockStates())
            if ((protectedFabric(state) || failClosed(state.getBlock()))
                    && !(ready && plugin.lands() != null && plugin.lands().fabricAllowed(event.getPlayer(), state.getBlock()))) {
                event.setCancelled(true);
                plugin.protectionAdvisor().denied(event.getPlayer(), "place", state.getLocation(), "guild_hall", protectionArea(state.getLocation())); return;
            }
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
