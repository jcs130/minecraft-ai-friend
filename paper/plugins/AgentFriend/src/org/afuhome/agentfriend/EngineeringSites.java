package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.protection.flags.Flags;
import com.sk89q.worldguard.protection.regions.RegionQuery;
import com.sk89q.worldguard.protection.association.RegionAssociable;
import com.sk89q.worldguard.domains.Association;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.Lightable;
import org.bukkit.block.data.Powerable;
import org.bukkit.block.data.type.Piston;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.block.BlockRedstoneEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.scheduler.BukkitRunnable;

/** Bounded, main-thread engineering surveys. No chunk loading, block editing or permission bypass. */
final class EngineeringSites implements Listener {
    static final String ROOT = "task-market.sites";
    static final Set<GuildManager.Goal> GOALS = Set.of(GuildManager.Goal.BRIDGE,
            GuildManager.Goal.ROAD, GuildManager.Goal.BUILD, GuildManager.Goal.REDSTONE);
    private static final int MAX_CELLS = 16_384, CELLS_PER_TICK = 512;
    private static final RegionAssociable PUBLIC_BUILDER = regions -> Association.NON_MEMBER;
    private static final Set<Material> OUTPUTS = Set.of(Material.REDSTONE_LAMP,
            Material.PISTON, Material.STICKY_PISTON, Material.IRON_DOOR);

    record Pos(int x, int y, int z) {
        String key() { return x + "," + y + "," + z; }
        List<Integer> save() { return List.of(x, y, z); }
    }
    record Box(Pos min, Pos max) {
        boolean contains(Pos p) { return p.x >= min.x && p.x <= max.x && p.y >= min.y
                && p.y <= max.y && p.z >= min.z && p.z <= max.z; }
        int width() { return max.x - min.x + 1; }
        int depth() { return max.z - min.z + 1; }
        int height() { return max.y - min.y + 1; }
        int volume() { return width() * depth() * height(); }
        int index(Pos p) { return ((p.x - min.x) * depth() + p.z - min.z) * height() + p.y - min.y; }
        Pos pos(int i) { return new Pos(min.x + i / (depth() * height()), min.y + i % height(),
                min.z + (i / height()) % depth()); }
        boolean overlaps(Box other) { return min.x <= other.max.x && max.x >= other.min.x
                && min.y <= other.max.y && max.y >= other.min.y
                && min.z <= other.max.z && max.z >= other.min.z; }
    }
    record Site(String id, String world, Box box, Set<Material> materials, int deckY,
            Pos start, Pos end, Map<Material, Integer> components, Map<Pos, Material> outputs) {
        Map<String, Object> save() {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("world", world); data.put("min", box.min.save()); data.put("max", box.max.save());
            data.put("materials", materials.stream().map(Material::name).sorted().toList());
            data.put("deck-y", deckY);
            if (start != null) { data.put("start", start.save()); data.put("end", end.save()); }
            Map<String, Object> parts = new LinkedHashMap<>();
            components.forEach((m, n) -> parts.put(m.name(), n)); data.put("components", parts);
            data.put("outputs", outputs.entrySet().stream().sorted(Map.Entry.comparingByKey(
                    java.util.Comparator.comparing(Pos::key))).map(e -> Map.of("at", e.getKey().save(),
                    "material", e.getValue().name())).toList());
            return data;
        }
    }
    record Result(boolean ready, int progress, String reason, JsonObject evidence) { }
    private record Registered(Site site, UUID worldId, Material[] baseline) { }
    private record Cell(Material material, boolean passable, boolean support) { }
    private record Scan(Site site, Cell[] cells, long revision, Consumer<Scan> finish,
            Consumer<String> failure, boolean registration) { }

    private final AgentFriendPlugin plugin;
    private final Map<String, Registered> sites = new LinkedHashMap<>();
    private final Set<String> activeSites = new HashSet<>();
    private final RegionQuery protection = WorldGuard.getInstance().getPlatform().getRegionContainer().createQuery();
    private final Map<String, Long> revisions = new HashMap<>();
    private final Map<String, Long> inputWindows = new HashMap<>();
    private final Map<String, Map<Pos, Integer>> signals = new HashMap<>();
    private final Set<String> pendingSignals = new HashSet<>();
    private Scan scan;
    private int cursor;

