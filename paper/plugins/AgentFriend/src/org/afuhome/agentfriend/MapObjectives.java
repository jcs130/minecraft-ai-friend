package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.minecraft.core.component.DataComponents;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.BlockState;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.craftbukkit.inventory.CraftItemStack;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.world.LootGenerateEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.MapMeta;

/** Bind existing map markers, survey natural ruins or open fresh buried treasure, then return. */
final class MapObjectives implements Listener {
    private static final Set<String> ICONS = Set.of("red_x", "mansion", "monument", "target_x", "target_point",
            "village_desert", "village_plains", "village_savanna", "village_snowy", "village_taiga",
            "jungle_temple", "swamp_hut", "trial_chambers");
    private static final String CLAIMS = "task-market.map-discoveries.";
    record Rules(int zoneSize, int minDistance, int minSeconds, int minParts, int minHeight, int treasureRadius, int returnRadius) {
        JsonObject json() {
            JsonObject j = new JsonObject(); j.addProperty("bind", "main_hand_map_marker");
            j.addProperty("zoneSize", zoneSize); j.addProperty("minDistance", minDistance); j.addProperty("minMovingSeconds", minSeconds);
            j.addProperty("minSections", minParts); j.addProperty("minHeightSpan", minHeight);
            j.addProperty("treasureSurveyRadius", treasureRadius); j.addProperty("returnRadius", returnRadius);
            j.addProperty("returnRequired", true); j.addProperty("destinationOncePerPlayer", true);
            j.addProperty("freshNaturalTreasureRequired", true); return j;
        }
    }
    static Rules parse(ConfigurationSection row, int count) {
        int size = row.getInt("zone-size", 4), distance = row.getInt("min-distance", 24), seconds = row.getInt("min-seconds", 15);
        int parts = row.getInt("min-sections", 1), height = row.getInt("min-height-span", 0);
        int radius = row.getInt("treasure-radius", 32), home = row.getInt("return-radius", 16);
        if (count < 2 || count > 128 || size < 4 || size > 64 || distance < 8 || distance > 8192 || seconds < 5 || seconds > 900
                || parts < 1 || parts > 32 || height < 0 || height > 128 || radius < 16 || radius > 128 || home < 4 || home > 32)
            throw new IllegalArgumentException("map_hunt exploration/return bounds");
        return new Rules(size, distance, seconds, parts, height, radius, home);
    }
    private record Marker(int mapId, UUID world, String dimension, int x, int z, String icon, String title) {
        String key() { return digest(world + ":" + x + ":" + z); }
        JsonObject json() {
            JsonObject j = new JsonObject(); j.addProperty("mapId", mapId); j.addProperty("worldUuid", world.toString());
            j.addProperty("dimension", dimension); j.addProperty("x", x); j.addProperty("z", z);
            j.addProperty("icon", icon); j.addProperty("title", title); j.addProperty("source", "item_map_decoration");
            j.addProperty("heightKnown", false); return j;
        }
        static Marker from(JsonObject j) {
            return new Marker(j.get("mapId").getAsInt(), UUID.fromString(j.get("worldUuid").getAsString()),
                    j.get("dimension").getAsString(), j.get("x").getAsInt(), j.get("z").getAsInt(),
                    j.get("icon").getAsString(), j.get("title").getAsString());
        }
    }
    private static Marker held(Player p) {
        ItemStack item = p.getInventory().getItemInMainHand();
        if (item.getType() != Material.FILLED_MAP || !(item.getItemMeta() instanceof MapMeta meta) || !meta.hasMapView())
            throw new IllegalArgumentException("hold_explorer_or_treasure_map");
        var view = meta.getMapView();
        if (view == null || view.getWorld() == null) throw new IllegalArgumentException("map_world_unavailable");
        var decorations = CraftItemStack.asNMSCopy(item).get(DataComponents.MAP_DECORATIONS);
        if (decorations == null || decorations.decorations().size() > 16) throw new IllegalArgumentException("map_has_no_target_marker");
        Marker result = null;
        for (var entry : decorations.decorations().values()) {
            String icon = entry.type().unwrapKey().map(k -> k.location().getPath()).orElse("");
            if (!ICONS.contains(icon)) continue;
            if (!Double.isFinite(entry.x()) || !Double.isFinite(entry.z()) || Math.abs(entry.x()) > 29999984 || Math.abs(entry.z()) > 29999984)
                throw new IllegalArgumentException("invalid_map_marker");
            if (!view.getWorld().getWorldBorder().isInside(new Location(view.getWorld(), entry.x(), 64, entry.z())))
                throw new IllegalArgumentException("map_target_outside_world_border");
            if (result != null) throw new IllegalArgumentException("map_multiple_target_markers");
            String title = meta.hasDisplayName() ? org.bukkit.ChatColor.stripColor(meta.getDisplayName()) : "探险地图";
            if (title == null) title = "探险地图";
            result = new Marker(view.getId(), view.getWorld().getUID(), view.getWorld().getKey().toString(),
                    (int) Math.floor(entry.x()), (int) Math.floor(entry.z()), icon, title.substring(0, Math.min(100, title.length())));
        }
        if (result == null) throw new IllegalArgumentException("map_has_no_target_marker");
        return result;
    }
    private static final class State {
        final String run; final int step; final Marker marker; final Location origin;
        String structure = "", instance = "", bounds = "", mode = "";
        boolean opened, surveyed;
        JsonObject proof = new JsonObject(), survey = new JsonObject();
        State(String run, int step, Marker marker, Location origin) { this.run = run; this.step = step; this.marker = marker; this.origin = origin.clone(); }
        State(JsonObject j) {
            run = j.get("run").getAsString(); step = j.get("step").getAsInt(); marker = Marker.from(j.getAsJsonObject("map"));
            JsonObject at = j.getAsJsonObject("origin"); World world = Bukkit.getWorld(UUID.fromString(at.get("worldUuid").getAsString()));
            if (world == null) throw new IllegalArgumentException("return_world_unavailable");
            origin = new Location(world, at.get("x").getAsDouble(), at.get("y").getAsDouble(), at.get("z").getAsDouble());
            structure = j.get("structure").getAsString(); instance = j.get("instance").getAsString(); bounds = j.get("bounds").getAsString(); mode = j.get("mode").getAsString();
            opened = j.get("opened").getAsBoolean(); surveyed = j.get("surveyed").getAsBoolean(); proof = j.getAsJsonObject("proof"); survey = j.getAsJsonObject("survey");
        }
        JsonObject json() {
            JsonObject j = new JsonObject(); j.addProperty("run", run); j.addProperty("step", step); j.add("map", marker.json()); j.add("origin", position(origin));
            j.addProperty("structure", structure); j.addProperty("instance", instance); j.addProperty("bounds", bounds); j.addProperty("mode", mode);
            j.addProperty("opened", opened); j.addProperty("surveyed", surveyed); j.add("proof", proof); j.add("survey", survey); return j;
        }
    }
    private record LootProof(String run, int step, String block, long at, ExplorationObjectives.MapPlace place, Location location, String table) { }
    private final AgentFriendPlugin plugin;
    private final ExplorationObjectives exploration;
    private final Map<UUID, State> states = new HashMap<>();
    private final Map<UUID, LootProof> pending = new HashMap<>();
    MapObjectives(AgentFriendPlugin plugin, ExplorationObjectives exploration) {
        this.plugin = plugin; this.exploration = exploration; Bukkit.getPluginManager().registerEvents(this, plugin);
    }
    private String market(Player p) { return "guild-players." + p.getUniqueId() + ".active.market"; }
    private String path(Player p) { return market(p) + ".map-hunt"; }
    private State state(Player p) {
        String run = plugin.getConfig().getString(market(p) + ".run", "");
        if (run.isEmpty()) return null;
        State s = states.get(p.getUniqueId());
        if (s != null && s.run.equals(run)) return s;
        String raw = plugin.getConfig().getString(path(p), "");
        if (raw.isEmpty()) return null;
        try {
            s = new State(JsonParser.parseString(raw).getAsJsonObject());
            if (!s.run.equals(run)) return null;
            states.put(p.getUniqueId(), s); return s;
        } catch (RuntimeException invalid) { return null; } // Retain invalid bytes; never infer completion.
    }
    private boolean current(Player p, State s) {
        return s != null && s.step == plugin.getConfig().getInt(market(p) + ".step", -1)
                && p.getGameMode() == GameMode.SURVIVAL && !p.isDead();
    }
    private void persist(Player p, State s) { plugin.getConfig().set(path(p), s.json().toString()); exploration.changed(); }
    void forget(Player p) { states.remove(p.getUniqueId()); pending.remove(p.getUniqueId()); }
    void clear(Player p) { forget(p); plugin.getConfig().set(path(p), null); }
    String denial(Player p) {
        try {
            Marker m = held(p);
            ConfigurationSection claims = plugin.getConfig().getConfigurationSection(CLAIMS + p.getUniqueId() + ".targets");
            if (claims != null && claims.getKeys(false).size() >= 1024) return "map_discovery_record_limit";
            return claimed(p, "targets", m.key()) ? "map_destination_already_completed" : "available";
        } catch (IllegalArgumentException invalid) { return invalid.getMessage(); }
    }
    void accepted(Player p, String run, int step) {
        State s = new State(run, step, held(p), p.getLocation()); states.put(p.getUniqueId(), s); persist(p, s);
    }
    private boolean claimed(Player p, String type, String key) { return plugin.getConfig().contains(CLAIMS + p.getUniqueId() + "." + type + "." + key); }
    void completed(Player p) {
        State s = state(p); if (s == null) throw new IllegalStateException("Missing verified map binding");
        String root = CLAIMS + p.getUniqueId();
        plugin.getConfig().set(root + ".targets." + s.marker.key(), s.run);
        plugin.getConfig().set(root + ".structures." + digest(s.instance), s.run);
    }
    JsonObject info(Player p) {
        JsonObject j = new JsonObject(); State s = state(p);
        try {
            Marker m = s == null ? held(p) : s.marker; j.addProperty("success", true); j.add("map", m.json());
            j.addProperty("reason", s == null ? denial(p) : "bound_to_active_contract");
            if (s != null) { j.add("returnTo", position(s.origin)); j.addProperty("mode", s.mode); j.addProperty("structure", s.structure); j.addProperty("treasureOpened", s.opened); j.addProperty("surveyed", s.surveyed); }
        } catch (IllegalArgumentException invalid) { j.addProperty("success", false); j.addProperty("reason", invalid.getMessage()); }
        j.addProperty("acceptCommand", "/mycli guild accept tm_map_hunt");
        j.addProperty("verifyCommand", "/mycli guild verify"); j.addProperty("claimCommand", "/mycli guild claim");
        j.addProperty("mapsConsumed", false); return j;
    }
    EngineeringSites.Result observe(Player p, Rules rules, int count, String run) {
        State s = state(p);
        if (!current(p, s) || !s.run.equals(run)) return unavailable("map_binding_missing_or_invalid", count);
        JsonObject evidence = s.survey.deepCopy(); evidence.addProperty("source", "server_map_hunt"); evidence.add("map", s.marker.json());
        evidence.add("returnTo", position(s.origin)); evidence.add("requirements", rules.json());
        evidence.addProperty("structure", s.structure); evidence.addProperty("structureInstance", s.instance);
        evidence.addProperty("mode", s.mode); evidence.addProperty("treasureOpened", s.opened); evidence.add("treasureProof", s.proof);
        if (claimed(p, "targets", s.marker.key()) || !s.instance.isEmpty() && claimed(p, "structures", digest(s.instance)))
            return result(false, 0, "map_destination_already_completed", evidence);
        if (!s.surveyed) {
            Location at = p.getLocation();
            if (!at.getWorld().getUID().equals(s.marker.world)) { exploration.resetMovement(p); return result(false, 0, "travel_to_map_world", evidence); }
            if (s.instance.isEmpty()) {
                var place = ExplorationObjectives.mapPlace(at, s.marker.x, s.marker.z);
                if (place != null && !place.key().equals("minecraft:buried_treasure")) {
                    s.instance = place.instance(); s.structure = place.key(); s.bounds = place.bounds(); s.mode = "structure"; persist(p, s);
                }
            }
            if (s.instance.isEmpty()) { exploration.resetMovement(p); return result(false, 0, "find_natural_map_target_or_fresh_treasure", evidence); }
            if (claimed(p, "structures", digest(s.instance))) return result(false, 0, "map_destination_already_completed", evidence);
            boolean treasure = s.mode.equals("treasure");
            if (treasure && (!s.opened || Math.hypot(at.getX() - s.marker.x, at.getZ() - s.marker.z) > rules.treasureRadius)) {
                exploration.resetMovement(p); return result(false, 0, "survey_near_opened_treasure", evidence);
            }
            var target = new ExplorationObjectives.Target(treasure ? GuildManager.Goal.DIMENSION : GuildManager.Goal.STRUCTURE,
                    environment(at.getWorld()), treasure ? List.of() : List.of(s.structure), rules.zoneSize, rules.minDistance,
                    rules.minSeconds, treasure ? 0 : rules.minParts, 1, treasure ? 0 : rules.minHeight);
            EngineeringSites.Result route = exploration.observe(p, target, count, s.run + ":map:" + s.step, treasure ? "" : s.instance);
            s.survey = route.evidence().deepCopy();
            if (route.ready()) { s.surveyed = true; persist(p, s); }
            // Merge current route evidence while keeping map identity and return conditions separate.
            evidence = s.survey.deepCopy(); evidence.addProperty("source", "server_map_hunt"); evidence.add("map", s.marker.json());
            evidence.add("returnTo", position(s.origin)); evidence.add("requirements", rules.json());
            evidence.addProperty("structure", s.structure); evidence.addProperty("structureInstance", s.instance);
            evidence.addProperty("mode", s.mode); evidence.addProperty("treasureOpened", s.opened); evidence.add("treasureProof", s.proof);
            if (!s.surveyed) return result(false, Math.min(count - 1, route.progress()), route.reason(), evidence);
        }
        boolean returned = p.getWorld().equals(s.origin.getWorld()) && p.getLocation().distanceSquared(s.origin) <= rules.returnRadius * rules.returnRadius;
        evidence.addProperty("surveyed", true); evidence.addProperty("returned", returned);
        return result(returned, returned ? count : count - 1, returned ? "ready" : "return_to_acceptance_point", evidence);
    }
    private EngineeringSites.Result unavailable(String reason, int count) {
        JsonObject j = new JsonObject(); j.addProperty("source", "server_map_hunt"); return result(false, 0, reason, j);
    }
    private EngineeringSites.Result result(boolean ready, int progress, String reason, JsonObject evidence) {
        evidence.addProperty("ready", ready); return new EngineeringSites.Result(ready, progress, reason, evidence);
    }
    @EventHandler(ignoreCancelled = true, priority = EventPriority.MONITOR)
    public void loot(LootGenerateEvent event) {
        if (event.isPlugin() || event.getLoot().isEmpty() || !(event.getEntity() instanceof Player p)
                || !(event.getInventoryHolder() instanceof BlockState block)
                || !event.getLootTable().getKey().toString().equals("minecraft:chests/buried_treasure")) return;
        State s = state(p); Location at = block.getLocation();
        if (!current(p, s) || s.opened || !s.marker.world.equals(at.getWorld().getUID())
                || Math.abs(at.getBlockX() - s.marker.x) > 2 || Math.abs(at.getBlockZ() - s.marker.z) > 2) return;
        var place = ExplorationObjectives.mapPlace(at, s.marker.x, s.marker.z);
        if (place == null || !place.key().equals("minecraft:buried_treasure")) return;
        pending.put(p.getUniqueId(), new LootProof(s.run, s.step, block(at), System.currentTimeMillis(), place, at.clone(), event.getLootTable().getKey().toString()));
        Bukkit.getScheduler().runTask(plugin, () -> opened(p));
    }
    @EventHandler(ignoreCancelled = true, priority = EventPriority.MONITOR)
    public void open(InventoryOpenEvent event) {
        if (event.getPlayer() instanceof Player p && current(p, state(p))) Bukkit.getScheduler().runTask(plugin, () -> opened(p));
    }
    @EventHandler(priority = EventPriority.MONITOR)
    public void close(InventoryCloseEvent event) {
        // A legitimate quick open/close may finish before the next tick's top-inventory check.
        // Closing this exact chest also proves that the player's inventory actually opened.
        if (event.getPlayer() instanceof Player p) opened(p, event.getInventory().getLocation());
    }
    private void opened(Player p) {
        opened(p, p.getOpenInventory().getTopInventory().getLocation());
    }
    private void opened(Player p, Location actual) {
        LootProof proof = pending.get(p.getUniqueId()); State s = state(p);
        if (!p.isOnline() || proof == null || !current(p, s) || !s.run.equals(proof.run) || s.step != proof.step
                || System.currentTimeMillis() - proof.at > 5000) { pending.remove(p.getUniqueId()); return; }
        if (actual == null || !block(actual).equals(proof.block)) return;
        s.opened = true; s.mode = "treasure"; s.instance = proof.place.instance(); s.structure = proof.place.key(); s.bounds = proof.place.bounds();
        s.proof = position(proof.location); s.proof.addProperty("source", "natural_loot_generation_and_actual_open_inventory");
        s.proof.addProperty("lootTable", proof.table); s.proof.addProperty("openedAt", System.currentTimeMillis());
        pending.remove(p.getUniqueId()); persist(p, s); exploration.flush();
        p.sendMessage("§a已记录亲自开启地图对应的天然藏宝箱。战利品归你；继续勘察周边路线，再返回接单点交付寻宝记录。");
    }
    static String hint(String reason) {
        return switch (reason) {
            case "hold_explorer_or_treasure_map", "map_has_no_target_marker" -> "请主手拿有目标标记的藏宝图或遗迹探险地图；空白地图、普通地图和改名纸不能接单。";
            case "map_multiple_target_markers" -> "这张地图有多个目标，暂不能唯一绑定；请选择单目标地图。";
            case "map_target_outside_world_border" -> "原图目标超出当前世界边界，暂不能接单；地图保留，请换图或请服主核对边界。";
            case "map_destination_already_completed" -> "你已交过这个目的地的记录；复制、改名或放大地图不能重复领奖，请换一个新目的地。";
            case "map_discovery_record_limit" -> "寻宝履历已达1024处，请联系服主；旧记录不会被自动清除。";
            case "return_to_acceptance_point" -> "目标探索已完成，请回到接单点指定范围内交回记录；查看 guild map 获取返程坐标。";
            case "find_natural_map_target_or_fresh_treasure" -> "请按地图寻找天然遗迹并深入走查，或亲自打开尚未搜过的天然藏宝箱；到坐标、放自制箱子或旧空箱不算。";
            case "map_binding_missing_or_invalid" -> "地图接单记录暂不可用，已保留原数据，请联系服主核对。";
            default -> "按 guild map 和 guild verify 的私有回执检查地图、路线、返程与缺项。";
        };
    }
    private static String environment(World world) { return switch (world.getEnvironment()) { case NETHER -> "nether"; case THE_END -> "end"; default -> "overworld"; }; }
    private static JsonObject position(Location at) {
        JsonObject j = new JsonObject(); j.addProperty("worldUuid", at.getWorld().getUID().toString()); j.addProperty("dimension", at.getWorld().getKey().toString());
        j.addProperty("x", at.getX()); j.addProperty("y", at.getY()); j.addProperty("z", at.getZ()); return j;
    }
    private static String block(Location at) { return at.getWorld().getUID() + ":" + at.getBlockX() + ":" + at.getBlockY() + ":" + at.getBlockZ(); }
    private static String digest(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
