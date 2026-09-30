package org.afuhome.agentfriend;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.bukkit.Bukkit;
import org.bukkit.HeightMap;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.TileState;
import org.bukkit.block.data.type.Stairs;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
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

/** One-time village-to-trial walking route: boardwalk, graded steps, guardrails and piers. */
final class TrialRoadManager implements Listener {
    private record Pos(int x, int z) { }
    private record Step(int x, int z, int y) { Pos pos() { return new Pos(x, z); } }
    private record Support(Pos pos, int bottom, int top, Material material) { }
    private record Box(int minX, int maxX, int minZ, int maxZ) {
        boolean near(Pos pos) {
            return pos.x >= minX - 2 && pos.x <= maxX + 2
                    && pos.z >= minZ - 2 && pos.z <= maxZ + 2;
        }
    }
    private record Plan(List<Step> steps, Map<Pos, Integer> deck, Map<Pos, Integer> rails) { }

    private final AgentFriendPlugin plugin;
    private final World world;
    private final List<Box> houses = new ArrayList<>();
    private final Map<String, Material> fabric = new HashMap<>();
    private Plan plan;
    private boolean ready;
    private boolean built;

    TrialRoadManager(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        world = Bukkit.getWorld("world");
        built = plugin.getConfig().getBoolean("trial-road.built", false);
        if (world != null) try {
            readHouses();
            plan = readPlan();
            if (built) readMask();
            ready = true;
            plugin.getLogger().info("Trial walking road ready: built=" + built
                    + ", steps=" + plan.steps().size() + ", protected=" + fabric.size());
        } catch (Exception error) {
            plugin.getLogger().severe("Trial road unavailable; route edits fail closed: " + error);
        }
        if (plugin.getConfig().getBoolean("trial-road.building", false))
            plugin.getLogger().severe("Interrupted trial road construction: inspect or restore the world before retrying.");
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }

    private void readHouses() throws IOException {
        Path path = world.getWorldFolder().toPath().getParent().resolve("plugins/WorldGuard/worlds/world/regions.yml");
        if (!Files.isRegularFile(path)) throw new IOException("WorldGuard village regions missing");
        ConfigurationSection regions = YamlConfiguration.loadConfiguration(path.toFile()).getConfigurationSection("regions");
        if (regions == null) throw new IOException("WorldGuard regions missing");
        for (String id : regions.getKeys(false)) {
            if (!id.matches("afu_house_\\d{2}")) continue;
            ConfigurationSection section = regions.getConfigurationSection(id);
            if (section == null) throw new IOException("invalid house " + id);
            ConfigurationSection min = section.getConfigurationSection("min"), max = section.getConfigurationSection("max");
            if (min == null || max == null) throw new IOException("house bounds missing " + id);
            houses.add(new Box(min.getInt("x"), max.getInt("x"), min.getInt("z"), max.getInt("z")));
        }
        if (houses.size() != 23) throw new IOException("expected 23 village houses, found " + houses.size());
    }

    private Plan readPlan() throws IOException {
        List<Step> steps = new ArrayList<>();
        try (InputStream stream = plugin.getResource("trial-road.tsv")) {
            if (stream == null) throw new IOException("trial-road.tsv missing from JAR");
            String raw = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
            for (String line : raw.split("\\R")) {
                if (line.isBlank() || line.equals("x\tz\tfloorY")) continue;
                String[] cols = line.split("\\t");
                if (cols.length != 3) throw new IOException("bad road row: " + line);
                try { steps.add(new Step(Integer.parseInt(cols[0]), Integer.parseInt(cols[1]), Integer.parseInt(cols[2]))); }
                catch (NumberFormatException error) { throw new IOException("bad road coordinate: " + line, error); }
            }
        }
        if (steps.size() != 103 || !steps.get(0).equals(new Step(-570, -411, 63))
                || !steps.get(steps.size() - 1).equals(new Step(-590, -329, 90)))
            throw new IOException("unexpected road blueprint length or endpoints");
        for (int i = 1; i < steps.size(); i++) {
            Step a = steps.get(i - 1), b = steps.get(i);
            if (Math.abs(a.x - b.x) + Math.abs(a.z - b.z) != 1 || Math.abs(a.y - b.y) > 1)
                throw new IOException("road has a gap or >1-block step at row " + i);
        }
        Map<Pos, Integer> deck = new LinkedHashMap<>();
        for (Step step : steps) for (int dx = -1; dx <= 1; dx++) for (int dz = -1; dz <= 1; dz++) {
            Pos pos = new Pos(step.x + dx, step.z + dz);
            if (pos.z >= -328) continue; // Existing arena approach starts here.
            deck.merge(pos, step.y, Math::max);
        }
        if (deck.size() != 312) throw new IOException("unexpected road deck size " + deck.size());
        Map<Pos, Integer> rails = new LinkedHashMap<>();
        for (Map.Entry<Pos, Integer> entry : deck.entrySet()) {
            Pos pos = entry.getKey(); int y = entry.getValue();
            Block ground = ground(pos);
            if (y - ground.getY() < 2 && ground.getType() != Material.WATER) continue;
            for (int[] d : new int[][]{{1,0},{-1,0},{0,1},{0,-1}}) {
                Pos side = new Pos(pos.x + d[0], pos.z + d[1]);
                if (side.z <= -412 || side.z >= -328 || deck.containsKey(side)) continue;
                if (ground(side).getY() >= y) continue;
                rails.merge(side, y, Math::max);
            }
        }
        return new Plan(List.copyOf(steps), deck, rails);
    }