    EngineeringSites(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        ConfigurationSection all = plugin.getConfig().getConfigurationSection(ROOT);
        if (all != null) for (String id : all.getKeys(false)) try {
            ConfigurationSection row = all.getConfigurationSection(id);
            Site site = parse(id, row.getConfigurationSection("definition"));
            UUID worldId = UUID.fromString(row.getString("world-id", ""));
            Material[] baseline = unpack(row.getStringList("baseline"), site.box.volume());
            sites.put(id, new Registered(site, worldId, baseline));
            if (!owner(id).isEmpty()) activeSites.add(id);
        } catch (RuntimeException invalid) {
            plugin.getLogger().severe("Engineering site unavailable, preserving original data: " + id + " " + invalid);
        }
        Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getScheduler().runTaskTimer(plugin, this::pump, 1L, 1L);
    }

    static Site parse(String id, ConfigurationSection data) {
        if (!id.matches("[a-z0-9_]{2,40}") || data == null) throw new IllegalArgumentException("site " + id);
        String world = data.getString("world", "world");
        if (!world.matches("[a-zA-Z0-9_/-]{1,60}")) throw new IllegalArgumentException(id + " world");
        Pos min = pos(data.getList("min")), max = pos(data.getList("max"));
        if (min.x > max.x || min.y > max.y || min.z > max.z || Math.abs((long) min.x) > 29_999_000
                || Math.abs((long) max.x) > 29_999_000 || Math.abs((long) min.z) > 29_999_000
                || Math.abs((long) max.z) > 29_999_000 || min.y < -64 || max.y > 317)
            throw new IllegalArgumentException(id + " bounds");
        long volume = ((long) max.x - min.x + 1) * ((long) max.y - min.y + 1) * ((long) max.z - min.z + 1);
        if (volume > MAX_CELLS || max.x - min.x > 127 || max.z - min.z > 127 || max.y - min.y > 31)
            throw new IllegalArgumentException(id + " area too large (max " + MAX_CELLS + ")");
        Box box = new Box(min, max);
        Set<Material> materials = new HashSet<>();
        for (String name : data.getStringList("materials")) materials.add(blockMaterial(name));
        if (materials.isEmpty() || materials.size() > 64) throw new IllegalArgumentException(id + " materials");
        int deck = data.getInt("deck-y", min.y);
        if (deck < min.y || deck > max.y) throw new IllegalArgumentException(id + " deck-y");
        Pos start = data.contains("start") ? pos(data.getList("start")) : null;
        Pos end = data.contains("end") ? pos(data.getList("end")) : null;
        if ((start == null) != (end == null) || start != null
                && (!box.contains(start) || !box.contains(end) || start.equals(end)))
            throw new IllegalArgumentException(id + " endpoints");
        Map<Material, Integer> components = new HashMap<>();
        ConfigurationSection parts = data.getConfigurationSection("components");
        if (parts != null) for (String key : parts.getKeys(false)) {
            int amount = parts.getInt(key);
            if (amount < 1 || amount > 1024) throw new IllegalArgumentException(id + " component count");
            components.put(blockMaterial(key), amount);
        }
        Map<Pos, Material> outputs = new HashMap<>();
        for (Map<?, ?> row : data.getMapList("outputs")) {
            Pos at = pos(row.get("at"));
            Material material = blockMaterial(String.valueOf(row.get("material")));
            if (!box.contains(at) || !OUTPUTS.contains(material) || outputs.put(at, material) != null)
                throw new IllegalArgumentException(id + " output");
        }
        if (outputs.size() > 8 || components.size() > 24) throw new IllegalArgumentException(id + " too many parts");
        for (Material output : outputs.values()) if (!components.containsKey(output))
            throw new IllegalArgumentException(id + " outputs must also occur in components");
        return new Site(id, world, box, Set.copyOf(materials), deck, start, end,
                Map.copyOf(components), Map.copyOf(outputs));
    }

