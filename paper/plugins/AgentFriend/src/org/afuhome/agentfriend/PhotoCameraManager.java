package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.bukkit.*;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.*;
import org.bukkit.event.inventory.*;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.MapMeta;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.messaging.PluginMessageListener;
import org.bukkit.scheduler.BukkitTask;

/** Game-owned camera requests; the local Goddess renderer never grants player or OP authority. */
final class PhotoCameraManager implements Listener, PluginMessageListener {
    static final String CHANNEL = "mcagent:photo";
    private final AgentFriendPlugin plugin;
    private final ArrayDeque<Job> queue = new ArrayDeque<>();
    private final Map<UUID, Long> last = new HashMap<>();
    private volatile Job active;
    private long heartbeat;
    private boolean workerIdle;
    private boolean enabled;
    private int queueLimit, cooldown, timeout;
    private java.lang.reflect.Field pendingUploads;
    private BukkitTask task;
    private Class<?> imageFrame;
    private record Job(UUID id, String nonce, UUID owner, String name, String mode, UUID world, long queued) {
        private Job(Player p, String name, String mode) { this(UUID.randomUUID(), UUID.randomUUID().toString(), p.getUniqueId(), name, mode, p.getWorld().getUID(), System.currentTimeMillis()); }
    }
    private Location origin;
    private long started;
    private String phase = "idle";
    private boolean uploadSent;

