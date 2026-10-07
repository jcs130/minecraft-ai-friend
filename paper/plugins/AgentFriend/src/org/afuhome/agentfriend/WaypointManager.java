package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.bukkit.WorldGuardPlugin;
import com.sk89q.worldguard.protection.flags.Flags;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.Chunk;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

/** Named, owner-scoped exploration bookmarks. Sharing grants travel, never edit rights. */
final class WaypointManager implements Listener {
    private static final int PAGE_SIZE = 36;
    private record Point(UUID id, UUID owner, String ownerName, String name, UUID world,
                         String dimension, double x, double y, double z, float yaw, float pitch,
                         String share) {
        Location location() {
            World loaded = Bukkit.getWorld(world);
            return loaded == null ? null : new Location(loaded, x, y, z, yaw, pitch);
        }
        Point named(String value) { return new Point(id, owner, ownerName, value, world, dimension, x, y, z, yaw, pitch, share); }
        Point shared(String value) { return new Point(id, owner, ownerName, name, world, dimension, x, y, z, yaw, pitch, value); }
    }
    private record Menu(UUID viewer, String kind, int page, UUID point, Map<Integer, UUID> slots) { }
    private record Input(String action, UUID point, long expires) { }
    private final AgentFriendPlugin plugin;
    private final Path path;
    private final Map<UUID, Point> points = new LinkedHashMap<>();
    private final Map<Inventory, Menu> menus = new HashMap<>();
    private final Map<UUID, Input> inputs = new ConcurrentHashMap<>();
    private final Map<UUID, UUID> requests = new HashMap<>();
    private boolean available = true;

    WaypointManager(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        path = plugin.getDataFolder().toPath().resolve("waypoints.yml");
        load();
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }
    private static String name(String raw) { return Normalizer.normalize(raw.trim(), Normalizer.Form.NFKC); }
    private static boolean valid(String value) { return value.matches("[\\p{L}\\p{N}_-]{1,24}"); }
    private Point own(Player p, String raw) {
        String wanted = name(raw);
        return points.values().stream().filter(v -> v.owner.equals(p.getUniqueId()) && v.name.equalsIgnoreCase(wanted)).findFirst().orElse(null);
    }
    private List<Point> own(Player p) {
        return points.values().stream().filter(v -> v.owner.equals(p.getUniqueId())).sorted(Comparator.comparing(v -> v.name)).toList();
    }
    boolean contains(Player p, String value) { return own(p, value) != null; }
    List<String> names(Player p) { return own(p).stream().map(v -> v.name).toList(); }
    private int limit() { return Math.max(1, Math.min(256, plugin.getConfig().getInt("waypoints.max-per-player", 32))); }