    private static boolean vegetation(Material material) {
        String name = material.name();
        return material.isAir() || name.endsWith("_LEAVES") || name.endsWith("_LOG")
                || name.endsWith("_SAPLING") || name.endsWith("_FLOWER")
                || material == Material.SHORT_GRASS || material == Material.TALL_GRASS
                || material == Material.FERN || material == Material.LARGE_FERN
                || material == Material.DEAD_BUSH || material == Material.PINK_PETALS
                || material == Material.SEAGRASS || material == Material.TALL_SEAGRASS
                || material == Material.KELP || material == Material.KELP_PLANT
                || material == Material.DANDELION || material == Material.POPPY
                || material == Material.BLUE_ORCHID || material == Material.ALLIUM
                || material == Material.AZURE_BLUET || material == Material.CORNFLOWER
                || material == Material.LILY_OF_THE_VALLEY || material == Material.OXEYE_DAISY;
    }
    private static boolean natural(Material material) {
        return vegetation(material) || material == Material.GRASS_BLOCK || material == Material.DIRT
                || material == Material.DIRT_PATH || material == Material.COARSE_DIRT
                || material == Material.PODZOL || material == Material.TUFF
                || material == Material.STONE || material == Material.GRAVEL
                || material == Material.WATER || material == Material.SAND
                || material == Material.CLAY || material == Material.DIORITE
                || material == Material.ANDESITE || material == Material.GRANITE
                || material == Material.MOSS_BLOCK || material == Material.DEEPSLATE_COAL_ORE;
    }
    private Block ground(Pos pos) {
        Block block = world.getHighestBlockAt(pos.x, pos.z, HeightMap.WORLD_SURFACE);
        while (block.getY() > 45 && vegetation(block.getType()))
            block = world.getBlockAt(pos.x, block.getY() - 1, pos.z);
        return block;
    }
    private static String key(Block block) { return block.getX() + "," + block.getY() + "," + block.getZ(); }
    private Path maskPath() { return plugin.getDataFolder().toPath().resolve("trial-road-mask.tsv"); }

    private void readMask() throws IOException {
        List<String> rows = Files.readAllLines(maskPath(), StandardCharsets.UTF_8);
        if (rows.size() < 312 || !rows.get(0).equals("world=" + world.getUID()))
            throw new IOException("trial road mask missing, small or wrong world");
        for (int i = 1; i < rows.size(); i++) {
            String[] cols = rows.get(i).split("\\t", 2);
            if (cols.length != 2) throw new IOException("bad road mask row " + i);
            Material material = Material.matchMaterial(cols[1]);
            if (material == null) throw new IOException("unknown road mask material " + cols[1]);
            fabric.put(cols[0], material);
        }
    }

    private String inspectBlock(Pos pos, int y, int headroom) {
        for (Box house : houses) if (house.near(pos)) return "接近原房屋 " + pos;
        for (int dy = 0; dy <= headroom; dy++) {
            Block block = world.getBlockAt(pos.x, y + dy, pos.z);
            if (block.getState() instanceof TileState || !natural(block.getType()))
                return "原方块不可覆盖 " + block.getLocation() + " " + block.getType();
            if (dy >= 2 && block.getType().isSolid() && !vegetation(block.getType()))
                return "头顶需要凿穿地形 " + block.getLocation() + " " + block.getType();
        }
        return null;
    }