    PhotoCameraManager(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        if (!new java.io.File(plugin.getDataFolder(), "photo-camera.yml").isFile()) plugin.saveResource("photo-camera.yml", false);
        var cfg = YamlConfiguration.loadConfiguration(new java.io.File(plugin.getDataFolder(), "photo-camera.yml"));
        enabled = cfg.getBoolean("enabled", true);
        queueLimit = Math.clamp(cfg.getInt("queue-limit", 16), 1, 16);
        cooldown = Math.clamp(cfg.getInt("cooldown-seconds", 60), 10, 3600);
        timeout = Math.clamp(cfg.getInt("capture-timeout-seconds", 60), 20, 90);
        Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
        Bukkit.getMessenger().registerIncomingPluginChannel(plugin, CHANNEL, this);
        try { connectImageFrame(); } catch (Exception e) { plugin.getLogger().warning("Photo camera unavailable: " + e.getClass().getSimpleName()); }
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 10L, 10L);
    }

    boolean ready() { return enabled && pendingUploads != null && System.currentTimeMillis() - heartbeat < 15_000 && plugin.goddessLandAdministrator() != null; }

    void command(Player p, String[] args) {
        String action = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "help";
        if (action.equals("menu")) { menu(p); return; }
        if (action.equals("take")) {
            String name = args.length > 2 ? args[2] : "生活_" + java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("MMdd_HHmmss"));
            String mode = args.length > 3 ? args[3].toLowerCase(Locale.ROOT) : "first";
            if (!name.matches("[\\p{L}\\p{N}_-]{1,32}") || args.length > 4 || !Set.of("first", "third", "top").contains(mode)) { deny(p, "用法：/mycli photo take <1–32字名字> [first|third|top]，分别为第一人称、第三人称、俯视；名字不带空格。"); return; }
            if (plugin.isObserver(p) || p.isDead()) { deny(p, "请用正常存活角色拍照；观察账号不能代领照片。"); return; }
            if (!ready()) { deny(p, "女神相机暂未就绪，请稍后用 /mycli photo status 查询；无需访问网页或上传公网文件。"); return; }
            if (owns(p.getUniqueId())) { deny(p, "你已有拍照请求。用 /mycli photo status 查看，或 photo cancel 取消尚未上传的请求。"); return; }
            if (queue.size() >= queueLimit) { deny(p, "拍照队列已满，请稍后再拍。"); return; }
            long wait = cooldown * 1000L - (System.currentTimeMillis() - last.getOrDefault(p.getUniqueId(), 0L));
            if (wait > 0) { deny(p, "请在 " + (wait / 1000 + 1) + " 秒后再拍。"); return; }
            try {
                if (pending(p.getUniqueId(), null) != null) { deny(p, "你还有手动上传待完成，请先完成原照片或等待原链接过期，再用女神相机。"); return; }
                if (map(p.getUniqueId(), name) != null) { deny(p, "本人已有同名照片，请换一个名字。"); return; }
            } catch (Exception e) { deny(p, "相册服务暂不可用，请稍后重试。"); return; }
            if (!materials(p)) return;
            queue.add(new Job(p, name, mode));
            notice(p, "queued", "已排队，前面 " + ((active == null ? 0 : 1) + queue.size() - 1) + " 人。轮到你时面向要拍的景物，保持静止；消耗1张空地图。");
            tick();
        } else if (action.equals("cancel")) {
            if (active != null && active.owner.equals(p.getUniqueId())) {
                if (uploadSent) { deny(p, "照片已上传，正在等待相册确认，请用 photo status 查看，勿重复创建。"); return; }
                finish(false, "已取消；若已预扣空地图，由 ImageFrame 原流程退回。");
            } else if (queue.removeIf(j -> j.owner.equals(p.getUniqueId()))) notice(p, "cancelled", "已取消排队，未消耗空地图。");
            else deny(p, "你没有待处理照片；用 /mycli photo take <名字> 拍照。");
        } else {
            String state = active != null && active.owner.equals(p.getUniqueId()) ? phase : owns(p.getUniqueId()) ? "queued" : "idle";
            notice(p, state, "相机" + (ready() ? "可用" : "暂未就绪") + "。/mycli photo take <名字> [first|third|top] 拍第一人称/第三人称/俯视；photo status 查进度；photo cancel 取消。无游戏UI，保留人物名字；准备1张空地图和空背包格，照片归本人。");
        }
    }

    private boolean owns(UUID id) { return active != null && active.owner.equals(id) || queue.stream().anyMatch(j -> j.owner.equals(id)); }
    private boolean materials(Player p) {
        if (!p.getInventory().contains(Material.MAP)) { deny(p, "需要1张空地图；先制作或取得空地图，再用 /mycli photo take <名字>。"); return false; }
        if (p.getInventory().firstEmpty() < 0) { deny(p, "请先空出至少1个主背包格，再拍照领取地图。"); return false; }
        return true;
    }

    private void tick() {
        long now = System.currentTimeMillis();
        queue.removeIf(j -> {
            if (now - j.queued <= 180_000 && Bukkit.getPlayer(j.owner) != null) return false;
            Player p = Bukkit.getPlayer(j.owner); if (p != null) notice(p, "expired", "排队已过期，未扣地图；请在相机可用后重新拍摄。"); return true;
        });
        if (active == null) {
            if (queue.isEmpty() || !ready() || !workerIdle) return;
            Player camera = plugin.goddessLandAdministrator();
            if (camera.getSpectatorTarget() != null) return; // Existing manual observer session owns the camera.
            Job next = queue.remove(); Player owner = Bukkit.getPlayer(next.owner);
            if (owner == null || !owner.isOnline() || !owner.getWorld().getUID().equals(next.world) || !materials(owner)) return;
            active = next; phase = "preparing"; started = System.currentTimeMillis(); uploadSent = false;
            origin = camera.getLocation().clone();
            last.put(owner.getUniqueId(), started);
            if (!camera.teleport(owner.getLocation())) { finish(false, "无法同步观察镜头，请稍后再拍。"); return; }
            camera.setSpectatorTarget(owner);
            notice(owner, phase, "女神正在观察你的视角，请面向景物并保持静止，通常需要数秒；自动拍照无需打开 ImageFrame 链接。");
            if (!Bukkit.dispatchCommand(owner, "imageframe:imageframe create " + next.name + " upload 1 1"))
                finish(false, "相册创建入口不可用，请联系管理员检查 ImageFrame；本次未消耗地图。");
        } else {
            try {
                Player owner = Bukkit.getPlayer(active.owner);
                if (phase.equals("preparing")) {
                    Object upload = pending(active.owner, active.name);
                    if (upload != null) capture(active, upload.getClass().getMethod("getId").invoke(upload).toString());
                    if (active == null) return;
                }
                Object created = map(active.owner, active.name);
                if (created != null && delivered(owner, created)) { finish(true, "照片「" + active.name + "」已放入本人背包；可挂到自己有使用权限的展示框。"); return; }
                Player camera = plugin.goddessLandAdministrator();
                if (owner == null || !owner.isOnline() || owner.isDead() || !owner.getWorld().getUID().equals(active.world)
                    || camera == null || camera.getSpectatorTarget() != owner) { finish(false, "角色或镜头状态已改变，停止拍照；请稳定后重新拍摄。"); return; }
                if (System.currentTimeMillis() - started > timeout * 1000L) finish(false, "拍照等待超时。先查看 /imageframe list 和背包确认是否已创建；未创建时原流程会退还空地图，勿连续重投。");
            } catch (Exception e) { finish(false, "相册确认失败，请先查看 /imageframe list，勿重复创建同一照片。"); }
        }
    }

    private void connectImageFrame() throws Exception {
        Plugin dependency = Bukkit.getPluginManager().getPlugin("ImageFrame");
        if (dependency == null || !dependency.isEnabled() || !dependency.getDescription().getVersion().equals("2026.1.5.0")) throw new IllegalStateException("unsupported ImageFrame");
        imageFrame = dependency.getClass();
        Object uploads = imageFrame.getField("imageUploadManager").get(null);
        // No public getter exists. Read the pinned concurrent registry, not chat text.
        var field = uploads.getClass().getDeclaredField("pendingUploads"); field.setAccessible(true);
        if (!(field.get(uploads) instanceof java.util.concurrent.ConcurrentMap<?, ?>)) throw new IllegalStateException("unsupported upload registry");
        pendingUploads = field;
    }
    private Object pending(UUID owner, String name) throws Exception {
        Object uploads = imageFrame.getField("imageUploadManager").get(null);
        Map<?, ?> registry = (Map<?, ?>) pendingUploads.get(uploads);
        if (registry.size() > 256) throw new IllegalStateException("upload registry budget exceeded");
        Object found = null;
        for (Object upload : registry.values()) {
            Class<?> type = upload.getClass();
            if (!owner.equals(type.getMethod("getCreator").invoke(upload))) continue;
            if ((long) type.getMethod("getExpire").invoke(upload) <= System.currentTimeMillis()) continue;
            if (((java.util.concurrent.Future<?>) type.getMethod("getFile").invoke(upload)).isDone()) continue;
            if (name != null && (!name.equals(type.getMethod("getImageMap").invoke(upload))
                || (int) type.getMethod("getWidth").invoke(upload) != 1 || (int) type.getMethod("getHeight").invoke(upload) != 1)) continue;
            if (found != null) throw new IllegalStateException("ambiguous pending upload");
            found = upload;
        }
        return found;
    }

    private void capture(Job expected, String uploadId) {
        if (active != expected || !phase.equals("preparing")) return;
        Player owner = Bukkit.getPlayer(expected.owner), camera = plugin.goddessLandAdministrator();
        if (owner == null || camera == null || camera.getSpectatorTarget() != owner) return;
        try {
            JsonObject out = envelope(expected, "capture");
            out.addProperty("owner", expected.owner.toString()); out.addProperty("entityId", owner.getEntityId());
            out.addProperty("mode", expected.mode);
            out.addProperty("uploadId", uploadId);
            out.addProperty("uploadBase", (String) imageFrame.getField("uploadServiceDisplayURL").get(null));
            out.addProperty("world", expected.world.toString());
            Location pos = owner.getLocation();
            out.addProperty("anchorX", pos.getX()); out.addProperty("anchorY", pos.getY()); out.addProperty("anchorZ", pos.getZ());
            Location eye = owner.getEyeLocation();
            double pitch = -Math.toRadians(pos.getPitch());
            if (!expected.mode.equals("first")) {
                double yaw = Math.toRadians(pos.getYaw());
                org.bukkit.util.Vector direction = expected.mode.equals("top") ? new org.bukkit.util.Vector(0, 1, 0) : new org.bukkit.util.Vector(Math.sin(yaw), 0, -Math.cos(yaw));
                double distance = expected.mode.equals("top") ? 20 : 4;
                var obstruction = owner.getWorld().rayTraceBlocks(eye, direction, distance, FluidCollisionMode.NEVER, true);
                if (obstruction != null) distance = Math.min(distance, obstruction.getHitPosition().distance(eye.toVector()) - 0.5);
                if (distance < (expected.mode.equals("top") ? 5 : 1.5)) { finish(false, "相机方向被墙壁或屋顶挡住，请到开阔处再拍；本次预扣地图由原流程退回。"); return; }
                eye.add(direction.multiply(distance)); pitch = expected.mode.equals("top") ? -Math.PI / 2 : -0.15;
            }
            out.addProperty("x", eye.getX()); out.addProperty("y", eye.getY() - 1.62); out.addProperty("z", eye.getZ());
            out.addProperty("yaw", Math.PI - Math.toRadians(pos.getYaw())); out.addProperty("pitch", pitch);
            send(camera, out); phase = "rendering";
        } catch (Exception e) { finish(false, "无法启动本机相机，请稍后重试。"); }
    }

    @Override public void onPluginMessageReceived(String channel, Player source, byte[] bytes) {
        if (!CHANNEL.equals(channel) || source != plugin.goddessLandAdministrator() || bytes.length > 2048) return;
        try {
            JsonObject data = JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8)).getAsJsonObject();
            String type = data.get("type").getAsString();
            if (type.equals("ready")) { heartbeat = System.currentTimeMillis(); workerIdle = data.has("idle") && data.get("idle").getAsBoolean(); return; }
            if (active == null || !active.id.toString().equals(data.get("job").getAsString()) || !active.nonce.equals(data.get("nonce").getAsString())) return;
            if (type.equals("uploading")) { uploadSent = true; phase = "importing"; }
            else if (type.equals("uploaded")) { uploadSent = true; phase = "confirming"; }
            else if (type.equals("failed")) {
                String reason = data.has("reason") ? data.get("reason").getAsString() : "";
                String next = reason.equals("PHOTO_CAMERA_LEASE_LOST") ? "角色移动或观察镜头改变，请站稳后再拍。"
                    : reason.startsWith("PHOTO_SKIN_") ? "角色原皮肤未能加载，请联系管理员检查皮肤来源或网络后再拍。"
                    : reason.equals("PHOTO_RENDER_TIMEOUT") ? "本机场景加载超时，请稍后重拍；不要连续提交。"
                    : "本机渲染或导入未完成，请稍后查询相机状态。";
                finish(false, next + "先查 /imageframe list；未创建时由原流程退回空地图。");
            }
        } catch (RuntimeException ignored) { }
    }

    private JsonObject envelope(Job job, String type) { var out = new JsonObject(); out.addProperty("type", type); out.addProperty("job", job.id.toString()); out.addProperty("nonce", job.nonce); return out; }
    private void send(Player p, JsonObject data) { p.sendPluginMessage(plugin, CHANNEL, data.toString().getBytes(StandardCharsets.UTF_8)); }
    private Object map(UUID owner, String name) throws Exception {
        Object manager = imageFrame.getField("imageMapManager").get(null);
        return manager.getClass().getMethod("getFromCreator", UUID.class, String.class).invoke(manager, owner, name);
    }
    private boolean delivered(Player p, Object map) throws Exception {
        if (p == null || !p.isOnline()) return false;
        var ids = (List<?>) map.getClass().getMethod("getMapIds").invoke(map);
        for (ItemStack item : p.getInventory().getStorageContents()) if (item != null && item.getItemMeta() instanceof MapMeta meta
            && meta.hasMapView() && ids.contains(meta.getMapView().getId())) return true;
        return false;
    }
    private void finish(boolean success, String message) {
        Job previous = active; if (previous == null) return;
        Player camera = plugin.goddessLandAdministrator(), owner = Bukkit.getPlayer(previous.owner);
        if (camera != null) {
            send(camera, envelope(previous, "cancel"));
            if (camera.getSpectatorTarget() != null && camera.getSpectatorTarget().getUniqueId().equals(previous.owner)) {
                camera.setSpectatorTarget(null); if (origin != null) camera.teleport(origin);
            }
        }
        if (!success) try {
            Object uploads = imageFrame.getField("imageUploadManager").get(null);
            if (pending(previous.owner, previous.name) != null)
                uploads.getClass().getMethod("invalidatePendingUploads", UUID.class).invoke(uploads, previous.owner);
        } catch (Exception ignored) { }
        active = null; phase = "idle"; origin = null;
        if (owner != null) notice(owner, success ? "success" : "stopped", message);
        plugin.getLogger().info("Photo camera job=" + previous.id + " owner=" + previous.owner + " result=" + (success ? "success" : "stopped"));
    }
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true) public void onCommand(PlayerCommandPreprocessEvent event) {
        if (owns(event.getPlayer().getUniqueId()) && event.getMessage().matches("(?i)^/(?:imageframe:)?imageframe\\s+(?:create|clone|delete|refresh)\\b.*")) {
            event.setCancelled(true); deny(event.getPlayer(), "拍照处理中，请等 photo status 完成，或 photo cancel 后再操作相册。");
        }
    }
    @EventHandler public void onQuit(PlayerQuitEvent event) { queue.removeIf(j -> j.owner.equals(event.getPlayer().getUniqueId())); if (active != null && active.owner.equals(event.getPlayer().getUniqueId())) finish(false, "角色已退出，停止拍照。"); }
    private void deny(Player p, String message) { notice(p, "denied", message); }
    void admin(org.bukkit.command.CommandSender sender, String[] args) {
        String action = args.length > 2 ? args[2].toLowerCase(Locale.ROOT) : "status";
        if (action.equals("pause")) {
            enabled = false;
            for (Job job : queue) { Player p = Bukkit.getPlayer(job.owner); if (p != null) notice(p, "cancelled", "相机维护，取消排队；未消耗地图。"); }
            queue.clear();
        } else if (action.equals("resume")) enabled = true;
        JsonObject data = new JsonObject(); data.addProperty("ready", ready()); data.addProperty("enabled", enabled);
        data.addProperty("phase", phase); data.addProperty("queue", queue.size()); data.addProperty("idle", active == null);
        data.addProperty("imageFrameAdapter", pendingUploads != null); data.addProperty("workerFresh", System.currentTimeMillis() - heartbeat < 15_000);
        data.addProperty("workerIdle", workerIdle);
        sender.sendMessage("MC_PHOTO_ADMIN " + data);
    }
    private void notice(Player p, String status, String message) { p.sendMessage(ChatColor.AQUA + "[女神相机] " + message); JsonObject out = new JsonObject(); out.addProperty("status", status); out.addProperty("instruction", message); p.sendMessage("MC_PHOTO " + out); }
    private static final class Menu implements InventoryHolder {
        final UUID owner; Inventory inventory; Menu(UUID owner) { this.owner = owner; }
        @Override public Inventory getInventory() { return inventory; }
    }
    void menu(Player p) {
        Menu holder = new Menu(p.getUniqueId()); holder.inventory = Bukkit.createInventory(holder, 27, "女神相机 · 无UI照片");
        menuItem(holder.inventory, 10, Material.SPYGLASS, "§b第一人称拍照", "拍你正在看的景物");
        menuItem(holder.inventory, 12, Material.ARMOR_STAND, "§b第三人称拍照", "从身后拍你与风景；保留人物名字");
        menuItem(holder.inventory, 14, Material.FEATHER, "§b俯视拍照", "从上方拍摄；请在开阔处使用");
        menuItem(holder.inventory, 16, Material.FILLED_MAP, "§a本人相册", "查看已完成的照片地图");
        menuItem(holder.inventory, 22, Material.CLOCK, "§e查看进度", "准备1张空地图和空主背包格；排队处理");
        p.openInventory(holder.inventory);
    }
    private void menuItem(Inventory inventory, int slot, Material material, String name, String lore) {
        ItemStack item = new ItemStack(material); var meta = item.getItemMeta(); meta.setDisplayName(name); meta.setLore(List.of(lore)); item.setItemMeta(meta); inventory.setItem(slot, item);
    }
    @EventHandler public void onClick(InventoryClickEvent event) {
        if (!(event.getView().getTopInventory().getHolder() instanceof Menu holder)) return;
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player p) || !p.getUniqueId().equals(holder.owner) || event.getRawSlot() < 0 || event.getRawSlot() >= 27) return;
        String mode = switch (event.getRawSlot()) { case 10 -> "first"; case 12 -> "third"; case 14 -> "top"; default -> ""; };
        if (!mode.isEmpty()) { p.closeInventory(); command(p, new String[]{"photo", "take", "生活_" + java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("MMdd_HHmmss")), mode}); }
        else if (event.getRawSlot() == 16) { p.closeInventory(); Bukkit.dispatchCommand(p, "imageframe list"); }
        else if (event.getRawSlot() == 22) command(p, new String[]{"photo", "status"});
    }
    @EventHandler public void onDrag(InventoryDragEvent event) { if (event.getView().getTopInventory().getHolder() instanceof Menu) event.setCancelled(true); }
    void stop() { if (task != null) task.cancel(); finish(false, "服务器维护，停止拍照；上线后请检查相册。"); queue.clear(); Bukkit.getMessenger().unregisterIncomingPluginChannel(plugin, CHANNEL, this); Bukkit.getMessenger().unregisterOutgoingPluginChannel(plugin, CHANNEL); }
}