    private static Pos pos(Object raw) {
        if (!(raw instanceof List<?> list) || list.size() != 3 || list.stream().anyMatch(v -> !(v instanceof Number n)
                || !Double.isFinite(n.doubleValue()) || n.doubleValue() != n.intValue()))
            throw new IllegalArgumentException("coordinate must be three integers");
        return new Pos(((Number) list.get(0)).intValue(), ((Number) list.get(1)).intValue(), ((Number) list.get(2)).intValue());
    }
    private static Material blockMaterial(String name) {
        Material type = Material.matchMaterial(name);
        if (type == null || !type.isBlock() || type.isAir() || type == Material.WATER || type == Material.LAVA
                || type == Material.BEDROCK || type == Material.BARRIER || type.name().contains("COMMAND_BLOCK"))
            throw new IllegalArgumentException("unsupported building material " + name);
        return type;
    }
    Site site(String id) { Registered row = sites.get(id); return row == null ? null : row.site; }
    boolean exists(String id) { return sites.containsKey(id); }
    String owner(String id) { return plugin.getConfig().getString(ROOT + "." + id + ".owner", ""); }
    boolean completed(String id) { return plugin.getConfig().getBoolean(ROOT + "." + id + ".completed", false); }
    boolean retired(String id) { return plugin.getConfig().getBoolean(ROOT + "." + id + ".retired", false); }
    boolean available(String id) { return exists(id) && !completed(id) && !retired(id) && owner(id).isEmpty(); }
    boolean lockedBy(String id, Player player, String run) { return owner(id).equals(player.getUniqueId().toString())
            && run.equals(plugin.getConfig().getString(ROOT + "." + id + ".run", "")) && !completed(id); }
    void reserve(String id, Player player, String run) {
        activeSites.add(id);
        plugin.getConfig().set(ROOT + "." + id + ".owner", player.getUniqueId().toString());
        plugin.getConfig().set(ROOT + "." + id + ".run", run); clearSignals(id);
    }
    void release(String id, String run, boolean complete) {
        if (!run.equals(plugin.getConfig().getString(ROOT + "." + id + ".run", ""))) return;
        activeSites.remove(id);
        if (complete) {
            plugin.getConfig().set(ROOT + "." + id + ".completed", true);
            plugin.getConfig().set(ROOT + "." + id + ".completed-at", System.currentTimeMillis());
        }
        plugin.getConfig().set(ROOT + "." + id + ".owner", null);
        plugin.getConfig().set(ROOT + "." + id + ".run", null); clearSignals(id);
    }
    boolean retire(String id) {
        if (!exists(id) || !owner(id).isEmpty() || scan != null && scan.site.id.equals(id)) return false;
        plugin.getConfig().set(ROOT + "." + id + ".retired", true); plugin.saveConfig(); return true;
    }
    private World loadedWorld(Site site) {
        World world = Bukkit.getWorld(site.world);
        Registered registered = sites.get(site.id);
        if (world == null || registered != null && !world.getUID().equals(registered.worldId)) return null;
        if (site.box.min.y < world.getMinHeight() || site.box.max.y + 2 >= world.getMaxHeight()) return null;
        for (int x = site.box.min.x >> 4; x <= site.box.max.x >> 4; x++)
            for (int z = site.box.min.z >> 4; z <= site.box.max.z >> 4; z++) if (!world.isChunkLoaded(x, z)) return null;
        return world;
    }

    void register(Site site, Consumer<String> answer) {
        if (plugin.getConfig().contains(ROOT + "." + site.id)) { answer.accept("site_id_already_used：旧基准不可重置，请使用新 ID。"); return; }
        for (Registered row : sites.values()) if (row.site.world.equals(site.world) && !retired(row.site.id)
                && !completed(row.site.id) && row.site.box.overlaps(site.box)) {
            answer.accept("overlapping_site：与 " + row.site.id + " 重叠。"); return;
        }
        begin(site, true, current -> {
            Material[] baseline = Arrays.stream(current.cells).map(Cell::material).toArray(Material[]::new);
            World world = loadedWorld(site);
            if (world == null) { answer.accept("area_unloaded"); return; }
            sites.put(site.id, new Registered(site, world.getUID(), baseline));
            String path = ROOT + "." + site.id;
            plugin.getConfig().set(path + ".definition", site.save());
            plugin.getConfig().set(path + ".world-id", world.getUID().toString());
            plugin.getConfig().set(path + ".baseline", pack(baseline));
            plugin.getConfig().set(path + ".registered-at", System.currentTimeMillis());
            plugin.saveConfig(); answer.accept("registered：" + site.id + "，快照 " + baseline.length + " 格。");
        }, answer);
    }

