package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
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
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;

/** Four guarded, one-time vanilla buildings with seven profession-matched life guild hosts. */
final class LifeGuildBuildings implements Listener {
    private static final int HALF = 4;
    private record Host(String contract, String name, Villager.Profession profession) { }
    private record Hall(String id, String name, Material floor, Material wall, Material roof,
                        Host left, Host right) { }
    private record Plot(int x, int y, int z) { }
    private record Survey(int y, int logs, String issue) {
        boolean valid() { return issue == null; }
    }
    private record Box(int minX, int maxX, int minZ, int maxZ) {
        boolean near(int x, int z) {
            return x >= minX - 2 && x <= maxX + 2 && z >= minZ - 2 && z <= maxZ + 2;
        }
    }
    private static final List<Hall> HALLS = List.of(
            new Hall("harvest", "丰穗食堂", Material.OAK_PLANKS, Material.STRIPPED_OAK_WOOD,
                    Material.OAK_STAIRS,
                    new Host("farmer_harvest", "田园导师·春芽", Villager.Profession.FARMER),
                    new Host("gourmet_bread", "美食家·阿圆", Villager.Profession.BUTCHER)),
            new Hall("harbor", "溪畔商栈", Material.SPRUCE_PLANKS, Material.DARK_OAK_PLANKS,
                    Material.SPRUCE_STAIRS,
                    new Host("angler_catch", "钓客·海贝", Villager.Profession.FISHERMAN),
                    new Host("trader_supply", "商旅掌柜·阿栈", Villager.Profession.CARTOGRAPHER)),
            new Hall("workshop", "石铜工坊", Material.STONE_BRICKS, Material.DEEPSLATE_BRICKS,
                    Material.CUT_COPPER_STAIRS,
                    new Host("builder_home", "建筑家·石叔", Villager.Profession.MASON),
                    new Host("tinkerer_light", "机关师·小铜", Villager.Profession.TOOLSMITH)),
            new Hall("library", "灯语书屋", Material.CHERRY_PLANKS, Material.BIRCH_PLANKS,
                    Material.CHERRY_STAIRS,
                    new Host("author_story", "故事家·星语", Villager.Profession.LIBRARIAN), null));

    private final AgentFriendPlugin plugin;
    private final LifeGuildManager lifeGuild;
    private final World world;
    private final NamespacedKey hostKey;
    private final Map<String, Plot> plots = new HashMap<>();
    private final Map<String, Material> fabric = new HashMap<>();
    private final Map<Inventory, String> menus = new HashMap<>();
    private final List<Box> houses = new ArrayList<>();
    private boolean ready;

    LifeGuildBuildings(AgentFriendPlugin plugin, LifeGuildManager lifeGuild) {
        this.plugin = plugin;
        this.lifeGuild = lifeGuild;
        world = Bukkit.getWorld("world");
        hostKey = new NamespacedKey(plugin, "life_guild_npc");
        if (world != null) try {
            readHouseBounds();
            for (Hall hall : HALLS) if (built(hall)) {
                String base = path(hall);
                plots.put(hall.id(), new Plot(plugin.getConfig().getInt(base + ".x"),
                        plugin.getConfig().getInt(base + ".y"), plugin.getConfig().getInt(base + ".z")));
            }
            for (Hall hall : HALLS) if (built(hall)) readMask(hall);
            ready = true;
        } catch (Exception error) {
            plugin.getLogger().severe("Life guild building mask unavailable; edits fail closed: " + error);
        }
        for (Hall hall : HALLS) if (plugin.getConfig().getBoolean(path(hall) + ".building")) {
            plots.putIfAbsent(hall.id(), new Plot(plugin.getConfig().getInt(path(hall) + ".x"),
                    plugin.getConfig().getInt(path(hall) + ".y"),
                    plugin.getConfig().getInt(path(hall) + ".z")));
            ready = false;
            plugin.getLogger().severe("Interrupted life guild construction " + hall.id()
                    + "; edits fail closed until the world backup is inspected or restored.");
        }
        Bukkit.getPluginManager().registerEvents(this, plugin);
        if (ready) Bukkit.getScheduler().runTaskTimer(plugin, this::ensureHosts, 40L, 2400L);
    }