    private String inspect() {
        if (!ready || plan == null || world == null) return "道路规划或保护数据未就绪";
        if (built || plugin.getConfig().getBoolean("trial-road.building", false) || Files.exists(maskPath()))
            return "道路已建、施工曾中断或快照已存在；拒绝覆盖";
        int cuts = 0, logs = 0;
        for (Map.Entry<Pos, Integer> entry : plan.deck().entrySet()) {
            Pos pos = entry.getKey(); int y = entry.getValue(); Block ground = ground(pos);
            if (ground.getY() > y + 1) return "道路低于地面超过一格 " + pos + " ground=" + ground.getY() + " road=" + y;
            if (ground.getY() > y) cuts++;
            String error = inspectBlock(pos, y, 2);
            if (error != null) return error;
            for (int dy = 0; dy <= 2; dy++) if (world.getBlockAt(pos.x, y + dy, pos.z)
                    .getType().name().endsWith("_LOG")) logs++;
        }
        for (Map.Entry<Pos, Integer> entry : plan.rails().entrySet()) {
            Pos pos = entry.getKey(); int y = entry.getValue();
            String error = inspectBlock(pos, y, 2);
            if (error != null) return error;
        }
        if (cuts > 8 || logs > 30) return "需开挖或砍树过多：cuts=" + cuts + " logs=" + logs;
        for (Player player : Bukkit.getOnlinePlayers()) {
            if (player.getWorld() != world || player.getGameMode() == org.bukkit.GameMode.SPECTATOR) continue;
            for (Map.Entry<Pos, Integer> entry : plan.deck().entrySet()) {
                Pos pos = entry.getKey();
                if (Math.abs(player.getLocation().getX() - pos.x - .5) < 3
                        && Math.abs(player.getLocation().getZ() - pos.z - .5) < 3
                        && Math.abs(player.getLocation().getY() - entry.getValue()) < 5)
                    return "道路施工范围有人：" + player.getName();
            }
        }
        return null;
    }

    void survey(CommandSender sender) {
        String error = inspect();
        sender.sendMessage(error == null ? "试炼道路可施工：103 格中心线、312 格路面，起点 -570,63,-411，终点 -590,90,-329；护栏 "
                + plan.rails().size() : "试炼道路暂不可施工：" + error);
    }

    void build(CommandSender sender) {
        String error = inspect();
        if (error != null) { sender.sendMessage("未施工：" + error); return; }
        List<Support> supports = new ArrayList<>();
        for (int i = 0; i < plan.steps().size(); i += 7) {
            Step step = plan.steps().get(i);
            Pos pos = step.pos(); int y = plan.deck().get(pos);
            Block base = ground(pos);
            int bottom = base.getType() == Material.WATER ? seabed(pos, base.getY()) : base.getY();
            if (bottom >= y - 2) continue;
            for (int by = bottom + 1; by < y; by++) {
                Block block = world.getBlockAt(pos.x, by, pos.z);
                if (!natural(block.getType())) {
                    sender.sendMessage("未施工：桥墩会覆盖原方块 " + block.getLocation() + " " + block.getType());
                    return;
                }
            }
            supports.add(new Support(pos, bottom, y, bridge(pos) ? Material.SPRUCE_LOG : Material.STONE_BRICKS));
        }
        plugin.getConfig().set("trial-road.building", true);
        plugin.saveConfig();
        try {
            for (Map.Entry<Pos, Integer> entry : plan.deck().entrySet()) {
                Pos pos = entry.getKey(); int y = entry.getValue();
                clear(pos, y, 2);
                put(pos, y, bridge(pos) ? Material.SPRUCE_PLANKS : Material.STONE_BRICKS);
            }
            // Each rise receives a full-width vanilla stair, while flat cells form landings.
            for (int i = 1; i < plan.steps().size(); i++) {
                Step last = plan.steps().get(i - 1), step = plan.steps().get(i);
                if (step.y <= last.y) continue;
                org.bukkit.block.BlockFace face = step.z > last.z ? org.bukkit.block.BlockFace.NORTH
                        : step.z < last.z ? org.bukkit.block.BlockFace.SOUTH
                        : step.x > last.x ? org.bukkit.block.BlockFace.WEST : org.bukkit.block.BlockFace.EAST;
                for (int offset = -1; offset <= 1; offset++) {
                    Pos pos = step.x != last.x ? new Pos(step.x, step.z + offset)
                            : new Pos(step.x + offset, step.z);
                    if (plan.deck().getOrDefault(pos, -1) != step.y) continue;
                    Material material = bridge(pos) ? Material.SPRUCE_STAIRS : Material.STONE_BRICK_STAIRS;
                    Block block = world.getBlockAt(pos.x, step.y, pos.z);
                    Stairs data = (Stairs) Bukkit.createBlockData(material);
                    data.setFacing(face);
                    block.setBlockData(data, false);
                    fabric.put(key(block), material);
                }
            }
            for (Map.Entry<Pos, Integer> entry : plan.rails().entrySet()) {
                Pos pos = entry.getKey(); int y = entry.getValue();
                clear(pos, y, 2);
                put(pos, y, bridge(pos) ? Material.SPRUCE_PLANKS : Material.STONE_BRICKS);
                put(pos, y + 1, Material.SPRUCE_FENCE);
            }
            for (Support support : supports) {
                for (int by = support.bottom() + 1; by < support.top(); by++)
                    put(support.pos(), by, support.material());
            }
            for (int i = 5; i < plan.steps().size(); i += 12) {
                Step step = plan.steps().get(i);
                Pos side = step.z < -385 ? new Pos(step.x + 2, step.z)
                        : step.x == -590 ? new Pos(step.x + 2, step.z)
                        : new Pos(step.x, step.z - 2);
                Integer railY = plan.rails().get(side);
                if (railY != null && world.getBlockAt(side.x, railY + 2, side.z).getType().isAir())
                    put(side, railY + 2, Material.LANTERN);
            }
            writeMask();
            built = true;
            plugin.getConfig().set("trial-road.built", true);
            plugin.getConfig().set("trial-road.building", false);
            plugin.saveConfig();
            sender.sendMessage("村庄到试炼场的步行道路建成：水上栈道、山坡阶梯与护栏；保护方块 " + fabric.size());
            plugin.getLogger().info("Trial walking road built: protected=" + fabric.size());
        } catch (Exception failure) {
            plugin.getLogger().severe("Trial road construction interrupted; restore backup before retry: " + failure);
            sender.sendMessage("道路施工中断；不得重复执行，须先检查或恢复备份：" + failure);
        }
    }