    void verify(Player player, GuildManager.Contract contract, String run, Consumer<Result> answer) {
        verify(player, contract, run, true, answer);
    }
    void recheck(Player player, GuildManager.Contract contract, String run, Consumer<Result> answer) {
        verify(player, contract, run, false, answer);
    }
    private void verify(Player player, GuildManager.Contract contract, String run, boolean requireNear, Consumer<Result> answer) {
        Registered row = sites.get(contract.siteId());
        if (row == null || !lockedBy(contract.siteId(), player, run)) {
            answer.accept(failure("site_not_reserved")); return;
        }
        if (requireNear && !near(player, row.site)) { answer.accept(failure("not_at_site")); return; }
        begin(row.site, false, current -> {
            if (!player.isOnline() || requireNear && !near(player, row.site) || !lockedBy(row.site.id, player, run)) {
                answer.accept(failure("site_or_player_changed")); return;
            }
            answer.accept(evaluate(row, current.cells, contract));
        }, reason -> answer.accept(failure(reason)));
    }
    private boolean near(Player player, Site site) {
        Location at = player.getLocation(); Box b = site.box;
        return player.getWorld().getName().equals(site.world) && !player.isDead()
                && player.getGameMode() == org.bukkit.GameMode.SURVIVAL
                && at.getX() >= b.min.x - 12 && at.getX() <= b.max.x + 13
                && at.getY() >= b.min.y - 12 && at.getY() <= b.max.y + 14
                && at.getZ() >= b.min.z - 12 && at.getZ() <= b.max.z + 13;
    }
    private Result failure(String reason) { return new Result(false, 0, reason.split("：", 2)[0], new JsonObject()); }
    private void begin(Site site, boolean registration, Consumer<Scan> finish, Consumer<String> failure) {
        if (scan != null) { failure.accept("scan_busy：稍后再试。"); return; }
        if (loadedWorld(site) == null) { failure.accept("area_unloaded：须到场加载整个场地，服务器不会强加载。"); return; }
        cursor = 0;
        scan = new Scan(site, new Cell[site.box.volume()], revisions.getOrDefault(site.id, 0L), finish, failure, registration);
    }
    private void pump() {
        Scan current = scan;
        if (current == null) return;
        try { scanTick(current); }
        catch (RuntimeException | LinkageError unavailable) {
            scan = null;
            plugin.getLogger().warning("Engineering scan failed closed for " + current.site.id + ": " + unavailable);
            current.failure.accept("scan_failed");
        }
    }
    private void scanTick(Scan current) {
        World world = loadedWorld(current.site);
        if (world == null) { scan = null; current.failure.accept("area_unloaded"); return; }
        int end = Math.min(cursor + CELLS_PER_TICK, current.cells.length);
        long deadline = System.nanoTime() + 2_000_000;
        while (cursor < end) {
            Pos at = current.site.box.pos(cursor); Block block = world.getBlockAt(at.x, at.y, at.z);
            if (current.registration && protectedBlock(block)) {
                scan = null; current.failure.accept("protected_site：" + at.key() + " 属于既有受保护建筑/私产。"); return;
            }
            boolean clear = world.getBlockAt(at.x, at.y + 1, at.z).isPassable()
                    && world.getBlockAt(at.x, at.y + 2, at.z).isPassable();
            current.cells[cursor++] = new Cell(block.getType(), clear, !block.getCollisionShape().getBoundingBoxes().isEmpty());
            if (System.nanoTime() >= deadline) break;
        }
        if (cursor < current.cells.length) return;
        scan = null;
        if (current.revision != revisions.getOrDefault(current.site.id, 0L)) {
            current.failure.accept("site_changed_during_scan：请暂停施工后重新验收。"); return;
        }
        current.finish.accept(current);
    }
    private boolean protectedBlock(Block block) {
        return plugin.guildHall().containsProperty(block.getLocation()) || plugin.guildHall().deniesEdit(block)
                || plugin.villageProtection().deniesEdit(block) || plugin.lifeBuildings().deniesEdit(block)
                || plugin.trialRoad().deniesBreak(block) || plugin.trialRoad().deniesPlace(block)
                || plugin.deniesArenaEdit(block) || plugin.dungeon().deniesEdit(block.getLocation())
                || plugin.generatedStructures() != null && plugin.generatedStructures().reason(block.getLocation()) != null
                || !protection.testBuild(BukkitAdapter.adapt(block.getLocation()), PUBLIC_BUILDER, Flags.BLOCK_BREAK, Flags.BLOCK_PLACE);
    }