    private void load() {
        if (!Files.exists(path)) return;
        try {
            YamlConfiguration yaml = new YamlConfiguration();
            yaml.load(path.toFile());
            if (yaml.getInt("schema-version") != 1) throw new IOException("Unsupported waypoint schema");
            ConfigurationSection all = yaml.getConfigurationSection("points");
            if (all == null) throw new IOException("Missing points section");
            for (String key : all.getKeys(false)) {
                ConfigurationSection s = all.getConfigurationSection(key);
                if (s == null) throw new IOException("Invalid waypoint entry");
                Point point = new Point(UUID.fromString(key), UUID.fromString(s.getString("owner", "")),
                        s.getString("owner-name", ""), s.getString("name", ""), UUID.fromString(s.getString("world", "")),
                        s.getString("dimension", ""), s.getDouble("x", Double.NaN), s.getDouble("y", Double.NaN),
                        s.getDouble("z", Double.NaN), (float) s.getDouble("yaw"), (float) s.getDouble("pitch"), s.getString("share", ""));
                if (!valid(point.name) || !Double.isFinite(point.x) || !Double.isFinite(point.y) || !Double.isFinite(point.z)
                        || !Float.isFinite(point.yaw) || !Float.isFinite(point.pitch) || Math.abs(point.x) > 30_000_000
                        || Math.abs(point.z) > 30_000_000 || Math.abs(point.y) > 4096 || !point.share.matches("[a-f0-9]{12}|"))
                    throw new IOException("Invalid waypoint values: " + key);
                if (points.values().stream().anyMatch(v -> v.owner.equals(point.owner) && v.name.equalsIgnoreCase(point.name)
                        || !point.share.isEmpty() && v.share.equals(point.share))) throw new IOException("Duplicate waypoint name/share");
                points.put(point.id, point);
            }
        } catch (Exception error) {
            available = false;
            points.clear();
            plugin.getLogger().severe("Waypoints unavailable; original file preserved: " + error);
        }
    }
    private boolean store(Player p, Map<UUID, Point> next, String action) {
        try {
            YamlConfiguration yaml = new YamlConfiguration();
            yaml.set("schema-version", 1);
            yaml.createSection("points");
            for (Point v : next.values()) {
                String base = "points." + v.id + ".";
                yaml.set(base + "owner", v.owner.toString()); yaml.set(base + "owner-name", v.ownerName);
                yaml.set(base + "name", v.name); yaml.set(base + "world", v.world.toString());
                yaml.set(base + "dimension", v.dimension); yaml.set(base + "x", v.x); yaml.set(base + "y", v.y);
                yaml.set(base + "z", v.z); yaml.set(base + "yaw", v.yaw); yaml.set(base + "pitch", v.pitch);
                yaml.set(base + "share", v.share);
            }
            Path tmp = path.resolveSibling("waypoints.yml.tmp");
            Files.writeString(tmp, yaml.saveToString(), StandardCharsets.UTF_8);
            try { Files.move(tmp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
            catch (AtomicMoveNotSupportedException unsupported) { Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING); }
            points.clear(); points.putAll(next);
            return true;
        } catch (IOException error) {
            plugin.getLogger().severe("Waypoint write failed; active data retained: " + error);
            result(p, action, false, "save_failed", null); return false;
        }
    }
    private boolean ready(Player p, String action) {
        if (!available) { result(p, action, false, "data_unavailable", null); return false; }
        return true;
    }
    void command(Player p, String[] args) {
        String action = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "list";
        if (!ready(p, action)) return;
        if (action.equals("cancel")) { inputs.remove(p.getUniqueId()); result(p, action, true, "ok", null); return; }
        if (action.equals("menu")) { open(p, "own", 1); return; }
        if (action.equals("list") || action.equals("shared")) {
            int page = 1;
            if (args.length > 3) { usage(p); return; }
            if (args.length == 3) try { page = Integer.parseInt(args[2]); } catch (NumberFormatException invalid) { usage(p); return; }
            list(p, action.equals("shared"), page); return;
        }
        if (args.length < 3 || args.length > 4) { usage(p); return; }
        String value = name(args[2]);
        if (!valid(value)) { result(p, action, false, "invalid_name", null); return; }
        Point current = own(p, value);
        if (action.equals("add") || action.equals("update")) {
            if (args.length != 3) { usage(p); return; }
            if (action.equals("add") && (current != null || plugin.personalHome(p, value) != null)) {
                result(p, action, false, "name_exists", current); return;
            }
            if (action.equals("update") && current == null) { result(p, action, false, "not_found", null); return; }
            if (current == null && own(p).size() >= limit()) { result(p, action, false, "limit_reached", null); return; }
            String denied = actor(p);
            Location at = p.getLocation();
            at.setX(at.getBlockX() + .5); at.setY(at.getBlockY()); at.setZ(at.getBlockZ() + .5);
            if (denied == null) denied = safe(p, at);
            if (denied != null) { result(p, action, false, denied, null); return; }
            Point saved = new Point(current == null ? UUID.randomUUID() : current.id, p.getUniqueId(), p.getName(), value,
                    at.getWorld().getUID(), at.getWorld().getKey().toString(), at.getX(), at.getY(), at.getZ(), at.getYaw(), at.getPitch(),
                    current == null ? "" : current.share);
            Map<UUID, Point> next = new LinkedHashMap<>(points); next.put(saved.id, saved);
            if (store(p, next, action)) { result(p, action, true, "ok", saved); legacyLine(p, saved); }
            return;
        }
        if (current == null) {
            if (action.equals("remove") && args.length == 3 && plugin.personalHome(p, value) != null) {
                p.performCommand("delhome " + value); return;
            }
            result(p, action, false, "not_found", null); return;
        }
        Point changed = current;
        if (action.equals("rename") && args.length == 4) {
            String renamed = name(args[3]);
            if (!valid(renamed)) { result(p, action, false, "invalid_name", current); return; }
            Point other = own(p, renamed);
            if (other != null && !other.id.equals(current.id) || plugin.personalHome(p, renamed) != null) {
                result(p, action, false, "name_exists", current); return;
            }
            changed = current.named(renamed);
        } else if (action.equals("share") && args.length == 3) {
            if (current.share.isEmpty()) {
                String code;
                do { code = UUID.randomUUID().toString().replace("-", "").substring(0, 12); }
                while (shared(code) != null);
                changed = current.shared(code);
            }
        } else if (action.equals("unshare") && args.length == 3) changed = current.shared("");
        else if (!(action.equals("remove") && args.length == 3)) { usage(p); return; }
        Map<UUID, Point> next = new LinkedHashMap<>(points);
        if (action.equals("remove")) next.remove(current.id); else next.put(current.id, changed);
        if (store(p, next, action)) result(p, action, true, "ok", changed);
    }
    private void usage(Player p) {
        p.sendMessage("/mycli waypoint add|update|remove|share|unshare <名字>；rename <旧名> <新名>；list|shared [页码]；menu");
        p.sendMessage("名字支持 1–24 个中文字、字母、数字、_、-。记录坐标免费；每次传送 6 魔力。");
        result(p, "usage", false, "invalid_argument", null);
    }
    private Point shared(String code) { return points.values().stream().filter(v -> !v.share.isEmpty() && v.share.equals(code)).findFirst().orElse(null); }
    void listOwn(Player p) { if (available) for (Point v : own(p)) legacyLine(p, v); }
    private void legacyLine(Player p, Point v) {
        Location at = v.location();
        if (at != null) p.sendMessage("MC_WAYPOINT id=personal:" + v.name + " " + LocationOutput.fields(at));
    }
    private void list(Player p, boolean shared, int page) {
        List<Point> all = shared ? points.values().stream().filter(v -> !v.share.isEmpty())
                .sorted(Comparator.comparing((Point v) -> v.ownerName).thenComparing(v -> v.name)).toList() : own(p);
        int pages = Math.max(1, (all.size() + PAGE_SIZE - 1) / PAGE_SIZE);
        if (page < 1 || page > pages) { result(p, "list", false, "invalid_page", null); return; }
        JsonObject json = new JsonObject(); json.addProperty("schemaVersion", 1); json.addProperty("scope", shared ? "shared" : "own");
        json.addProperty("page", page); json.addProperty("pages", pages); json.addProperty("total", all.size()); json.addProperty("limit", limit());
        JsonArray entries = new JsonArray();
        for (Point v : all.subList((page - 1) * PAGE_SIZE, Math.min(page * PAGE_SIZE, all.size()))) {
            entries.add(json(v, shared));
            p.sendMessage(ChatColor.AQUA + v.name + " · " + label(v) + (shared ? " · " + v.ownerName : "")
                    + " → /mycli goto " + (shared ? "shared:" + v.share : "personal:" + v.name));
        }
        json.add("points", entries); p.sendMessage("MC_WAYPOINT_LIST " + json);
    }
    private String actor(Player p) {
        if (p.isDead() || p.getGameMode() == GameMode.SPECTATOR) return "spectator_or_dead";
        if (plugin.namedTravelBlocked(p) || plugin.dungeon().deniesEdit(p.getLocation())
                || plugin.namedTravelActivityArea(p.getLocation())) return "in_activity";
        if (p.isInsideVehicle() || p.isGliding() || p.isFlying()) return "not_standing";
        return null;
    }
    private static boolean hazard(Material type) {
        return switch (type) {
            case LAVA, WATER, FIRE, SOUL_FIRE, MAGMA_BLOCK, CACTUS, CAMPFIRE, SOUL_CAMPFIRE,
                    SWEET_BERRY_BUSH, WITHER_ROSE, POWDER_SNOW, NETHER_PORTAL, END_PORTAL, END_GATEWAY -> true;
            default -> false;
        };
    }
    private String safe(Player p, Location at) {
        World w = at.getWorld();
        if (w == null) return "world_unavailable";
        int x = at.getBlockX(), y = at.getBlockY(), z = at.getBlockZ();
        if (y <= w.getMinHeight() || y + 2 >= w.getMaxHeight()
                || w.getEnvironment() == World.Environment.NETHER && y >= w.getLogicalHeight()) return "unsafe_height";
        if (!w.getWorldBorder().isInside(at.clone().add(.3, 0, .3)) || !w.getWorldBorder().isInside(at.clone().add(-.3, 0, -.3))) return "world_border";
        if (!w.isChunkLoaded(x >> 4, z >> 4)) return "chunk_unavailable";
        if (plugin.dungeon().deniesEdit(at) || plugin.namedTravelActivityArea(at)) return "activity_area";
        Block floor = w.getBlockAt(x, y - 1, z), feet = w.getBlockAt(x, y, z), head = w.getBlockAt(x, y + 1, z);
        if (hazard(floor.getType()) || hazard(feet.getType()) || hazard(head.getType()) || !feet.isPassable() || !head.isPassable()) return "unsafe_landing";
        var box = floor.getBoundingBox();
        if (!floor.getType().isSolid() || box.getMinX() > x || box.getMaxX() < x + 1
                || box.getMinZ() > z || box.getMaxZ() < z + 1 || box.getMaxY() < y) return "unsafe_landing";
        for (int[] d : new int[][]{{1,0},{-1,0},{0,1},{0,-1}}) {
            int xx = x + d[0], zz = z + d[1];
            if (!w.isChunkLoaded(xx >> 4, zz >> 4)) return "chunk_unavailable";
            if (hazard(w.getBlockAt(xx, y, zz).getType())) return "unsafe_landing";
        }
        try {
            var query = WorldGuard.getInstance().getPlatform().getRegionContainer().createQuery();
            if (!query.testState(BukkitAdapter.adapt(at), WorldGuardPlugin.inst().wrapPlayer(p), Flags.ENTRY)) return "protected_entry";
        } catch (RuntimeException | LinkageError missing) { return "protection_unavailable"; }
        return null;
    }
    boolean gotoPoint(Player p, String raw) {
        boolean publicShare = raw.toLowerCase(Locale.ROOT).startsWith("shared:");
        String value = raw.substring(raw.indexOf(':') + 1);
        Point point = publicShare ? shared(value.toLowerCase(Locale.ROOT)) : own(p, value);
        // Only a real legacy home can fall through to Essentials.
        if (!publicShare && point == null && value.matches("[A-Za-z0-9_-]{1,24}") && plugin.personalHome(p, value) != null) return false;
        if (!ready(p, "teleport")) return true;
        if (point == null) { result(p, "teleport", false, publicShare ? "share_unavailable" : "not_found", null); return true; }
        String denied = actor(p);
        if (denied != null) { result(p, "teleport", false, denied, point); return true; }
        if (requests.containsKey(p.getUniqueId())) { result(p, "teleport", false, "busy", point); return true; }
        Location at = point.location();
        if (at == null) { result(p, "teleport", false, "world_unavailable", point); return true; }
        if (!plugin.hasMana(p, TravelMagic.LOCAL_MANA)) { result(p, "teleport", false, "not_enough_mana", point); return true; }
        Location origin = p.getLocation().clone();
        UUID request = UUID.randomUUID(), player = p.getUniqueId(); requests.put(player, request);
        result(p, "teleport", false, "loading", point);
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (requests.remove(player, request)) { Player online = Bukkit.getPlayer(player); if (online != null) result(online, "teleport", false, "timeout", point); }
        }, 200L);
        try { at.getWorld().getChunkAtAsync(at.getBlockX() >> 4, at.getBlockZ() >> 4, false).whenComplete((chunk, error) -> {
            if (!plugin.isEnabled()) return;
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!requests.remove(player, request)) return;
                Player online = Bukkit.getPlayer(player);
                if (online == null) return;
                boolean ticket = chunk != null && chunk.addPluginChunkTicket(plugin);
                try {
                    Point latest = points.get(point.id);
                    String reason = actor(online);
                    if (reason == null && (latest == null || !latest.equals(point))) reason = "point_changed";
                    if (reason == null && (online.getWorld() != origin.getWorld() || online.getLocation().distanceSquared(origin) > 4)) reason = "moved";
                    if (reason == null && (error != null || chunk == null)) reason = "chunk_unavailable";
                    Location landing = null;
                    if (reason == null) {
                        // Recheck the recorded location only; never redirect through walls into somebody else's room.
                        reason = safe(online, at);
                        if (reason == null) landing = at;
                    }
                    if (reason == null) try {
                        var query = WorldGuard.getInstance().getPlatform().getRegionContainer().createQuery();
                        if (!query.testState(BukkitAdapter.adapt(online.getLocation()), WorldGuardPlugin.inst().wrapPlayer(online), Flags.EXIT)) reason = "protected_exit";
                    } catch (RuntimeException | LinkageError unavailable) { reason = "protection_unavailable"; }
                    if (reason != null) { result(online, "teleport", false, reason, point); return; }
                    online.sendMessage("MC_DESTINATION id=" + raw + " " + LocationOutput.fields(landing));
                    boolean moved = plugin.travelMagic().teleport(online, landing, raw, "传送点术·" + point.name, TravelMagic.LOCAL_MANA);
                    result(online, "teleport", moved, moved ? "ok" : "teleport_rejected", point);
                    plugin.refreshAgentState(online);
                } finally { if (ticket) chunk.removePluginChunkTicket(plugin); }
            });
        }); } catch (RuntimeException error) {
            requests.remove(player, request);
            result(p, "teleport", false, "chunk_unavailable", point);
            plugin.getLogger().warning("Waypoint chunk request failed: " + error);
        }
        return true;
    }
    private JsonObject json(Point v, boolean shared) {
        JsonObject j = new JsonObject(); j.addProperty("id", v.id.toString()); j.addProperty("name", v.name);
        j.addProperty("owner", v.owner.toString()); j.addProperty("ownerName", v.ownerName);
        j.addProperty("dimension", v.dimension); j.addProperty("world", v.world.toString());
        j.addProperty("x", v.x); j.addProperty("y", v.y); j.addProperty("z", v.z);
        j.addProperty("shared", !v.share.isEmpty()); j.addProperty("available", v.location() != null);
        j.addProperty("target", shared && !v.share.isEmpty() ? "shared:" + v.share : "personal:" + v.name);
        if (!v.share.isEmpty()) j.addProperty("shareCode", v.share);
        return j;
    }
    private void result(Player p, String action, boolean success, String reason, Point v) {
        JsonObject j = new JsonObject(); j.addProperty("schemaVersion", 1); j.addProperty("action", action);
        j.addProperty("success", success); j.addProperty("reason", reason); j.addProperty("manaCost", action.equals("teleport") ? 6 : 0);
        j.addProperty("status", reason.equals("loading") ? "pending" : success ? "success" : "denied");
        j.addProperty("spentMana", success && action.equals("teleport") ? 6 : 0);
        if (v != null) j.add("point", json(v, action.equals("share") || action.equals("unshare")));
        p.sendMessage("MC_WAYPOINT_RESULT " + j);
        String hint = switch (reason) {
            case "ok" -> switch (action) {
                case "share" -> "已分享「" + v.name + "」；别人可用 /mycli goto shared:" + v.share + "（6 魔力）。可随时 unshare 撤回。";
                case "unshare" -> "已撤回分享，旧分享码立即失效。";
                case "remove" -> "已删除传送点。";
                case "cancel" -> "已取消命名。";
                default -> action.equals("teleport") ? "已到达「" + v.name + "」。" : "已保存「" + v.name + "」；/mycli goto personal:" + v.name + "。";
            };
            case "loading" -> "正在准备传送点，请稍候并留在原地；成功传送才消耗 6 魔力。";
            case "invalid_name" -> "名字支持 1–24 个中文字、字母、数字、_、-，不含空格。";
            case "name_exists" -> "此名字已存在；换个名字，或用 update 明确更新已有命名地点。";
            case "limit_reached" -> "个人传送点已达到 " + limit() + " 个，请先删除不用的地点。";
            case "not_found", "share_unavailable" -> "地点不存在、尚未分享或分享已撤回。旧 home 仍可用原指令管理。";
            case "spectator_or_dead" -> "旁观者或倒下的角色不能记录、使用传送点。";
            case "in_activity", "activity_area" -> "试炼或 PvP 活动区域不能记录、使用自定义传送点，请先正常离场。";
            case "not_standing" -> "请先离开载具、停止滑翔或飞行，站在安全平地。";
            case "unsafe_landing", "unsafe_height" -> "落点受阻或不安全；请站在安全平地记录，传送不会挖开方块。";
            case "world_border" -> "地点已在世界边界之外。";
            case "world_unavailable", "chunk_unavailable", "timeout" -> "目的地暂不可用，请稍后重试。";
            case "point_changed" -> "地点已被修改、删除或撤回分享，请重新查询。";
            case "protected_entry", "protected_exit", "protection_unavailable", "teleport_rejected" -> "保护规则或施法条件拒绝传送。";
            case "moved" -> "等待时已移动，传送取消。";
            case "busy" -> "已有传送正在准备中，请等待结果。";
            case "not_enough_mana" -> "魔力不足，需要 6 魔力。";
            case "save_failed", "data_unavailable" -> "传送点数据暂不可用，保存没有完成，请联系服主。";
            default -> "请按命令说明重试。";
        };
        p.sendMessage((success ? ChatColor.GREEN : ChatColor.YELLOW) + hint);
    }
    private String label(Point v) {
        World w = Bukkit.getWorld(v.world);
        return (w == null ? "世界未加载" : switch (w.getEnvironment()) { case NETHER -> "下界"; case THE_END -> "末地"; default -> "主世界"; })
                + " " + (int) v.x + "," + (int) v.y + "," + (int) v.z;
    }
    private ItemStack item(Material type, String title, String... lore) {
        ItemStack stack = new ItemStack(type); ItemMeta meta = stack.getItemMeta(); meta.setDisplayName(title); meta.setLore(List.of(lore)); stack.setItemMeta(meta); return stack;
    }
    void open(Player p, String kind, int page) {
        if (!ready(p, "menu")) return;
        List<Point> all = kind.equals("shared") ? points.values().stream().filter(v -> !v.share.isEmpty())
                .sorted(Comparator.comparing((Point v) -> v.ownerName).thenComparing(v -> v.name)).toList() : own(p);
        int pages = Math.max(1, (all.size() + PAGE_SIZE - 1) / PAGE_SIZE); page = Math.max(1, Math.min(pages, page));
        Inventory inv = Bukkit.createInventory(null, 54, kind.equals("shared") ? "§b✦ 大家的传送点" : "§d✦ 我的传送点");
        Map<Integer, UUID> slots = new HashMap<>();
        int start = (page - 1) * PAGE_SIZE;
        for (int i = start; i < Math.min(start + PAGE_SIZE, all.size()); i++) {
            Point v = all.get(i); int slot = i - start; slots.put(slot, v.id);
            inv.setItem(slot, item(Material.ENDER_EYE, "§b" + v.name, label(v), "发现者：" + v.ownerName,
                    kind.equals("shared") ? "点击查看并施放；6 魔力" : "点击传送、改名、分享或删除", v.share.isEmpty() ? "私人地点" : "已分享"));
        }
        inv.setItem(45, item(Material.NAME_TAG, "§a新建传送点", "记录当前位置，接着在聊天框输入名字", "只发给服务器，不进入公共聊天；记录免费"));
        inv.setItem(46, item(Material.MAP, kind.equals("shared") ? "§d我的地点" : "§b大家分享的地点", "切换列表"));
        inv.setItem(48, item(Material.ARROW, "§7上一页", "第 " + page + "/" + pages + " 页"));
        inv.setItem(49, item(Material.COMPASS, "§7返回公共地点", "打开传送罗盘"));
        inv.setItem(50, item(Material.ARROW, "§7下一页", "第 " + page + "/" + pages + " 页"));
        menus.put(inv, new Menu(p.getUniqueId(), kind, page, null, slots)); p.openInventory(inv);
    }
    private void detail(Player p, Point v, boolean delete) {
        Inventory inv = Bukkit.createInventory(null, 27, delete ? "§c✦ 确认删除传送点" : "§d✦ " + v.name);
        inv.setItem(4, item(Material.MAP, "§b" + v.name, label(v), "发现者：" + v.ownerName));
        boolean owner = v.owner.equals(p.getUniqueId());
        if (delete) inv.setItem(13, item(Material.BARRIER, "§c确认删除", "此地点和分享码都会删除"));
        else {
            inv.setItem(13, item(Material.ENDER_PEARL, "§d传送到这里", "消耗 6 魔力；安全检查通过才施放"));
            if (owner) {
                inv.setItem(10, item(Material.NAME_TAG, "§e修改名字", "在聊天框输入新名字"));
                inv.setItem(11, item(Material.LODESTONE, "§e更新为当前位置", "明确将落点改为你现在站立的位置"));
                inv.setItem(15, item(Material.PAPER, v.share.isEmpty() ? "§a分享此地点" : "§e撤回分享", "分享后会出现在大家的列表；其他人只能传送"));
                inv.setItem(16, item(Material.BARRIER, "§c删除地点", "点击后需要再次确认"));
            }
        }
        inv.setItem(22, item(Material.ARROW, "§7返回地点列表", "查看其他地点"));
        menus.put(inv, new Menu(p.getUniqueId(), delete ? "delete" : "detail", 1, v.id, Map.of())); p.openInventory(inv);
    }
    void beginCreate(Player p) { if (ready(p, "add")) prompt(p, "add", null); }
    private void prompt(Player p, String action, UUID point) {
        p.closeInventory(); Input input = new Input(action, point, System.currentTimeMillis() + 60_000);
        inputs.put(p.getUniqueId(), input);
        p.sendMessage(ChatColor.AQUA + "请在聊天框输入传送点名字（1–24 个中文字、字母、数字、_、-），60 秒内有效；输入 取消 可退出。此条输入不会发到公屏。新建会记录输入时站立的位置。");
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (inputs.remove(p.getUniqueId(), input) && p.isOnline()) p.sendMessage(ChatColor.YELLOW + "传送点命名已超时；之后的聊天恢复正常。请重新点击新建。");
        }, 1200L);
    }
    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onChat(AsyncChatEvent event) {
        Input input = inputs.remove(event.getPlayer().getUniqueId());
        if (input == null) return;
        event.setCancelled(true);
        String text = PlainTextComponentSerializer.plainText().serialize(event.message());
        Bukkit.getScheduler().runTask(plugin, () -> {
            Player p = event.getPlayer(); if (!p.isOnline()) return;
            if (System.currentTimeMillis() > input.expires || text.equals("取消") || text.equalsIgnoreCase("cancel")) {
                result(p, "cancel", true, "ok", null); return;
            }
            Point existing = points.get(input.point);
            if (input.action.equals("rename") && (existing == null || !existing.owner.equals(p.getUniqueId()))) { result(p, "rename", false, "not_found", null); return; }
            command(p, input.action.equals("add") ? new String[]{"waypoint", "add", text} : new String[]{"waypoint", "rename", existing.name, text});
        });
    }
    @EventHandler public void onClick(InventoryClickEvent event) {
        Menu menu = menus.get(event.getView().getTopInventory()); if (menu == null) return;
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player p) || !menu.viewer.equals(p.getUniqueId()) || event.getRawSlot() < 0 || event.getRawSlot() >= event.getView().getTopInventory().getSize()) return;
        if (event.getClick().isShiftClick()) return;
        int slot = event.getRawSlot();
        boolean action = menu.point == null ? menu.slots.containsKey(slot) || List.of(45, 46, 48, 49, 50).contains(slot)
                : slot == 22 || slot == 13 || !menu.kind.equals("delete") && List.of(10, 11, 15, 16).contains(slot);
        if (!action) return;
        menus.remove(event.getView().getTopInventory()); // Consume once before scheduling an action.
        p.closeInventory();
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (!p.isOnline()) return;
            if (menu.point == null) {
                if (slot == 45) prompt(p, "add", null);
                else if (slot == 46) open(p, menu.kind.equals("shared") ? "own" : "shared", 1);
                else if (slot == 48 || slot == 50) open(p, menu.kind, menu.page + (slot == 48 ? -1 : 1));
                else if (slot == 49) plugin.openPlacesMenu(p);
                else if (menu.slots.containsKey(slot)) {
                    Point v = points.get(menu.slots.get(slot));
                    if (v != null && (v.owner.equals(p.getUniqueId()) || !v.share.isEmpty())) detail(p, v, false);
                    else result(p, "menu", false, "share_unavailable", null);
                }
                return;
            }
            Point v = points.get(menu.point);
            if (slot == 22) { open(p, "own", 1); return; }
            if (v == null || !v.owner.equals(p.getUniqueId()) && v.share.isEmpty()) { result(p, "menu", false, "share_unavailable", null); return; }
            if (menu.kind.equals("delete")) {
                if (slot == 13 && v.owner.equals(p.getUniqueId())) { command(p, new String[]{"waypoint", "remove", v.name}); open(p, "own", 1); }
            } else if (slot == 13) {
                p.closeInventory(); gotoPoint(p, v.owner.equals(p.getUniqueId()) ? "personal:" + v.name : "shared:" + v.share);
            } else if (v.owner.equals(p.getUniqueId())) {
                if (slot == 10) prompt(p, "rename", v.id);
                else if (slot == 11) { command(p, new String[]{"waypoint", "update", v.name}); detail(p, points.get(v.id), false); }
                else if (slot == 15) { command(p, new String[]{"waypoint", v.share.isEmpty() ? "share" : "unshare", v.name}); detail(p, points.get(v.id), false); }
                else if (slot == 16) detail(p, v, true);
            }
        });
    }
    @EventHandler public void onDrag(InventoryDragEvent event) { if (menus.containsKey(event.getView().getTopInventory())) event.setCancelled(true); }
    @EventHandler public void onClose(InventoryCloseEvent event) { menus.remove(event.getInventory()); }
    @EventHandler public void onQuit(PlayerQuitEvent event) { inputs.remove(event.getPlayer().getUniqueId()); requests.remove(event.getPlayer().getUniqueId()); }
    void shutdown() { inputs.clear(); requests.clear(); menus.clear(); }
}