    private static String path(Hall hall) { return "life-buildings." + hall.id(); }
    private boolean built(Hall hall) { return plugin.getConfig().getBoolean(path(hall) + ".built"); }
    private static Hall hall(String id) {
        for (Hall hall : HALLS) if (hall.id().equalsIgnoreCase(id)) return hall;
        return null;
    }
    private static String key(int x, int y, int z) { return x + "," + y + "," + z; }
    private static String key(Block block) { return key(block.getX(), block.getY(), block.getZ()); }
    private Path maskPath(Hall hall) {
        return plugin.getDataFolder().toPath().resolve("life-building-" + hall.id() + "-mask.tsv");
    }

    private void readHouseBounds() throws IOException {
        Path file = world.getWorldFolder().toPath().getParent()
                .resolve("plugins/WorldGuard/worlds/world/regions.yml");
        if (!Files.isRegularFile(file)) throw new IOException("WorldGuard village regions missing");
        ConfigurationSection regions = YamlConfiguration.loadConfiguration(file.toFile())
                .getConfigurationSection("regions");
        if (regions == null) throw new IOException("WorldGuard regions missing");
        for (String id : regions.getKeys(false)) {
            if (!id.matches("afu_house_\\d{2}")) continue;
            ConfigurationSection region = regions.getConfigurationSection(id);
            ConfigurationSection min = region == null ? null : region.getConfigurationSection("min");
            ConfigurationSection max = region == null ? null : region.getConfigurationSection("max");
            if (min == null || max == null) throw new IOException("Invalid house bounds " + id);
            houses.add(new Box(min.getInt("x"), max.getInt("x"), min.getInt("z"), max.getInt("z")));
        }
        if (houses.size() != 23) throw new IOException("Expected 23 original houses, found " + houses.size());
    }