    private Result evaluate(Registered row, Cell[] cells, GuildManager.Contract contract) {
        Site site = row.site; Map<Material, Integer> added = new HashMap<>();
        Map<Material, Integer> net = new HashMap<>(), construction = new HashMap<>(), paving = new HashMap<>();
        int newBlocks = 0, roadColumns = 0;
        Set<Pos> walk = new HashSet<>();
        for (int i = 0; i < cells.length; i++) {
            Cell cell = cells[i]; Pos at = site.box.pos(i);
            boolean delta = cell.material != row.baseline[i];
            net.merge(cell.material, 1, Integer::sum); net.merge(row.baseline[i], -1, Integer::sum);
            if (delta) added.merge(cell.material, 1, Integer::sum);
            boolean deck = at.y >= site.deckY && at.y <= site.deckY + 4;
            if (site.materials.contains(cell.material) && delta
                    && (contract.goal() != GuildManager.Goal.BRIDGE || deck)) construction.merge(cell.material, 1, Integer::sum);
            if (at.y == site.deckY && site.materials.contains(cell.material) && delta && cell.passable && cell.support)
                paving.merge(cell.material, 1, Integer::sum);
            if (deck && site.materials.contains(cell.material) && cell.passable && cell.support
                    && (delta || at.equals(site.start) || at.equals(site.end))) walk.add(at);
        }
        // Position deltas alone would count moving the same old blocks within a site.
        // Require both a changed position and a positive material inventory delta.
        added.replaceAll((material, changed) -> Math.min(changed, Math.max(0, net.getOrDefault(material, 0))));
        for (var entry : construction.entrySet()) newBlocks += Math.min(entry.getValue(), added.getOrDefault(entry.getKey(), 0));
        for (var entry : paving.entrySet()) roadColumns += Math.min(entry.getValue(), added.getOrDefault(entry.getKey(), 0));
        int coverage = roadColumns * 100 / (site.box.width() * site.box.depth());
        boolean connected = site.start != null && reachable(walk, site.start, site.end);
        JsonObject evidence = new JsonObject(); evidence.addProperty("site", site.id);
        evidence.addProperty("newBlocks", newBlocks); evidence.addProperty("newWalkableColumns", roadColumns);
        evidence.addProperty("coveragePercent", coverage); evidence.addProperty("connected", connected);
        JsonObject counts = new JsonObject(); added.entrySet().stream().filter(e -> site.materials.contains(e.getKey())
                || site.components.containsKey(e.getKey())).sorted(Map.Entry.comparingByKey())
                .forEach(e -> counts.addProperty(e.getKey().name(), e.getValue())); evidence.add("added", counts);
        String reason = "ready"; int progress = newBlocks;
        if (contract.goal() == GuildManager.Goal.ROAD) {
            progress = coverage; if (progress < contract.target()) reason = "insufficient_road_coverage";
        } else if (contract.goal() != GuildManager.Goal.REDSTONE && progress < contract.target()) reason = "insufficient_new_blocks";
        if (contract.goal() == GuildManager.Goal.BRIDGE && !connected) reason = "bridge_not_connected";
        boolean mechanism = contract.goal() == GuildManager.Goal.REDSTONE;
        if (mechanism) {
            JsonObject missing = new JsonObject();
            for (Map.Entry<Material, Integer> part : site.components.entrySet()) {
                int need = part.getValue() - added.getOrDefault(part.getKey(), 0);
                if (need > 0) missing.addProperty(part.getKey().name(), need);
            }
            evidence.add("missingComponents", missing);
            int flipped = 0; Map<Pos, Integer> observed = signals(site.id);
            for (Map.Entry<Pos, Material> output : site.outputs.entrySet()) {
                int i = site.box.index(output.getKey());
                if (cells[i].material == output.getValue() && row.baseline[i] != output.getValue()
                        && observed.getOrDefault(output.getKey(), 0) == 3) flipped++;
            }
            evidence.addProperty("signalOutputsVerified", flipped);
            evidence.addProperty("signalOutputsRequired", site.outputs.size());
            progress = missing.isEmpty() && flipped == site.outputs.size() ? contract.target() : 0;
            if (!missing.isEmpty()) reason = "missing_components";
            else if (flipped != site.outputs.size()) reason = "signal_not_observed";
        }
        boolean ready = reason.equals("ready");
        return new Result(ready, ready ? contract.target() : Math.min(progress, contract.target() - 1), reason, evidence);
    }
    private static boolean reachable(Set<Pos> walk, Pos start, Pos end) {
        if (!walk.contains(start) || !walk.contains(end)) return false;
        ArrayDeque<Pos> queue = new ArrayDeque<>(); Set<Pos> seen = new HashSet<>();
        queue.add(start); seen.add(start);
        while (!queue.isEmpty()) {
            Pos at = queue.remove(); if (at.equals(end)) return true;
            for (int[] step : new int[][]{{1, 0}, {-1, 0}, {0, 1}, {0, -1}})
                for (int dy = -1; dy <= 1; dy++) {
                    Pos next = new Pos(at.x + step[0], at.y + dy, at.z + step[1]);
                    if (walk.contains(next) && seen.add(next)) queue.add(next);
                }
        }
        return false;
    }

