package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.text.Normalizer;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.*;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.*;

/** Public destinations tied to the current land owner, independent of personal waypoint quotas. */
final class LandmarkManager implements Listener {
    static final String CHANNEL = "mcagent:landmark";
    private record Point(String land, UUID owner, String name, UUID world, double x, double y, double z, float yaw, float pitch) {
        Location location() { World w = Bukkit.getWorld(world); return w == null ? null : new Location(w, x, y, z, yaw, pitch); }
    }
    private record Menu(UUID viewer, boolean own, int page, String detail, Map<Integer, String> slots) { }
    private record Input(String land, long expires) { }
    private final AgentFriendPlugin plugin;
    private final Path path;
    private final Map<String, Point> points = new LinkedHashMap<>();
    private final Map<Inventory, Menu> menus = new IdentityHashMap<>();
    private final Map<UUID, Input> inputs = new ConcurrentHashMap<>();
    private boolean ready = true;

    LandmarkManager(AgentFriendPlugin plugin) {
        this.plugin = plugin; path = plugin.getDataFolder().toPath().resolve("landmarks.yml"); load();
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }
    private boolean live(Point point) { return point != null && plugin.lands().landmarkActive(point.land, point.owner, point.location()); }
    List<String> targets() { return points.values().stream().filter(this::live).map(p -> "landmark:" + p.land).sorted().toList(); }
    private void load() {
        if (!Files.exists(path)) return;
        try {
            YamlConfiguration yaml = new YamlConfiguration(); yaml.load(path.toFile());
            ConfigurationSection all = yaml.getConfigurationSection("landmarks");
            if (yaml.getInt("schema-version") != 1 || all == null || all.getKeys(false).size() > 128) throw new IllegalArgumentException("schema/landmarks");
            for (String id : all.getKeys(false)) {
                ConfigurationSection row = all.getConfigurationSection(id);
                if (!id.matches("[a-z0-9][a-z0-9_-]{0,39}") || row == null) throw new IllegalArgumentException("land ID");
                Point point = new Point(id, UUID.fromString(row.getString("owner", "")), row.getString("name", ""),
                        UUID.fromString(row.getString("world", "")), row.getDouble("x", Double.NaN), row.getDouble("y", Double.NaN),
                        row.getDouble("z", Double.NaN), (float)row.getDouble("yaw"), (float)row.getDouble("pitch"));
                if (!validName(point.name) || !Double.isFinite(point.x) || !Double.isFinite(point.y) || !Double.isFinite(point.z)
                        || !Float.isFinite(point.yaw) || !Float.isFinite(point.pitch) || Math.abs(point.x) > 30_000_000
                        || Math.abs(point.z) > 30_000_000 || Math.abs(point.y) > 4096) throw new IllegalArgumentException("landmark values");
                points.put(id, point);
            }
        } catch (Exception error) { ready = false; points.clear(); plugin.getLogger().severe("Landmarks unavailable; original file preserved: " + error); }
    }
    private boolean store(Player player, Map<String, Point> next, String action) {
        try {
            YamlConfiguration yaml = new YamlConfiguration(); yaml.set("schema-version", 1); yaml.createSection("landmarks");
            for (Point point : next.values()) {
                String b = "landmarks." + point.land + ".";
                yaml.set(b + "owner", point.owner.toString()); yaml.set(b + "name", point.name); yaml.set(b + "world", point.world.toString());
                yaml.set(b + "x", point.x); yaml.set(b + "y", point.y); yaml.set(b + "z", point.z); yaml.set(b + "yaw", point.yaw); yaml.set(b + "pitch", point.pitch);
            }
            Path tmp = path.resolveSibling("landmarks.yml.tmp"); Files.writeString(tmp, yaml.saveToString(), StandardCharsets.UTF_8);
            try { Files.move(tmp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
            catch (AtomicMoveNotSupportedException unsupported) { Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING); }
            points.clear(); points.putAll(next); return true;
        } catch (Exception error) { plugin.getLogger().severe("Landmark write refused: " + error); result(player, action, false, "save_failed", ""); return false; }
    }
    private static boolean validName(String name) { return name.matches("[\\p{L}\\p{N}_-]{1,24}"); }
    void command(Player player, String[] args) {
        String action = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "list";
        if (!ready) { result(player, action, false, "data_unavailable", ""); return; }
        if (action.equals("cancel")) { cancelInput(player); result(player, action, true, "ok", ""); return; }
        if (action.equals("menu")) { open(player, false, 1); return; }
        if (action.equals("list") || action.equals("mine")) {
            int page = 1;
            try { if (args.length > 3) throw new IllegalArgumentException(); if (args.length == 3) page = Integer.parseInt(args[2]); }
            catch (Exception invalid) { usage(player); return; }
            list(player, action.equals("mine"), page); return;
        }
        if (args.length < 3 || args.length > 4) { usage(player); return; }
        String id = args[2];
        if (action.equals("info") && args.length == 3) {
            JsonObject info = plugin.lands().landmarkInfo(id);
            if (info == null) { result(player, action, false, "land_unavailable", id); return; }
            machine(player, "MC_LANDMARK_INFO", info);
            result(player, action, true, live(points.get(id)) ? "published" : "unpublished", id); return;
        }
        String reason = plugin.lands().landmarkOwnerDenial(player, id);
        if (reason == null && (player.isDead() || player.getGameMode() != GameMode.SURVIVAL)) reason = "survival_required";
        if (reason != null) { result(player, action, false, reason, id); return; }
        if (action.equals("unpublish") && args.length == 3) {
            Map<String, Point> next = new LinkedHashMap<>(points); next.remove(id);
            if (store(player, next, action)) result(player, action, true, "ok", id);
            return;
        }
        Point old = points.get(id);
        if (!(action.equals("publish") && args.length == 4 || action.equals("update") && args.length == 3 && old != null)) { usage(player); return; }
        String name = Normalizer.normalize(action.equals("publish") ? args[3].trim() : old.name, Normalizer.Form.NFKC);
        if (!validName(name)) { result(player, action, false, "invalid_name", id); return; }
        Location at = player.getLocation(); at.setX(at.getBlockX() + .5); at.setY(at.getBlockY()); at.setZ(at.getBlockZ() + .5);
        reason = plugin.waypoints().recordingDenial(player, at);
        if (reason == null && !plugin.lands().landmarkActive(id, player.getUniqueId(), at)) reason = "outside_land";
        if (reason != null) { result(player, action, false, reason, id); return; }
        if (!points.containsKey(id) && points.size() >= 128) { result(player, action, false, "limit_reached", id); return; }
        Point saved = new Point(id, player.getUniqueId(), name, at.getWorld().getUID(), at.getX(), at.getY(), at.getZ(), at.getYaw(), at.getPitch());
        Map<String, Point> next = new LinkedHashMap<>(points); next.put(id, saved);
        if (store(player, next, action)) { result(player, action, true, "ok", id); machine(player, "MC_LANDMARK_ITEM", json(saved)); }
    }
    void travel(Player player, String id) {
        Point point = points.get(id);
        if (!ready || !live(point)) { result(player, "teleport", false, ready ? "landmark_unavailable" : "data_unavailable", id); return; }
        plugin.waypoints().travel(player, "landmark:" + id, point.name, point.location(),
                () -> point.equals(points.get(id)) && live(point),
                outcome -> result(player, "teleport", outcome.success(), outcome.reason(), id));
    }
    private JsonObject json(Point point) {
        JsonObject json = new JsonObject(); json.addProperty("id", point.land); json.addProperty("name", point.name);
        json.addProperty("ownerUuid", point.owner.toString()); json.addProperty("owner", plugin.lands().ownerName(point.owner));
        World world = Bukkit.getWorld(point.world); json.addProperty("world", world == null ? point.world.toString() : world.getKey().toString());
        json.addProperty("x", point.x); json.addProperty("y", point.y); json.addProperty("z", point.z);
        json.addProperty("target", "landmark:" + point.land); json.addProperty("published", live(point)); return json;
    }
    private void list(Player player, boolean own, int page) {
        List<String> ids = own ? plugin.lands().landmarkLands(player) : points.values().stream().filter(this::live).map(p -> p.land).sorted().toList();
        int pages = Math.max(1, (ids.size() + 8) / 9);
        if (page < 1 || page > pages) { result(player, "list", false, "invalid_page", ""); return; }
        JsonObject header = new JsonObject(); header.addProperty("scope", own ? "own" : "public"); header.addProperty("total", ids.size());
        header.addProperty("page", page); header.addProperty("pages", pages); machine(player, "MC_LANDMARK_LIST", header);
        for (String id : ids.subList((page - 1) * 9, Math.min(page * 9, ids.size()))) {
            Point point = points.get(id);
            if (live(point)) machine(player, "MC_LANDMARK_ITEM", json(point));
            else { JsonObject row = new JsonObject(); row.addProperty("id", id); row.addProperty("published", false); machine(player, "MC_LANDMARK_ITEM", row); }
        }
        player.sendMessage("§6" + (own ? "我管理的地标建筑" : "公共地标") + "：" + ids.size() + " 处；罗盘可查看和传送，每次 6 魔力。");
    }
    private void machine(Player player, String type, JsonObject data) {
        JsonObject full = data.deepCopy(); full.addProperty("schemaVersion", 1); full.addProperty("type", type);
        plugin.protectionAdvisor().send(player, full, CHANNEL);
        JsonObject chat = data.deepCopy();
        if (type.equals("MC_LANDMARK_INFO")) { chat = new JsonObject(); for (String field : List.of("id", "title", "owner", "ownerUuid", "builderUuid", "projectTask", "landmarkEnabled")) if (data.has(field)) chat.add(field, data.get(field)); }
        if (chat.toString().length() > 360) { chat.remove("owner"); chat.remove("title"); }
        player.sendMessage(type + " " + chat);
    }
    private void result(Player player, String action, boolean success, String reason, String id) {
        JsonObject data = new JsonObject(); data.addProperty("action", action); data.addProperty("status", reason.equals("loading") ? "pending" : success ? "success" : "denied");
        data.addProperty("reason", reason); data.addProperty("id", id); data.addProperty("manaCost", action.equals("teleport") ? 6 : 0);
        data.addProperty("spentMana", success && action.equals("teleport") ? 6 : 0);
        ActionFeedback.Advice advice = !success && !reason.equals("loading") ? ActionFeedback.advice("landmark", reason, id) : null;
        if (advice != null) advice.add(data);
        machine(player, "MC_LANDMARK_RESULT", data);
        String hint = switch (reason) {
            case "ok" -> action.equals("teleport") ? "已到达公共地标。" : action.equals("unpublish") ? "已撤回公共传送，建筑管理权保留。" : "公共地标已登记：/mycli goto landmark:" + id + "；每次 6 魔力。";
            case "published" -> "此地标已公开，管理者及建造履历见领地信息。";
            case "unpublished" -> "尚未公开安全落点，主人可站进建筑后登记。";
            case "loading" -> "正在准备传送，请留在原地；成功才消耗 6 魔力。";
            case "not_land_owner" -> "只有当前领地主人能管理地标；受信任玩家和 OP 也不能代替主人登记。";
            case "outside_land" -> "请亲自站在这座建筑的领地内，脚下地板与头顶也须在范围内。";
            case "landmark_not_enabled" -> "这块领地尚未获准登记公共地标，请联系女神检查委托/领地配置。";
            case "invalid_name" -> "名字需为 1–24 个中文字、字母、数字、_、-。";
            case "not_enough_mana" -> "魔力不足，需要 6 魔力。";
            case "survival_required", "spectator_or_dead" -> "请使用存活的生存角色；观战者不能登记或施放。";
            case "unsafe_landing", "unsafe_height", "not_standing" -> "落点不安全，请站在完整平地，留出两格净空；传送不会挖开方块。";
            case "landmark_unavailable", "land_unavailable", "point_changed" -> "地标未公开、已撤回或领地权限已改变，请重新查询。";
            case "save_failed", "data_unavailable" -> "地标数据暂不可用，原记录保留，请联系服主。";
            case "cancelled" -> "已取消登记。";
            default -> "操作未完成（" + reason + "），未消耗魔力；/mycli landmark menu 查看地标。";
        };
        player.sendMessage((success ? "§a" : "§e") + hint);
        if (advice != null) player.sendMessage("§a【正确做法】" + advice.next());
    }
    private void usage(Player p) { p.sendMessage("/mycli landmark list|mine [页码]|menu|info <领地ID>|publish <领地ID> <名字>|update <领地ID>|unpublish <领地ID>|cancel"); }
    private ItemStack icon(Material material, String name, String... lore) {
        ItemStack item = new ItemStack(material); var meta = item.getItemMeta(); meta.setDisplayName(name); meta.setLore(List.of(lore)); item.setItemMeta(meta); return item;
    }
    void open(Player player, boolean own, int page) {
        if (!ready) { result(player, "menu", false, "data_unavailable", ""); return; }
        List<String> ids = own ? plugin.lands().landmarkLands(player) : points.values().stream().filter(this::live).map(p -> p.land).sorted().toList();
        int pages = Math.max(1, (ids.size() + 17) / 18); page = Math.max(1, Math.min(pages, page));
        Inventory inv = Bukkit.createInventory(null, 27, own ? "我管理的地标建筑" : "公共地标 · 传送 6 魔力"); Map<Integer, String> slots = new HashMap<>();
        for (int i = (page - 1) * 18; i < Math.min(page * 18, ids.size()); i++) {
            String id = ids.get(i); Point point = points.get(id); JsonObject land = plugin.lands().landmarkInfo(id);
            int slot = i % 18; slots.put(slot, id);
            inv.setItem(slot, icon(Material.LODESTONE, "§b" + (live(point) ? point.name : land.get("title").getAsString()),
                    "管理者：" + land.get("owner").getAsString(), live(point) ? "点击查看并传送；6 魔力" : "主人可站进建筑后登记落点", "领地 ID：" + id));
        }
        inv.setItem(18, icon(Material.ARROW, "上一页")); inv.setItem(26, icon(Material.ARROW, "下一页"));
        inv.setItem(22, icon(Material.GRASS_BLOCK, own ? "§b公共地标" : "§a管理我的地标", "切换列表；登记免费"));
        inv.setItem(23, icon(Material.COMPASS, "返回公共地点"));
        menus.put(inv, new Menu(player.getUniqueId(), own, page, null, Map.copyOf(slots))); player.openInventory(inv);
    }
    private void detail(Player p, String id) {
        JsonObject land = plugin.lands().landmarkInfo(id); if (land == null) { result(p, "menu", false, "land_unavailable", id); return; }
        Point point = points.get(id); boolean owner = plugin.lands().landmarkOwnerDenial(p, id) == null;
        Inventory inv = Bukkit.createInventory(null, 27, "地标 · " + land.get("title").getAsString());
        inv.setItem(4, icon(Material.MAP, land.get("title").getAsString(), "管理者：" + land.get("owner").getAsString(), "领地 ID：" + id));
        if (live(point)) inv.setItem(13, icon(Material.ENDER_PEARL, "§d传送到「" + point.name + "」", "成功消耗 6 魔力；到访不会获得建造或储物权限"));
        if (owner) { inv.setItem(10, icon(Material.NAME_TAG, "§a登记或更新公共落点", "先站在建筑内安全平地，再点击输入地标名", "输入不进公屏；登记免费")); if (live(point)) inv.setItem(15, icon(Material.BARRIER, "§e撤回公共传送", "保留建筑及管理权")); }
        inv.setItem(22, icon(Material.ARROW, "返回地标列表"));
        menus.put(inv, new Menu(p.getUniqueId(), owner, 1, id, Map.of())); p.openInventory(inv);
    }
    private void prompt(Player p, String id) {
        if (plugin.lands().landmarkOwnerDenial(p, id) != null) { result(p, "publish", false, "not_land_owner", id); return; }
        plugin.waypoints().cancelInput(p); p.closeInventory(); Input input = new Input(id, System.currentTimeMillis() + 60_000); inputs.put(p.getUniqueId(), input);
        p.sendMessage("§b请输入公共地标名字，支持 1–24 位中文/字母/数字/_/-，输入 取消 退出；60 秒内有效，不进入公屏。提交时须站在此建筑内安全平地。");
        Bukkit.getScheduler().runTaskLater(plugin, () -> { if (inputs.remove(p.getUniqueId(), input) && p.isOnline()) result(p, "publish", false, "cancelled", id); }, 1200L);
    }
    void cancelInput(Player p) { inputs.remove(p.getUniqueId()); }
    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true) public void chat(AsyncChatEvent event) {
        Input input = inputs.remove(event.getPlayer().getUniqueId()); if (input == null) return;
        event.setCancelled(true); String text = PlainTextComponentSerializer.plainText().serialize(event.message());
        Bukkit.getScheduler().runTask(plugin, () -> { Player p = event.getPlayer(); if (!p.isOnline()) return;
            if (System.currentTimeMillis() > input.expires || text.equals("取消") || text.equalsIgnoreCase("cancel")) result(p, "publish", false, "cancelled", input.land);
            else command(p, new String[]{"landmark", "publish", input.land, text}); });
    }
    @EventHandler public void click(InventoryClickEvent event) {
        Menu menu = menus.get(event.getView().getTopInventory()); if (menu == null) return;
        event.setCancelled(true); if (!(event.getWhoClicked() instanceof Player p) || !p.getUniqueId().equals(menu.viewer) || event.getClick().isShiftClick()) return;
        int slot = event.getRawSlot(); if (slot < 0 || slot >= 27) return;
        if (menu.detail == null && !menu.slots.containsKey(slot) && !List.of(18,22,23,26).contains(slot)
                || menu.detail != null && !List.of(10,13,15,22).contains(slot)) return;
        menus.remove(event.getView().getTopInventory()); p.closeInventory();
        Bukkit.getScheduler().runTask(plugin, () -> { if (!p.isOnline()) return;
            if (menu.detail != null) {
                if (slot == 22) open(p, menu.own, 1);
                else if (slot == 13) travel(p, menu.detail);
                else if (slot == 10) prompt(p, menu.detail);
                else if (slot == 15) { command(p, new String[]{"landmark", "unpublish", menu.detail}); detail(p, menu.detail); }
            } else if (menu.slots.containsKey(slot)) detail(p, menu.slots.get(slot));
            else if (slot == 22) open(p, !menu.own, 1);
            else if (slot == 23) plugin.openPlacesMenu(p);
            else open(p, menu.own, menu.page + (slot == 18 ? -1 : 1)); });
    }
    @EventHandler public void drag(InventoryDragEvent event) { if (menus.containsKey(event.getView().getTopInventory())) event.setCancelled(true); }
    @EventHandler public void close(InventoryCloseEvent event) { menus.remove(event.getInventory()); }
    @EventHandler public void quit(PlayerQuitEvent event) { cancelInput(event.getPlayer()); }
    void shutdown() { inputs.clear(); menus.clear(); Bukkit.getMessenger().unregisterOutgoingPluginChannel(plugin, CHANNEL); }
}