    private void readMask(Hall hall) throws IOException {
        List<String> lines = Files.readAllLines(maskPath(hall), StandardCharsets.UTF_8);
        if (lines.size() < 80 || !lines.get(0).equals("world=" + world.getUID()))
            throw new IOException("Mask missing, too small, or wrong world for " + hall.id());
        for (int i = 1; i < lines.size(); i++) {
            String[] row = lines.get(i).split("\\t", 2);
            Material material = row.length == 2 ? Material.matchMaterial(row[1]) : null;
            if (material == null) throw new IOException("Invalid mask row " + hall.id() + ":" + i);
            fabric.put(row[0], material);
        }
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
    private static boolean tree(Material m) {
        return m.name().endsWith("_LOG") || m.name().endsWith("_LEAVES");
    }
    private static boolean naturalGround(Material m) {
        return m == Material.GRASS_BLOCK || m == Material.DIRT || m == Material.COARSE_DIRT
                || m == Material.PODZOL || m == Material.STONE || m == Material.TUFF
                || m == Material.ANDESITE || m == Material.GRAVEL || m == Material.MOSS_BLOCK;
    }

    private Survey inspect(int cx, int cz, boolean entities) {
        if (!ready || world == null) return new Survey(0, 0, "保护快照未就绪");
        if (cx - 7 < -630 || cx + 7 > -470 || cz - 7 < -530 || cz + 7 > -380)
            return new Survey(0, 0, "候选地须完整位于村庄安全区内");
        if (Math.abs(cx + 543) <= 14 && Math.abs(cz + 439) <= 14)
            return new Survey(0, 0, "距离出生点过近");
        int low = Integer.MAX_VALUE, high = Integer.MIN_VALUE, logs = 0;
        for (int x = cx - 6; x <= cx + 6; x++) for (int z = cz - 6; z <= cz + 6; z++) {
            for (Box house : houses) if (house.near(x, z))
                return new Survey(0, logs, "距现有村屋不足 2 格：" + x + "," + z);
            boolean core = Math.abs(x - cx) <= HALF && Math.abs(z - cz) <= HALF;
            boolean overhang = Math.abs(x - cx) <= HALF + 1 && Math.abs(z - cz) <= HALF + 1;
            if (!overhang) continue;
            Block top = world.getBlockAt(x, world.getHighestBlockYAt(x, z, HeightMap.WORLD_SURFACE), z);
            while (top.getY() > 50 && (clearable(top.getType()) || tree(top.getType())))
                top = top.getRelative(0, -1, 0);
            if ((!naturalGround(top.getType()) && top.getType() != Material.DIRT_PATH)
                    || top.getState() instanceof TileState)
                return new Survey(0, logs, "地表不是自然地形：" + key(top) + "=" + top.getType());
            if (core) {
                low = Math.min(low, top.getY());
                high = Math.max(high, top.getY());
            }
            for (int y = top.getY() + 1; y <= top.getY() + 9; y++) {
                Block block = world.getBlockAt(x, y, z);
                if (block.getState() instanceof TileState || !(clearable(block.getType()) || tree(block.getType())))
                    return new Survey(0, logs, "上方有建筑或容器：" + key(block) + "=" + block.getType());
                if (block.getType().name().endsWith("_LOG")) logs++;
            }
            for (int y = top.getY() - 2; y <= top.getY() + 9; y++) {
                Block block = world.getBlockAt(x, y, z);
                if (plugin.villageProtection().deniesEdit(block) || plugin.guildHall().deniesEdit(block)
                        || plugin.trialRoad().deniesBreak(block) || deniesEdit(block))
                    return new Survey(0, logs, "会覆盖受保护建筑：" + key(block));
            }
        }
        if (high - low > 2) return new Survey(0, logs, "地形高差 " + (high - low) + " > 2");
        if (logs > 24) return new Survey(0, logs, "需清理的树干过多：" + logs);
        if (entities) {
            Location center = new Location(world, cx + .5, high + 3, cz + .5);
            for (Entity entity : world.getNearbyEntities(center, 6, 5, 6))
                if (entity instanceof LivingEntity)
                    return new Survey(0, logs, "施工区内有生物：" + entity.getType());
        }
        return new Survey(high + 1, logs, null);
    }

    void scanRow(CommandSender sender, int z) {
        if (z < -523 || z > -387) { sender.sendMessage("z 须在 -523..-387"); return; }
        List<String> places = new ArrayList<>();
        for (int x = -623; x <= -477; x += 3) {
            Survey site = inspect(x, z, false);
            if (site.valid()) places.add(x + ":" + site.y() + ":" + site.logs());
        }
        sender.sendMessage("MC_LIFE_SITE_SCAN z=" + z + " valid=" + places.size()
                + " x:y:logs=" + String.join(",", places));
    }

    void survey(CommandSender sender, String id, int x, int z) {
        Hall hall = hall(id);
        if (hall == null) { sender.sendMessage("建筑 ID：harvest|harbor|workshop|library"); return; }
        Survey site = inspect(x, z, false);
        sender.sendMessage(site.valid() ? "生活公会候选地可建：" + hall.id() + " x=" + x + " z=" + z
                + " floorY=" + site.y() + " logs=" + site.logs()
                : "生活公会候选地不可建：" + hall.id() + " x=" + x + " z=" + z + "；" + site.issue());
    }

    void build(CommandSender sender, String id, int x, int z) {
        Hall hall = hall(id);
        if (hall == null) { sender.sendMessage("建筑 ID：harvest|harbor|workshop|library"); return; }
        if (built(hall) || plugin.getConfig().getBoolean(path(hall) + ".building")
                || Files.exists(maskPath(hall))) {
            sender.sendMessage("此生活公会已建、施工曾中断或保护快照已存在；拒绝覆盖。"); return;
        }
        Survey site = inspect(x, z, true);
        if (!site.valid()) { sender.sendMessage("未施工：" + site.issue()); return; }
        Plot plot = new Plot(x, site.y(), z);
        String base = path(hall);
        plugin.getConfig().set(base + ".building", true);
        plugin.getConfig().set(base + ".x", x);
        plugin.getConfig().set(base + ".y", plot.y());
        plugin.getConfig().set(base + ".z", z);
        plugin.saveConfig();
        try {
            construct(hall, plot);
            writeMask(hall);
            plots.put(hall.id(), plot);
            plugin.getConfig().set(base + ".built", true);
            plugin.getConfig().set(base + ".building", false);
            plugin.saveConfig();
            ensureHosts();
            sender.sendMessage("生活公会建成：" + hall.name() + " @ " + x + " " + plot.y() + " " + z
                    + "；专属 NPC " + hall.left().name()
                    + (hall.right() == null ? "" : "、" + hall.right().name()));
        } catch (Exception error) {
            plugin.getLogger().severe("Life guild build interrupted " + hall.id()
                    + "; restore world backup before retrying: " + error);
            sender.sendMessage("施工中断；不得重试，先核对或恢复世界备份：" + error.getMessage());
        }
    }

    private void writeMask(Hall hall) throws IOException {
        Path path = maskPath(hall);
        Files.createDirectories(path.getParent());
        List<String> lines = new ArrayList<>();
        lines.add("world=" + world.getUID());
        Plot plot = plots.get(hall.id());
        if (plot == null) {
            plot = new Plot(plugin.getConfig().getInt(path(hall) + ".x"),
                    plugin.getConfig().getInt(path(hall) + ".y"), plugin.getConfig().getInt(path(hall) + ".z"));
        }
        for (Map.Entry<String, Material> entry : fabric.entrySet()) {
            String[] xyz = entry.getKey().split(",");
            int bx = Integer.parseInt(xyz[0]), bz = Integer.parseInt(xyz[2]);
            if (Math.abs(bx - plot.x()) <= 6 && Math.abs(bz - plot.z()) <= 6)
                lines.add(entry.getKey() + "\t" + entry.getValue().name());
        }
        lines.subList(1, lines.size()).sort(String::compareTo);
        Path pending = path.resolveSibling(path.getFileName() + ".pending");
        Files.write(pending, lines, StandardCharsets.UTF_8);
        try { Files.move(pending, path, StandardCopyOption.ATOMIC_MOVE); }
        catch (IOException unavailable) { Files.move(pending, path, StandardCopyOption.REPLACE_EXISTING); }
    }

    private void put(Plot plot, int dx, int dy, int dz, Material material) {
        Block block = world.getBlockAt(plot.x() + dx, plot.y() + dy, plot.z() + dz);
        block.setType(material, false);
        if (!material.isAir()) fabric.put(key(block), material);
    }
    private void stair(Plot plot, int dx, int dy, int dz, Material material, org.bukkit.block.BlockFace face) {
        Block block = world.getBlockAt(plot.x() + dx, plot.y() + dy, plot.z() + dz);
        Stairs data = (Stairs) Bukkit.createBlockData(material);
        data.setFacing(face);
        block.setBlockData(data, false);
        fabric.put(key(block), material);
    }
    private void sign(Plot plot, Hall hall) {
        Block block = world.getBlockAt(plot.x(), plot.y() + 2, plot.z() + 5);
        Rotatable data = (Rotatable) Bukkit.createBlockData(Material.OAK_SIGN);
        data.setRotation(org.bukkit.block.BlockFace.SOUTH);
        block.setBlockData(data, false);
        if (block.getState() instanceof Sign state) {
            state.setLine(0, "§6千灯纪生活公会");
            state.setLine(1, "§e" + hall.name());
            state.setLine(2, "§a找馆内导师接单");
            state.setLine(3, "§b交易 · 交付");
            state.update(true, false);
        }
        fabric.put(key(block), Material.OAK_SIGN);
    }
    private void construct(Hall hall, Plot plot) {
        for (int dx = -5; dx <= 5; dx++) for (int dz = -5; dz <= 5; dz++)
            for (int dy = 1; dy <= 8; dy++) {
                Block block = world.getBlockAt(plot.x() + dx, plot.y() + dy, plot.z() + dz);
                if (clearable(block.getType()) || tree(block.getType())) block.setType(Material.AIR, false);
            }
        for (int dx = -HALF; dx <= HALF; dx++) for (int dz = -HALF; dz <= HALF; dz++) {
            for (int by = plot.y() - 2; by < plot.y(); by++) {
                Block below = world.getBlockAt(plot.x() + dx, by, plot.z() + dz);
                if (below.getType().isAir()) put(plot, dx, by - plot.y(), dz, Material.COBBLESTONE);
            }
            put(plot, dx, 0, dz, Math.abs(dx) == HALF || Math.abs(dz) == HALF
                    ? Material.STONE_BRICKS : hall.floor());
            for (int dy = 1; dy <= 3; dy++) {
                boolean wall = Math.abs(dx) == HALF || Math.abs(dz) == HALF;
                boolean entrance = dz == HALF && dx == 0 && dy <= 2;
                if (!wall || entrance) continue;
                boolean pillar = Math.abs(dx) == HALF && Math.abs(dz) == HALF;
                boolean window = dy == 2 && !pillar && (Math.abs(dx) == HALF && Math.abs(dz) <= 2
                        || Math.abs(dz) == HALF && Math.abs(dx) <= 2);
                put(plot, dx, dy, dz, pillar ? Material.STRIPPED_SPRUCE_LOG
                        : window ? Material.GLASS_PANE : hall.wall());
            }
        }
        for (int dz = -5; dz <= 5; dz++) for (int dx = -5; dx <= 5; dx++) {
            int rise = (5 - Math.abs(dx)) / 2;
            if (Math.abs(dx) <= 1) put(plot, dx, 6, dz, hall.floor());
            else stair(plot, dx, 4 + rise, dz, hall.roof(),
                    dx < 0 ? org.bukkit.block.BlockFace.EAST : org.bukkit.block.BlockFace.WEST);
        }
        for (int dz : new int[]{-4, 4}) for (int dx = -3; dx <= 3; dx++)
            for (int dy = 4; dy <= 5; dy++) put(plot, dx, dy, dz, hall.wall());
        put(plot, 0, 4, 0, Material.SEA_LANTERN);
        put(plot, 0, 1, 5, Material.SPRUCE_FENCE);
        sign(plot, hall);
        switch (hall.id()) {
            case "harvest" -> {
                put(plot, -3, 1, -2, Material.COMPOSTER);
                put(plot, -3, 1, -1, Material.HAY_BLOCK);
                put(plot, 3, 1, -2, Material.SMOKER);
                put(plot, 3, 1, -1, Material.CAKE);
                put(plot, 0, 1, -3, Material.BARREL);
            }
            case "harbor" -> {
                put(plot, -3, 1, -2, Material.BARREL);
                put(plot, -3, 1, -1, Material.BLUE_WOOL);
                put(plot, 3, 1, -2, Material.CARTOGRAPHY_TABLE);
                put(plot, 3, 1, -1, Material.CHEST);
                put(plot, 0, 1, -3, Material.LOOM);
            }
            case "workshop" -> {
                put(plot, -3, 1, -2, Material.STONECUTTER);
                put(plot, -3, 1, -1, Material.CRAFTING_TABLE);
                put(plot, 3, 1, -2, Material.SMITHING_TABLE);
                put(plot, 3, 1, -1, Material.REDSTONE_LAMP);
                put(plot, 0, 1, -3, Material.ANVIL);
            }
            case "library" -> {
                for (int dx = -3; dx <= 3; dx++) put(plot, dx, 1, -3, Material.BOOKSHELF);
                put(plot, 0, 1, -2, Material.LECTERN);
                put(plot, -2, 1, -1, Material.CHERRY_SLAB);
                put(plot, 2, 1, -1, Material.CHERRY_SLAB);
            }
            default -> throw new IllegalStateException("Unknown hall " + hall.id());
        }
    }

    private Location hostLocation(Hall hall, Plot plot, Host host) {
        int dx = hall.right() == null ? 0 : host == hall.left() ? -2 : 2;
        return new Location(world, plot.x() + dx + .5, plot.y() + 1, plot.z() + .5, 180, 0);
    }
    private void ensureHosts() {
        if (!ready || world == null) return;
        for (Hall hall : HALLS) {
            Plot plot = plots.get(hall.id());
            if (plot == null || !built(hall)) continue;
            ensureHost(hall, plot, hall.left());
            if (hall.right() != null) ensureHost(hall, plot, hall.right());
        }
    }
    private Villager ensureHost(Hall hall, Plot plot, Host host) {
        Location at = hostLocation(hall, plot, host);
        world.getChunkAt(at);
        Villager found = null;
        for (Villager villager : world.getEntitiesByClass(Villager.class)) {
            if (!villager.isValid()
                    || !host.contract().equals(villager.getPersistentDataContainer()
                            .get(hostKey, PersistentDataType.STRING))) continue;
            if (found == null) found = villager;
            else villager.remove();
        }
        if (found == null) {
            found = world.spawn(at, Villager.class);
            found.getPersistentDataContainer().set(hostKey, PersistentDataType.STRING, host.contract());
        } else if (found.getLocation().distanceSquared(at) > 1) found.teleport(at);
        if (found.getProfession() != host.profession()) found.setProfession(host.profession());
        if (found.getVillagerLevel() < 2) found.setVillagerLevel(2);
        found.setCustomName("§6" + host.name());
        found.setCustomNameVisible(true);
        found.setAI(false);
        found.setInvulnerable(true);
        found.setRemoveWhenFarAway(false);
        if (found.getRecipes().isEmpty()) found.addTrades(2);
        return found;
    }
    private Villager findHost(String contract) {
        for (Hall hall : HALLS) {
            Plot plot = plots.get(hall.id());
            if (plot == null || !built(hall)) continue;
            for (Host host : new Host[]{hall.left(), hall.right()}) {
                if (host == null || !host.contract().equals(contract)) continue;
                return ensureHost(hall, plot, host);
            }
        }
        return null;
    }

    void locations(Player player) {
        JsonObject data = new JsonObject();
        data.addProperty("schemaVersion", 1);
        data.addProperty("kind", "locations");
        data.addProperty("dimension", "minecraft:overworld");
        JsonArray list = new JsonArray();
        for (Hall hall : HALLS) {
            Plot plot = plots.get(hall.id());
            if (plot == null || !built(hall)) continue;
            player.sendMessage(ChatColor.GOLD + hall.name() + ChatColor.WHITE + " @ "
                    + plot.x() + " " + plot.y() + " " + (plot.z() + 6));
            for (Host host : new Host[]{hall.left(), hall.right()}) {
                if (host == null) continue;
                Location at = hostLocation(hall, plot, host);
                JsonObject item = new JsonObject();
                item.addProperty("buildingId", hall.id());
                item.addProperty("building", hall.name());
                item.addProperty("contractId", host.contract());
                item.addProperty("npc", host.name());
                item.addProperty("profession", host.profession().name().toLowerCase(java.util.Locale.ROOT));
                item.addProperty("x", at.getBlockX());
                item.addProperty("y", at.getBlockY());
                item.addProperty("z", at.getBlockZ());
                item.addProperty("entranceX", plot.x());
                item.addProperty("entranceY", plot.y() + 1);
                item.addProperty("entranceZ", plot.z() + 6);
                list.add(item);
            }
        }
        if (list.isEmpty()) player.sendMessage(ChatColor.YELLOW + "生活公会专属建筑尚未开放，任务可继续从罗盘接取。");
        data.add("npcs", list);
        lifeGuild.send(player, data);
    }

    void fillMap(Inventory inventory) {
        Material[] icons = {Material.HAY_BLOCK, Material.BARREL, Material.SMITHING_TABLE, Material.BOOKSHELF};
        int[] slots = {10, 12, 14, 16};
        for (int index = 0; index < HALLS.size(); index++) {
            Hall hall = HALLS.get(index);
            Plot plot = plots.get(hall.id());
            inventory.setItem(slots[index], plot == null || !built(hall)
                    ? icon(Material.BARRIER, "§7" + hall.name(), "§7尚未开放")
                    : icon(icons[index], "§e" + hall.name(), "§7入口 " + plot.x() + " "
                            + (plot.y() + 1) + " " + (plot.z() + 6) + "；点击前往"));
        }
        inventory.setItem(22, icon(Material.ARROW, "§7返回生活公会", "§7也可以步行拜访导师"));
        inventory.setItem(24, icon(Material.MAP, "§b导师与职业坐标", "§7列出七位导师的精确位置"));
    }
    void visitSlot(Player player, int slot) {
        int index = switch (slot) { case 10 -> 0; case 12 -> 1; case 14 -> 2; case 16 -> 3; default -> -1; };
        if (index >= 0) visit(player, HALLS.get(index).id());
    }
    void visit(Player player, String id) {
        Hall hall = hall(id);
        Plot plot = hall == null ? null : plots.get(hall.id());
        if (plot == null || !built(hall) || !ready) {
            player.sendMessage(ChatColor.YELLOW + "这座生活公会还未开放；/mycli life locations 查现有地点。");
            return;
        }
        Location landing = new Location(world, plot.x() + .5, plot.y() + 1,
                plot.z() + 6.5, 180, 0);
        if (!landing.getBlock().getType().isAir()
                || !landing.clone().add(0, 1, 0).getBlock().getType().isAir()) {
            player.sendMessage(ChatColor.RED + "公会入口受阻，传送取消。"); return;
        }
        if (player.teleport(landing)) {
            player.sendMessage(ChatColor.GOLD + "已到" + hall.name() + "；也可以从村庄步行拜访。");
            player.sendMessage("MC_DESTINATION id=life:" + hall.id() + " " + LocationOutput.fields(landing));
        }
        else player.sendMessage(ChatColor.RED + "传送被保护规则取消。");
    }

    private static ItemStack icon(Material type, String name, String detail) {
        ItemStack item = new ItemStack(type);
        ItemMeta meta = item.getItemMeta();
        meta.setDisplayName(name);
        meta.setLore(List.of(detail));
        item.setItemMeta(meta);
        return item;
    }
    private void openHostMenu(Player player, String contract) {
        Hall hall = null;
        Host host = null;
        for (Hall candidate : HALLS) for (Host match : new Host[]{candidate.left(), candidate.right()})
            if (match != null && match.contract().equals(contract)) { hall = candidate; host = match; }
        if (hall == null || host == null || !built(hall)) return;
        Inventory menu = Bukkit.createInventory(null, 9, host.name() + " · " + hall.name());
        menu.setItem(1, icon(Material.BOOK, "§e看看委托", "§7查看任务说明与本人进度"));
        menu.setItem(3, icon(Material.WRITABLE_BOOK, "§a接取委托", "§7" + contract));
        menu.setItem(5, icon(Material.EMERALD, "§b交付当前委托", "§7进度达成后领取本人奖励"));
        menu.setItem(7, icon(Material.EMERALD_BLOCK, "§6与导师交易", "§7打开原版村民交易界面"));
        menus.put(menu, contract);
        player.openInventory(menu);
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onHostInteract(PlayerInteractEntityEvent event) {
        if (event.getHand() != EquipmentSlot.HAND) return;
        String contract = event.getRightClicked().getPersistentDataContainer()
                .get(hostKey, PersistentDataType.STRING);
        if (contract == null) return;
        event.setCancelled(true);
        openHostMenu(event.getPlayer(), contract);
    }
    @EventHandler public void onHostClick(InventoryClickEvent event) {
        String contract = menus.get(event.getView().getTopInventory());
        if (contract == null) return;
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player)) return;
        int slot = event.getRawSlot();
        if (slot < 0 || slot >= 9) return;
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (!player.isOnline()) return;
            player.closeInventory();
            switch (slot) {
                case 1 -> lifeGuild.command(player, new String[]{"life", "board"});
                case 3 -> lifeGuild.command(player, new String[]{"life", "accept", contract});
                case 5 -> lifeGuild.command(player, new String[]{"life", "claim"});
                case 7 -> {
                    Villager host = findHost(contract);
                    if (host != null && host.getLocation().distanceSquared(player.getLocation()) <= 64)
                        player.openMerchant(host, true);
                    else player.sendMessage("§e请站在导师身边打开交易菜单。");
                }
                default -> { }
            }
        });
    }
    @EventHandler public void onHostDrag(InventoryDragEvent event) {
        if (menus.containsKey(event.getView().getTopInventory())) event.setCancelled(true);
    }
    @EventHandler public void onHostClose(InventoryCloseEvent event) {
        menus.remove(event.getInventory());
    }

    private boolean inBuiltPlot(Block b) {
        if (b.getWorld() != world) return false;
        for (Plot plot : plots.values())
            if (Math.abs(b.getX() - plot.x()) <= 6 && Math.abs(b.getZ() - plot.z()) <= 6
                    && b.getY() >= plot.y() - 2 && b.getY() <= plot.y() + 8) return true;
        return false;
    }
    boolean deniesEdit(Block block) {
        return inBuiltPlot(block) && (!ready || fabric.get(key(block)) == block.getType());
    }
    private boolean deniesEdit(org.bukkit.block.BlockState state) {
        return inBuiltPlot(state.getBlock()) && (!ready
                || fabric.get(key(state.getX(), state.getY(), state.getZ())) == state.getType());
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onBreak(BlockBreakEvent event) {
        if (deniesEdit(event.getBlock())) {
            event.setCancelled(true);
            event.getPlayer().sendMessage("§e这是生活公会的建筑，周围草木可正常整理。");
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onPlace(BlockPlaceEvent event) {
        if (deniesEdit(event.getBlockReplacedState())) event.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onMultiPlace(BlockMultiPlaceEvent event) {
        if (event.getReplacedBlockStates().stream().anyMatch(this::deniesEdit)) event.setCancelled(true);
    }
    @EventHandler public void onBurn(BlockBurnEvent event) {
        if (deniesEdit(event.getBlock())) event.setCancelled(true);
    }
    @EventHandler public void onFlow(BlockFromToEvent event) {
        if (deniesEdit(event.getToBlock())) event.setCancelled(true);
    }
    @EventHandler public void onChange(EntityChangeBlockEvent event) {
        if (deniesEdit(event.getBlock())) event.setCancelled(true);
    }
    @EventHandler public void onExtend(BlockPistonExtendEvent event) {
        if (event.getBlocks().stream().anyMatch(this::deniesEdit)) event.setCancelled(true);
    }
    @EventHandler public void onRetract(BlockPistonRetractEvent event) {
        if (event.getBlocks().stream().anyMatch(this::deniesEdit)) event.setCancelled(true);
    }
    @EventHandler public void onExplosion(EntityExplodeEvent event) {
        event.blockList().removeIf(this::deniesEdit);
    }
    @EventHandler public void onBlockExplosion(BlockExplodeEvent event) {
        event.blockList().removeIf(this::deniesEdit);
    }
}