    private static boolean bridge(Pos pos) { return pos.z <= -385; }
    private void clear(Pos pos, int y, int headroom) {
        for (int dy = 0; dy <= headroom; dy++) {
            Block block = world.getBlockAt(pos.x, y + dy, pos.z);
            if (block.getType() != Material.AIR && natural(block.getType())) block.setType(Material.AIR, false);
        }
    }
    private void put(Pos pos, int y, Material type) {
        Block block = world.getBlockAt(pos.x, y, pos.z);
        block.setType(type, false);
        fabric.put(key(block), type);
    }
    private int seabed(Pos pos, int topY) {
        for (int y = topY; y > 35; y--) {
            Block block = world.getBlockAt(pos.x, y, pos.z);
            if (block.getType().isSolid()) return y;
        }
        throw new IllegalStateException("water pillar has no seabed at " + pos);
    }
    private void writeMask() throws IOException {
        Path mask = maskPath(); Files.createDirectories(mask.getParent());
        List<String> rows = new ArrayList<>(fabric.size() + 1);
        rows.add("world=" + world.getUID());
        fabric.entrySet().stream().sorted(Map.Entry.comparingByKey())
                .forEach(entry -> rows.add(entry.getKey() + "\t" + entry.getValue()));
        Path pending = mask.resolveSibling(mask.getFileName() + ".pending");
        Files.write(pending, rows, StandardCharsets.UTF_8);
        try { Files.move(pending, mask, StandardCopyOption.ATOMIC_MOVE); }
        catch (IOException noAtomic) { Files.move(pending, mask, StandardCopyOption.REPLACE_EXISTING); }
    }

    private boolean protectedFabric(Block block) {
        return built && block.getWorld() == world && fabric.get(key(block)) == block.getType();
    }
    private boolean protectedFabric(org.bukkit.block.BlockState state) {
        return built && state.getWorld() == world && fabric.get(key(state.getBlock())) == state.getType();
    }
    private boolean pathHeadroom(Block block) {
        if (!built || block.getWorld() != world || plan == null) return false;
        Integer floor = plan.deck().get(new Pos(block.getX(), block.getZ()));
        return floor != null && (block.getY() == floor + 1 || block.getY() == floor + 2);
    }
    private boolean failClosed(Block block) {
        if (!built || ready || block.getWorld() != world || plan == null) return false;
        Integer floor = plan.deck().get(new Pos(block.getX(), block.getZ()));
        return floor != null && Math.abs(block.getY() - floor) <= 3;
    }
    boolean deniesBreak(Block block) { return protectedFabric(block) || failClosed(block); }
    boolean deniesPlace(Block block) { return deniesBreak(block) || pathHeadroom(block); }
    @EventHandler(priority = EventPriority.HIGHEST) public void onBreak(BlockBreakEvent event) {
        if (deniesBreak(event.getBlock())) {
            event.setCancelled(true);
            event.getPlayer().sendMessage("§e这是通往试炼场的公共道路；路旁的草木仍可整理。");
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onPlace(BlockPlaceEvent event) {
        if (protectedFabric(event.getBlockReplacedState()) || pathHeadroom(event.getBlock())
                || failClosed(event.getBlock())) event.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onMultiPlace(BlockMultiPlaceEvent event) {
        for (org.bukkit.block.BlockState state : event.getReplacedBlockStates())
            if (protectedFabric(state) || pathHeadroom(state.getBlock()) || failClosed(state.getBlock())) {
                event.setCancelled(true); return;
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