    private static List<String> pack(Material[] cells) {
        List<String> packed = new ArrayList<>(); int count = 0; Material previous = null;
        for (Material material : cells) {
            if (material != previous && count > 0) { packed.add(previous.name() + ":" + count); count = 0; }
            previous = material; count++;
        }
        if (count > 0) packed.add(previous.name() + ":" + count); return packed;
    }
    private static Material[] unpack(List<String> packed, int size) {
        Material[] result = new Material[size]; int offset = 0;
        for (String value : packed) {
            String[] parts = value.split(":");
            if (parts.length != 2) throw new IllegalArgumentException("invalid snapshot");
            Material material = Material.matchMaterial(parts[0]); int length = Integer.parseInt(parts[1]);
            if (material == null || length < 1 || (long) offset + length > size) throw new IllegalArgumentException("invalid snapshot run");
            Arrays.fill(result, offset, offset + length, material); offset += length;
        }
        if (offset != size) throw new IllegalArgumentException("incomplete snapshot"); return result;
    }
    private Map<Pos, Integer> signals(String id) {
        return signals.computeIfAbsent(id, key -> {
            Map<Pos, Integer> result = new HashMap<>(); Site site = site(id);
            if (site != null) for (Pos at : site.outputs.keySet())
                result.put(at, plugin.getConfig().getInt(ROOT + "." + id + ".signals." + at.key(), 0));
            return result;
        });
    }
    private void clearSignals(String id) {
        signals.remove(id); inputWindows.remove(id);
        plugin.getConfig().set(ROOT + "." + id + ".signals", null);
    }
    private void edited(Block block) { dirty(block, true); }
    private void dirty(Block block, boolean resetSignal) {
        Pos at = new Pos(block.getX(), block.getY(), block.getZ());
        for (String id : activeSites) {
            Registered row = sites.get(id);
            if (!row.site.world.equals(block.getWorld().getName()) || !row.site.box.contains(at)) continue;
            revisions.merge(row.site.id, 1L, Long::sum);
            if (resetSignal) {
                boolean persisted = plugin.getConfig().contains(ROOT + "." + row.site.id + ".signals");
                clearSignals(row.site.id);
                if (persisted) plugin.saveConfig();
            }
        }
        if (scan != null && !activeSites.contains(scan.site.id) && scan.site.world.equals(block.getWorld().getName()) && scan.site.box.contains(at))
            revisions.merge(scan.site.id, 1L, Long::sum);
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void placed(BlockPlaceEvent event) { edited(event.getBlock()); }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void broken(BlockBreakEvent event) { edited(event.getBlock()); }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void piston(org.bukkit.event.block.BlockPistonExtendEvent event) {
        dirty(event.getBlock(), false);
        for (Block block : event.getBlocks()) { dirty(block, false); dirty(block.getRelative(event.getDirection()), false); }
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void pistonBack(org.bukkit.event.block.BlockPistonRetractEvent event) {
        dirty(event.getBlock(), false);
        for (Block block : event.getBlocks()) { dirty(block, false); dirty(block.getRelative(event.getDirection()), false); }
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void flow(org.bukkit.event.block.BlockFromToEvent event) { dirty(event.getToBlock(), false); }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void explosion(org.bukkit.event.entity.EntityExplodeEvent event) { for (Block block : event.blockList()) edited(block); }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void blockExplosion(org.bukkit.event.block.BlockExplodeEvent event) { for (Block block : event.blockList()) edited(block); }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void interact(PlayerInteractEvent event) {
        if (event.getAction() != Action.RIGHT_CLICK_BLOCK || event.getClickedBlock() == null
                || event.getPlayer().getGameMode() != org.bukkit.GameMode.SURVIVAL
                || event.useInteractedBlock() == org.bukkit.event.Event.Result.DENY) return;
        Block block = event.getClickedBlock(); String type = block.getType().name();
        if (!type.endsWith("_BUTTON") && block.getType() != Material.LEVER) return;
        Pos at = new Pos(block.getX(), block.getY(), block.getZ());
        for (String id : activeSites) {
            Registered row = sites.get(id);
            if (!row.site.outputs.isEmpty()
                && row.site.world.equals(block.getWorld().getName()) && row.site.box.contains(at)
                && owner(row.site.id).equals(event.getPlayer().getUniqueId().toString())) {
            inputWindows.put(row.site.id, System.currentTimeMillis() + 5000);
            sample(row); scheduleSignals(row);
        }
        }
    }
    @EventHandler(priority = EventPriority.MONITOR)
    public void redstone(BlockRedstoneEvent event) {
        Block block = event.getBlock(); Pos at = new Pos(block.getX(), block.getY(), block.getZ());
        for (String id : activeSites) {
            Registered row = sites.get(id);
            if (inputWindows.getOrDefault(row.site.id, 0L) >= System.currentTimeMillis()
                && row.site.world.equals(block.getWorld().getName()) && row.site.box.contains(at)) scheduleSignals(row);
        }
    }
    private void scheduleSignals(Registered row) {
        if (!pendingSignals.add(row.site.id)) return;
        new BukkitRunnable() {
            int age;
            @Override public void run() {
                if (++age > 100 || owner(row.site.id).isEmpty() || loadedWorld(row.site) == null
                        || inputWindows.getOrDefault(row.site.id, 0L) < System.currentTimeMillis()) {
                    pendingSignals.remove(row.site.id); cancel(); return;
                }
                sample(row);
            }
        }.runTaskTimer(plugin, 1L, 1L);
    }
    private void sample(Registered row) {
        World world = loadedWorld(row.site); if (world == null || owner(row.site.id).isEmpty()) return;
        boolean changed = false; Map<Pos, Integer> observed = signals(row.site.id);
        for (Map.Entry<Pos, Material> output : row.site.outputs.entrySet()) {
            Pos at = output.getKey(); Block block = world.getBlockAt(at.x, at.y, at.z);
            if (block.getType() != output.getValue() || row.baseline[row.site.box.index(at)] == output.getValue()) continue;
            var data = block.getBlockData();
            boolean powered = data instanceof Lightable lamp ? lamp.isLit()
                    : data instanceof Piston piston ? piston.isExtended()
                    : data instanceof Powerable powerable ? powerable.isPowered() : block.getBlockPower() > 0;
            int before = observed.getOrDefault(at, 0), after = before | (powered ? 2 : 1);
            if (before != after) { observed.put(at, after); changed = true;
                plugin.getConfig().set(ROOT + "." + row.site.id + ".signals." + at.key(), after); }
        }
        if (changed) plugin.saveConfig();
    }
}
