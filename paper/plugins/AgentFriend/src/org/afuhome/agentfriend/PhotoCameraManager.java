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
    private double manaCost;
    private Object nativeUpload;
    private boolean importStarted;
    private java.lang.reflect.Field pendingUploads;
    private BukkitTask task;
    private Class<?> imageFrame;
    private PhotoCameraMessages messages;
    private final PhotoJournal journal;
    private final PhotoTaskLedger receipts;
    private JsonObject capturedContext,capturedScene,capturedImage;
    private Location capturedAt;
    private long capturedTime;
    private record Job(UUID id, String nonce, UUID owner, String name, String mode, int tiles, UUID world, long queued, String story) {
        private Job(UUID id,String nonce,UUID owner,String name,String mode,int tiles,UUID world,long queued){this(id,nonce,owner,name,mode,tiles,world,queued,"");}
        private Job(Player p, String name, String mode, int tiles) { this(p,name,mode,tiles,""); }
        private Job(Player p, String name, String mode, int tiles, String story) { this(UUID.randomUUID(), UUID.randomUUID().toString(), p.getUniqueId(), name, mode, tiles, p.getWorld().getUID(), System.currentTimeMillis(),story); }
    }
    private Location origin;
    private UUID nativeRendererId;
    private Location nativeRendererOrigin;
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
        manaCost = Math.clamp(cfg.getDouble("mana-cost",2),1,20);
        String nativeId=cfg.getString("native-renderer-uuid","").strip();
        if(!nativeId.isEmpty())try{nativeRendererId=UUID.fromString(nativeId);}catch(IllegalArgumentException invalid){enabled=false;plugin.getLogger().warning("Invalid native photo renderer UUID; camera disabled until reviewed");}
        Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
        Bukkit.getMessenger().registerIncomingPluginChannel(plugin, CHANNEL, this);
        try { connectImageFrame(); } catch (Exception e) { plugin.getLogger().warning("Photo camera unavailable: " + e.getClass().getSimpleName()); }
        messages = new PhotoCameraMessages(plugin);
        journal = new PhotoJournal(plugin,this);
        receipts = new PhotoTaskLedger(plugin.getDataFolder().toPath().resolve("photo-tasks.json"));
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 10L, 10L);
    }

    private Player nativeRenderer(){return nativeRendererId==null?null:Bukkit.getPlayer(nativeRendererId);}
    private boolean nativeReady(){Player renderer=nativeRenderer();return nativeRendererId==null||renderer!=null&&renderer.getGameMode()==GameMode.SPECTATOR&&renderer!=plugin.goddessLandAdministrator();}
    boolean ready() { return enabled && receipts.ready() && nativeReady() && pendingUploads != null && System.currentTimeMillis() - heartbeat < 15_000 && plugin.goddessLandAdministrator() != null; }
    boolean readyForReminder(Player player, long now) {
        UUID owner = player.getUniqueId();
        return ready() && !owns(owner) && queue.size() < queueLimit
                && now - lastStarted(owner) >= cooldown * 1000L;
    }
    PhotoJournal journal(){return journal;}

    void command(Player p, String[] args) {
        String action = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "menu";
        action = switch (action) { case "菜单" -> "menu"; case "拍照" -> "take"; case "状态" -> "status"; case "取消" -> "cancel"; default -> action; };
        if(Set.of("album","gallery","info","title","story","exhibit","withdraw").contains(action)){journal.command(p,args);return;}
        if (action.equals("menu")) { menu(p); return; }
        if (action.equals("take")) {
            PhotoRequest request;
            try { request=PhotoRequest.parse(args,"生活_" + java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("MMdd_HHmmss"))); }
            catch(IllegalArgumentException invalid){deny(p,invalid.getMessage());return;}
            String name=request.name(),mode=request.mode();int tiles=request.tiles();
            if (plugin.isObserver(p) || p.isDead()) { deny(p, "请用正常存活角色拍照；观察账号不能代领照片。"); return; }
            if (!ready()) { deny(p, "女神相机暂未就绪，请稍后用 /mycli photo status 查询；无需访问网页或上传公网文件。"); return; }
            if (owns(p.getUniqueId())) { deny(p, "你已有拍照请求。用 /mycli photo status 查看，或 photo cancel 取消尚未上传的请求。"); return; }
            if (queue.size() >= queueLimit) { deny(p, "拍照队列已满，请稍后再拍。"); return; }
            long wait = cooldown * 1000L - (System.currentTimeMillis() - lastStarted(p.getUniqueId()));
            if (wait > 0) { deny(p, "请在 " + (wait / 1000 + 1) + " 秒后再拍。"); return; }
            try {
                if (pending(p.getUniqueId(), null) != null) { deny(p, "你还有手动上传待完成，请先完成原照片或等待原链接过期，再用女神相机。"); return; }
                if (map(p.getUniqueId(), name) != null) { deny(p, "本人已有同名照片，请换一个名字。"); return; }
            } catch (Exception e) { deny(p, "相册服务暂不可用，请稍后重试。"); return; }
            if (!materials(p, tiles)) return;
            Job job = new Job(p, name, mode, tiles,request.story());
            if (!receipts.begin(job.owner, job.id, request, job.queued)) { deny(p, "原拍照任务尚待核对或记录不可用；请先查 photo status 和 photo album，勿重复创建。"); return; }
            queue.add(job);
            if (active != null || queue.size() > 1 || !workerIdle) notice(p, "queued", "已排队，前面 " + ((active == null ? 0 : 1) + queue.size() - 1) + " 人。");
            tick();
        } else if (action.equals("cancel")) {
            if (active != null && active.owner.equals(p.getUniqueId())) {
                if (uploadPendingConfirmation()) { deny(p, "照片已上传或结果待核对，请用 photo status 查看，勿重复创建。"); return; }
                finish(false, "已取消拍照。");
            } else if (queue.removeIf(j -> { if (!j.owner.equals(p.getUniqueId())) return false; record(j,"stopped",null); return true; })) notice(p, "cancelled", "已取消排队，未消耗魔力。");
            else deny(p, "你没有待处理照片；从技能罗盘→女神相机或 /mycli photo menu 点击拍照。");
        } else {
            JsonObject previous = receipts.latest(p.getUniqueId());
            String state = active != null && active.owner.equals(p.getUniqueId()) ? phase : previous == null ? "idle" : previous.get("status").getAsString();
            notice(p, state, "相机" + (ready() ? "可用" : "暂未就绪") + "，你的请求：" + statusLabel(state) + "。技能罗盘→女神相机，或 /mycli photo menu 选择视角。无需空地图或主背包空位，开始拍摄耗"+manaCost+"魔力；成片自动存入个人奖励箱，/mycli arena stash pages 取照片。/mycli photo album 查作品。");
        }
    }

    private long lastStarted(UUID id) { return Math.max(last.getOrDefault(id,0L),receipts.lastStarted(id)); }
    private boolean owns(UUID id) { return active != null && active.owner.equals(id) || queue.stream().anyMatch(j -> j.owner.equals(id)) || receipts.unresolved(id); }
    private boolean record(Job job,String status,JsonObject fields) {
        boolean saved=receipts.update(job.owner,job.id,status,fields);
        if(!saved)plugin.getLogger().warning("Photo task receipt not saved job="+job.id+" status="+status);
        return saved;
    }
    /** Reconcile an existing original only. No new upload, rendering, debit or map creation. */
    private void recoverReceipt(Player owner) {
        if(active!=null&&active.owner.equals(owner.getUniqueId())||queue.stream().anyMatch(j->j.owner.equals(owner.getUniqueId())))return;
        JsonObject row=receipts.latest(owner.getUniqueId());
        if(row==null||pendingUploads==null)return;
        if(!receipts.unresolved(owner.getUniqueId())&&!(row.get("status").getAsString().equals("success")&&!journal.recorded(owner.getUniqueId(),row.get("job").getAsString())))return;
        try {
            Object original=map(owner.getUniqueId(),row.get("name").getAsString());
            if(original==null||!(boolean)original.getClass().getMethod("isValid").invoke(original))return;
            JsonObject shot=row.getAsJsonObject("capture");if(shot==null)return;
            UUID worldId=UUID.fromString(shot.get("world").getAsString());
            Job job=new Job(UUID.fromString(row.get("job").getAsString()),"",owner.getUniqueId(),row.get("name").getAsString(),row.get("mode").getAsString(),row.get("tiles").getAsInt(),worldId,row.get("queuedAt").getAsLong(),row.get("story").getAsString());
            if(!storeReward(job,original))return;
            World world=Bukkit.getWorld(worldId);
            if(world!=null)journal.delivered(owner,job.id,job.name,job.mode,shot.get("time").getAsLong(),new Location(world,shot.get("x").getAsDouble(),shot.get("y").getAsDouble(),shot.get("z").getAsDouble()),shot.getAsJsonObject("context"),shot.getAsJsonObject("scene"),row.getAsJsonObject("image"),original,job.story);
            recordSuccess(job,original);
            notice(owner,"success","原照片「"+job.name+"」已核对存入个人奖励箱；photo album 查作品，未重新拍摄或扣费。");
        }catch(Exception error){plugin.getLogger().warning("Photo recovery pending owner="+owner.getUniqueId()+" error="+error.getClass().getSimpleName());}
    }
    void recoverPendingReceipts(){for(Player owner:Bukkit.getOnlinePlayers())recoverReceipt(owner);}
    private void recordSuccess(Job job,Object original)throws Exception {
        JsonObject fields=new JsonObject();fields.addProperty("imageIndex",((Number)original.getClass().getMethod("getImageIndex").invoke(original)).intValue());
        JsonArray ids=new JsonArray();for(Object id:(List<?>)original.getClass().getMethod("getMapIds").invoke(original))ids.add(((Number)id).intValue());fields.add("mapIds",ids);
        record(job,"success",fields);
    }
    private boolean materials(Player p, int tiles) {
        try {
            if(!p.hasPermission("imageframe.create")){deny(p,"暂时没有拍照权限，请联系管理员检查 ImageFrame 权限。");return false;}
            int limit=((Number)imageFrame.getMethod("getPlayerCreationLimit",Player.class).invoke(null,p)).intValue();
            Object manager=imageFrame.getField("imageMapManager").get(null);
            int count=((Collection<?>)manager.getClass().getMethod("getFromCreator",UUID.class).invoke(manager,p.getUniqueId())).size();
            if(count>=64||limit>=0&&count>=limit){deny(p,"本人相册已达上限，请联系管理员归档旧作品；不要重复拍摄。");return false;}
            Object tasks=imageFrame.getField("imageMapCreationTaskManager").get(null);
            if((boolean)tasks.getClass().getMethod("isCreatorInQueue",UUID.class).invoke(tasks,p.getUniqueId())){deny(p,"本人已有相册导入在处理，请先查 photo status；勿重复创建。");return false;}
            return plugin.hasMana(p,manaCost);
        }catch(Exception unavailable){deny(p,"相册状态暂不可核对，请稍后用 photo status 查询。");return false;}
    }

    private void tick() {
        long now = System.currentTimeMillis();
        queue.removeIf(j -> {
            if (now - j.queued <= 180_000 && Bukkit.getPlayer(j.owner) != null) return false;
            record(j,"stopped",null);
            Player p = Bukkit.getPlayer(j.owner); if (p != null) notice(p, "expired", "排队已过期，未扣魔力；请在相机可用后重新拍摄。"); return true;
        });
        if (active == null) {
            if (queue.isEmpty() || !ready() || !workerIdle) return;
            Player camera = plugin.goddessLandAdministrator();
            if (camera.getSpectatorTarget() != null) return; // Existing manual observer session owns the camera.
            Player renderer=nativeRenderer();if(renderer!=null&&renderer.getSpectatorTarget()!=null)return;
            Job next = queue.remove(); Player owner = Bukkit.getPlayer(next.owner);
            if (owner == null || !owner.isOnline() || !owner.getWorld().getUID().equals(next.world) || !materials(owner, next.tiles)) { record(next,"stopped",null); return; }
            active = next; phase = "preparing"; started = System.currentTimeMillis(); uploadSent = false;
            nativeUpload=null;importStarted=false;
            origin = camera.getLocation().clone();
            nativeRendererOrigin=renderer==null?null:renderer.getLocation().clone();
            last.put(owner.getUniqueId(), started);
            if (!camera.teleport(owner.getLocation())) { finish(false, "无法同步观察镜头，请稍后再拍。"); return; }
            camera.setSpectatorTarget(owner);
            if(renderer!=null){if(!renderer.teleport(owner.getLocation())){finish(false,"原生相机镜头未能到达，请稍后再拍；本次未扣魔力。");return;}renderer.setSpectatorTarget(owner);}
            notice(owner, phase, "拍摄中，请保持静止；成片自动存入个人奖励箱。");
            messages.begin(owner.getUniqueId(), next.name, text -> {
                try { Object upload=pending(next.owner,next.name);return upload!=null && text.contains(upload.getClass().getMethod("getId").invoke(upload).toString()); }
                catch(Exception ignored) {return false;}
            });
            try {
                Object uploads=imageFrame.getField("imageUploadManager").get(null);
                nativeUpload=uploads.getClass().getMethod("newPendingUpload",UUID.class,String.class,String.class,int.class,int.class)
                    .invoke(uploads,next.owner,owner.getName(),next.name,next.tiles,next.tiles);
            }catch(Exception failed){finish(false,"相册创建入口不可用，请联系管理员检查 ImageFrame；本次未消耗魔力。");}
        } else {
            try {
                Player owner = Bukkit.getPlayer(active.owner);
                if (phase.equals("preparing")) {
                    Object upload = pending(active.owner, active.name);
                    if (upload != null) capture(active, upload.getClass().getMethod("getId").invoke(upload).toString());
                    if (active == null) return;
                }
                importUploaded();
                Object created = map(active.owner, active.name);
                if (created != null && storeReward(active,created)) { finish(true, "照片「" + active.name + "」已存入个人奖励箱；/mycli arena stash pages 取出。" + (active.tiles == 2 ? "按(1,1)到(2,2)挂成海报。" : "")); return; }
                // A completed HTTP upload is authoritative even if its worker ACK or
                // owner connection was lost. Keep polling the same Future, never reshoot.
                if(uploadSent||importStarted){
                    if(now-started>timeout*1000L)finish(false,"原照片结果待核对；重连后查 photo status / photo album，勿重复创建。");
                    return;
                }
                Player camera = plugin.goddessLandAdministrator();
                if (owner == null || !owner.isOnline() || owner.isDead() || !owner.getWorld().getUID().equals(active.world)
                    || camera == null || camera.getSpectatorTarget() != owner) { finish(false, "角色或镜头状态已改变，停止拍照；请稳定后重新拍摄。"); return; }
                if(nativeRendererId!=null&&(!nativeReady()||nativeRenderer().getSpectatorTarget()!=owner)){finish(false,"原生相机连接或观察目标改变，停止拍照；请先查相册，勿重复创建。");return;}
                if (System.currentTimeMillis() - started > timeout * 1000L) finish(false, "拍照等待超时。先查看 photo album 和个人奖励箱确认结果；已上传的照片仍可能完成入箱，勿连续重拍。");
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
                || active == null || (int) type.getMethod("getWidth").invoke(upload) != active.tiles || (int) type.getMethod("getHeight").invoke(upload) != active.tiles)) continue;
            if (found != null) throw new IllegalStateException("ambiguous pending upload");
            found = upload;
        }
        return found;
    }

    private void capture(Job expected, String uploadId) {
        if (active != expected || !phase.equals("preparing")) return;
        Player owner = Bukkit.getPlayer(expected.owner), camera = plugin.goddessLandAdministrator();
        if (owner == null || camera == null || camera.getSpectatorTarget() != owner) return;
        if(nativeRendererId!=null&&(!nativeReady()||nativeRenderer().getSpectatorTarget()!=owner))return;
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
                if (distance < (expected.mode.equals("top") ? 5 : 1.5)) { finish(false, "相机方向被墙壁或屋顶挡住，请到开阔处再拍；本次未消耗魔力。"); return; }
                eye.add(direction.multiply(distance)); pitch = expected.mode.equals("top") ? -Math.PI / 2 : -0.15;
            }
            out.addProperty("x", eye.getX()); out.addProperty("y", eye.getY() - 1.62); out.addProperty("z", eye.getZ());
            out.addProperty("yaw", Math.PI - Math.toRadians(pos.getYaw())); out.addProperty("pitch", pitch);
            capturedAt=pos.clone();capturedTime=System.currentTimeMillis();capturedImage=null;
            capturedContext=plugin.taskMarket().photoContext(owner);
            capturedScene=PhotoScene.inspect(eye,pitch,capturedContext);
            JsonObject shot=new JsonObject();shot.addProperty("world",expected.world.toString());shot.addProperty("x",pos.getX());shot.addProperty("y",pos.getY());shot.addProperty("z",pos.getZ());shot.addProperty("time",capturedTime);
            if(capturedContext!=null)shot.add("context",capturedContext.deepCopy());if(capturedScene!=null)shot.add("scene",capturedScene.deepCopy());
            JsonObject fields=new JsonObject();fields.addProperty("startedAt",started);fields.add("capture",shot);
            if(!record(expected,"rendering",fields)){finish(false,"拍照任务记录不可用，未开始拍摄；请稍后查询。");return;}
            if(!plugin.spendMana(owner,manaCost)){finish(false,"魔力不足，未开始拍摄；恢复后再试。");return;}
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
            if (type.equals("uploading")||type.equals("uploaded")) {
                if(data.has("image")) {
                    JsonObject image=PhotoEvidence.image(data.getAsJsonObject("image"));
                    if(capturedImage!=null&&!capturedImage.equals(image))return;
                    capturedImage=image;
                }
                uploadSent = true; phase = type.equals("uploading")?"importing":"confirming";
                JsonObject fields=new JsonObject();if(capturedImage!=null)fields.add("image",capturedImage.deepCopy());record(active,"confirming",fields);
            }
            else if (type.equals("failed")) {
                if(uploadPendingConfirmation()){uploadSent=true;phase="confirming";record(active,"confirming",null);return;}
                String reason = data.has("reason") ? data.get("reason").getAsString() : "";
                String next = reason.equals("PHOTO_CAMERA_LEASE_LOST") ? "角色移动或观察镜头改变，请站稳后再拍。"
                    : reason.startsWith("PHOTO_SKIN_") ? "角色原皮肤未能加载，请联系管理员检查皮肤来源或网络后再拍。"
                    : reason.equals("PHOTO_RENDER_TIMEOUT") ? "本机场景加载超时，请稍后重拍；不要连续提交。"
                    : "本机渲染或导入未完成，请稍后查询相机状态。";
                phase="failed"; // Worker confirms failure before any upload was attempted.
                finish(false, next + "先查 photo album 和个人奖励箱，勿重复重拍。");
            }
        } catch (RuntimeException ignored) { }
    }

    private JsonObject envelope(Job job, String type) { var out = new JsonObject(); out.addProperty("type", type); out.addProperty("job", job.id.toString()); out.addProperty("nonce", job.nonce); return out; }
    private boolean uploadPendingConfirmation() {
        if(importStarted)return true;
        if(nativeUpload==null)return uploadSent;
        try{
            var file=(java.util.concurrent.Future<?>)nativeUpload.getClass().getMethod("getFile").invoke(nativeUpload);
            if(!file.isDone())return uploadSent;
            try{return file.get()!=null;}
            catch(java.util.concurrent.ExecutionException terminal){
                // The pinned ImageFrame future atomically accepts either a file
                // or expiry. Expiry cannot later deliver a file for this upload.
                Throwable cause=terminal.getCause();
                return cause==null||!cause.getClass().getName().equals("com.loohp.imageframe.upload.PendingUploadExpiredException");
            }
            catch(InterruptedException interrupted){Thread.currentThread().interrupt();return true;}
        }
        catch(Exception unreadable){return true;} // Unknown upload outcome must not become a safe-to-retry failure.
    }
    private void send(Player p, JsonObject data) { p.sendPluginMessage(plugin, CHANNEL, data.toString().getBytes(StandardCharsets.UTF_8)); }
    private Object map(UUID owner, String name) throws Exception {
        Object manager = imageFrame.getField("imageMapManager").get(null);
        return manager.getClass().getMethod("getFromCreator", UUID.class, String.class).invoke(manager, owner, name);
    }
    boolean originalExists(JsonObject row) {
        try {
            Object original=map(UUID.fromString(row.get("owner").getAsString()),row.get("name").getAsString());
            if(original==null||!(boolean)original.getClass().getMethod("isValid").invoke(original)
                    ||((Number)original.getClass().getMethod("getImageIndex").invoke(original)).intValue()!=row.get("imageIndex").getAsInt())return false;
            List<?> ids=(List<?>)original.getClass().getMethod("getMapIds").invoke(original);
            return ids.equals(row.getAsJsonArray("mapIds").asList().stream().map(JsonElement::getAsInt).toList());
        }catch(Exception e){return false;}
    }
    @SuppressWarnings("unchecked") private boolean storeReward(Job job,Object map)throws Exception {
        if(!job.owner.equals(map.getClass().getMethod("getCreator").invoke(map)))throw new IllegalStateException("photo creator changed");
        List<ItemStack> items=(List<ItemStack>)map.getClass().getMethod("getMaps",String.class).invoke(map,imageFrame.getField("mapItemFormat").get(null));
        if(items.size()!=job.tiles*job.tiles)throw new IllegalStateException("photo tiles incomplete");
        return plugin.dungeon().storePhoto(job.owner,((Number)map.getClass().getMethod("getImageIndex").invoke(map)).intValue(),items);
    }
    /** Import the exact file returned by our owner-bound native upload. Do not change
     * global requireEmptyMaps, give a player temporary OP, or expose a file URL to a client. */
    private void importUploaded()throws Exception {
        if(importStarted||nativeUpload==null)return;
        var file=(java.util.concurrent.Future<?>)nativeUpload.getClass().getMethod("getFile").invoke(nativeUpload);
        if(!file.isDone())return;
        java.io.File uploaded=(java.io.File)file.get();if(uploaded==null||!uploaded.isFile())throw new IllegalStateException("missing uploaded photo");
        uploadSent=true;
        Job expected=active;Player owner=Bukkit.getPlayer(expected.owner);if(owner==null)return;
        Location shotAt=capturedAt==null?null:capturedAt.clone();long shotTime=capturedTime;
        JsonObject shotContext=capturedContext==null?null:capturedContext.deepCopy(),shotScene=capturedScene==null?null:capturedScene.deepCopy(),shotImage=capturedImage==null?null:capturedImage.deepCopy();
        importStarted=true;phase="confirming";
        Bukkit.getScheduler().runTaskAsynchronously(plugin,()->{
            Object nativeTask=null;
            try {
                ClassLoader cl=imageFrame.getClassLoader();String prefix="com.loohp.imageframe.objectholders.";
                Class<?> base=cl.loadClass(prefix+"URLImageMap"),info=cl.loadClass(prefix+"URLImageMapCreateInfo"),managerClass=cl.loadClass(prefix+"ImageMapManager"),dither=cl.loadClass(prefix+"DitheringType");
                Object manager=imageFrame.getField("imageMapManager").get(null),dithering=dither.getField("FLOYD_STEINBERG").get(null);
                Object loader=cl.loadClass(prefix+"ImageMapLoaders").getMethod("getLoader",Class.class,Class.class,String.class,org.bukkit.command.CommandSender.class)
                    .invoke(null,base,info,"image/png",owner);
                Object createInfo=info.getConstructor(managerClass,String.class,String.class,int.class,int.class,dither,UUID.class)
                    .newInstance(manager,expected.name,uploaded.toURI().toASCIIString(),expected.tiles,expected.tiles,dithering,expected.owner);
                Class<?> supplierClass=cl.loadClass("com.loohp.imageframe.utils.ThrowingSupplier");
                Object supplier=java.lang.reflect.Proxy.newProxyInstance(cl,new Class<?>[]{supplierClass},(proxy,method,args)->{
                    if(method.getName().equals("get"))return ((java.util.concurrent.Future<?>)cl.loadClass(prefix+"ImageMapLoader").getMethod("create",cl.loadClass(prefix+"ImageMapCreateInfo")).invoke(loader,createInfo)).get();
                    if(method.getName().equals("toString"))return "OwnerBoundPhotoImport";if(method.getName().equals("hashCode"))return System.identityHashCode(proxy);return proxy==args[0];
                });
                Object tasks=imageFrame.getField("imageMapCreationTaskManager").get(null);nativeTask=tasks.getClass().getMethod("enqueue",UUID.class,String.class,supplierClass).invoke(tasks,expected.owner,expected.name,supplier);
                Object created=((java.util.concurrent.Future<?>)nativeTask).get(45,java.util.concurrent.TimeUnit.SECONDS);managerClass.getMethod("addMap",cl.loadClass(prefix+"ImageMap")).invoke(manager,created);
                Bukkit.getScheduler().runTask(plugin,()->{try{
                    if(!storeReward(expected,created))throw new IllegalStateException("photo reward save failed");
                    if(shotAt!=null)journal.delivered(owner,expected.id,expected.name,expected.mode,shotTime,shotAt,shotContext,shotScene,shotImage,created,expected.story);
                    recordSuccess(expected,created);
                    if(active==expected)finish(true,"照片「"+expected.name+"」已存入个人奖励箱；/mycli arena stash pages 取出。"+(expected.tiles==2?"按(1,1)到(2,2)挂成海报。":""));
                }catch(Exception e){plugin.getLogger().warning("Photo reward pending owner="+expected.owner+" job="+expected.id+" error="+e.getClass().getSimpleName());}});
            }catch(Exception e){
                plugin.getLogger().warning("Photo import job="+expected.id+" error="+e.getClass().getSimpleName());
                if(plugin.isEnabled())Bukkit.getScheduler().runTask(plugin,()->{if(active==expected)finish(false,"照片导入未完成，请查询相册和个人奖励箱；不要重复创建。");});
            }finally{
                // ImageFrame's task future and its per-creator queue lease have
                // distinct lifecycles. Always release the latter, including errors.
                if(nativeTask!=null)try{
                    Class<?> component=imageFrame.getClassLoader().loadClass("com.loohp.imageframe.libs.net.kyori.adventure.text.Component");
                    nativeTask.getClass().getMethod("complete",component).invoke(nativeTask,component.getMethod("empty").invoke(null));
                }catch(Exception e){plugin.getLogger().warning("Photo native queue release failed: "+e.getClass().getSimpleName());}
            }
        });
    }
    private void finish(boolean success, String message) {
        Job previous = active; if (previous == null) return;
        Player camera = plugin.goddessLandAdministrator(), owner = Bukkit.getPlayer(previous.owner);
        // Photo delivery is authoritative even if a separate journal write fails. Never resend maps.
        if(success&&owner!=null&&capturedAt!=null)try {
            journal.delivered(owner,previous.id,previous.name,previous.mode,capturedTime,capturedAt,capturedContext,capturedScene,capturedImage,map(previous.owner,previous.name),previous.story);
        }catch(Exception e){owner.sendMessage("§e照片已存入个人奖励箱，纪念册未完成记录；请联系管理员核对，不要重复领图。");plugin.getLogger().warning("Photo journal job="+previous.id+" failed="+e.getClass().getSimpleName());}
        if(success)try{recordSuccess(previous,map(previous.owner,previous.name));}catch(Exception e){plugin.getLogger().warning("Photo completion receipt pending job="+previous.id);}
        else record(previous,uploadPendingConfirmation()?"unknown":"stopped",null);
        if (camera != null) {
            send(camera, envelope(previous, "cancel"));
            if (camera.getSpectatorTarget() != null && camera.getSpectatorTarget().getUniqueId().equals(previous.owner)) {
                camera.setSpectatorTarget(null); if (origin != null) camera.teleport(origin);
            }
        }
        Player renderer=nativeRenderer();
        if(renderer!=null&&renderer.getSpectatorTarget()!=null&&renderer.getSpectatorTarget().getUniqueId().equals(previous.owner)){
            renderer.setSpectatorTarget(null);if(nativeRendererOrigin!=null)renderer.teleport(nativeRendererOrigin);
        }
        if (!success) try {
            Object uploads = imageFrame.getField("imageUploadManager").get(null);
            if (pending(previous.owner, previous.name) != null)
                uploads.getClass().getMethod("invalidatePendingUploads", UUID.class).invoke(uploads, previous.owner);
        } catch (Exception ignored) { }
        active = null; phase = "idle"; origin = null;
        nativeRendererOrigin=null;
        capturedAt=null;capturedContext=null;capturedScene=null;capturedImage=null;capturedTime=0;
        nativeUpload=null;importStarted=false;
        messages.end(previous.owner);
        if (owner != null) { JsonObject row=receipts.latest(previous.owner);notice(owner, success ? "success" : row==null?"stopped":row.get("status").getAsString(), message); }
        plugin.getLogger().info("Photo camera job=" + previous.id + " owner=" + previous.owner + " result=" + (success ? "success" : "stopped"));
    }
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true) public void onCommand(PlayerCommandPreprocessEvent event) {
        String[] words=event.getMessage().split("\\s+");
        if(words.length>=3&&words[0].matches("(?i)/(?:imageframe:)?imageframe")&&Set.of("refresh","delete").contains(words[1].toLowerCase(Locale.ROOT))&&journal.locked(event.getPlayer().getUniqueId(),words[2])) {
            event.setCancelled(true);deny(event.getPlayer(),"纪念册原片用于考试与署名，不能覆盖或删除；请换新名字拍照。撤展用 /mycli photo withdraw "+words[2]+"，需归档请联系管理员。");return;
        }
        if (owns(event.getPlayer().getUniqueId()) && event.getMessage().matches("(?i)^/(?:imageframe:)?imageframe\\s+(?:create|clone|delete|refresh)\\b.*")) {
            event.setCancelled(true); deny(event.getPlayer(), "拍照处理中，请等 photo status 完成，或 photo cancel 后再操作相册。");
        }
    }
    @EventHandler public void onQuit(PlayerQuitEvent event) {
        queue.removeIf(j -> {if(!j.owner.equals(event.getPlayer().getUniqueId()))return false;record(j,"stopped",null);return true;});
        if(active!=null&&active.owner.equals(event.getPlayer().getUniqueId())) {
            if(uploadPendingConfirmation()){uploadSent=true;return;}
            finish(false,"角色已退出，停止拍照。");
        }
    }
    @EventHandler public void onJoin(PlayerJoinEvent event){
        Bukkit.getScheduler().runTaskLater(plugin,()->{if(event.getPlayer().isOnline())recoverReceipt(event.getPlayer());},40L);
    }
    private void deny(Player p, String message) { notice(p, "denied", message); }
    void admin(org.bukkit.command.CommandSender sender, String[] args) {
        String action = args.length > 2 ? args[2].toLowerCase(Locale.ROOT) : "status";
        if(action.startsWith("gallery-")){journal.admin(sender,args);return;}
        if (action.equals("pause")) {
            enabled = false;
            for (Job job : queue) { record(job,"stopped",null);Player p = Bukkit.getPlayer(job.owner); if (p != null) notice(p, "cancelled", "相机维护，取消排队；未消耗魔力。"); }
            queue.clear();
        } else if (action.equals("resume")) enabled = true;
        JsonObject data = new JsonObject(); data.addProperty("ready", ready()); data.addProperty("enabled", enabled);
        data.addProperty("phase", phase); data.addProperty("queue", queue.size()); data.addProperty("idle", active == null);
        data.addProperty("imageFrameAdapter", pendingUploads != null); data.addProperty("workerFresh", System.currentTimeMillis() - heartbeat < 15_000);
        data.addProperty("workerIdle", workerIdle);
        data.addProperty("taskReceiptsReady",receipts.ready());
        sender.sendMessage("MC_PHOTO_ADMIN " + data);
    }
    private void notice(Player p, String status, String message) {
        p.sendMessage(ChatColor.AQUA + "[女神相机] " + message);
        JsonObject out = new JsonObject(); out.addProperty("status", status); out.addProperty("instruction", message);
        out.addProperty("statusLabel", statusLabel(status)); out.addProperty("language", "zh-CN"); out.addProperty("recipient", p.getName());
        out.addProperty("storage","personal_reward_box");out.addProperty("storageCommand","/mycli arena stash pages");out.addProperty("requiresEmptyMaps",false);out.addProperty("manaCost",manaCost);
        out.addProperty("ready",ready());out.addProperty("cooldownSeconds",Math.max(0,(cooldown*1000L-System.currentTimeMillis()+lastStarted(p.getUniqueId())+999)/1000));
        JsonObject row=receipts.latest(p.getUniqueId());
        if(row!=null&&!status.equals("denied")){
            for(String key:List.of("job","owner","name","imageIndex","mapIds"))if(row.has(key))out.add(key,row.get(key).deepCopy());
            out.addProperty("jobStatus",row.get("status").getAsString());
            out.addProperty("journalRecorded",journal.recorded(p.getUniqueId(),row.get("job").getAsString()));
        }
        send(p, out);
        if (plugin.isRegisteredAgent(p)) p.sendMessage("MC_PHOTO " + out);
    }
    private static String statusLabel(String status) {
        return switch (status) {
            case "idle" -> "没有待拍照片"; case "queued" -> "排队中"; case "preparing" -> "准备拍摄";
            case "rendering" -> "正在拍摄"; case "importing" -> "正在制作照片"; case "confirming" -> "确认存入个人奖励箱";
            case "success" -> "拍照完成"; case "cancelled" -> "已取消"; case "expired" -> "排队已过期";
            case "unknown" -> "原照片结果待核对，勿重复创建";
            case "denied" -> "暂时不能拍摄"; case "stopped" -> "拍摄已停止"; default -> "请查看说明";
        };
    }
    private static final class Menu implements InventoryHolder {
        final UUID owner; Inventory inventory; Menu(UUID owner) { this.owner = owner; }
        @Override public Inventory getInventory() { return inventory; }
    }
    void menu(Player p) {
        Menu holder = new Menu(p.getUniqueId()); holder.inventory = Bukkit.createInventory(holder, 27, "女神相机 · 点击拍照");
        menuItem(holder.inventory, 10, Material.SPYGLASS, "§b第一人称拍照", "拍你正在看的景物");
        menuItem(holder.inventory, 12, Material.ARMOR_STAND, "§b第三人称拍照", "从身后拍你与风景；保留人物名字");
        menuItem(holder.inventory, 14, Material.FEATHER, "§b俯视拍照", "从上方拍摄；请在开阔处使用");
        menuItem(holder.inventory, 16, Material.FILLED_MAP, "§a本人相册", "查看已完成的照片地图");
        menuItem(holder.inventory, 15, Material.BOOK, "§b旅行纪念册", "作品题目、故事与考试照片检查");
        menuItem(holder.inventory, 17, Material.PAINTING, "§d艺术厅摄影展", "查看作者署名和旅行故事；本人自愿投稿");
        menuItem(holder.inventory, 22, Material.CLOCK, "§e查看进度", "无需空地图，开始拍摄耗"+manaCost+"魔力；成片自动入个人奖励箱");
        menuItem(holder.inventory, 19, Material.PAINTING, "§b清晰海报 · 第一人称", "2×2照片，无需地图或主背包空位；自动入个人奖励箱");
        menuItem(holder.inventory, 21, Material.PAINTING, "§b清晰海报 · 第三人称", "2×2照片，无需地图或主背包空位；自动入个人奖励箱");
        menuItem(holder.inventory, 23, Material.PAINTING, "§b清晰海报 · 俯视", "2×2照片，无需地图或主背包空位；自动入个人奖励箱");
        menuItem(holder.inventory, 25, Material.CHEST,"§a个人奖励箱 · 取照片","照片已自动存好；箱满时保留在本人待入箱队列");
        menuItem(holder.inventory, 18, Material.COMPASS, "§e返回技能罗盘", "自动拍照，无需网页、截图或手动上传");
        menuItem(holder.inventory, 24, Material.BARRIER, "§c取消本人拍照请求", "只取消本人请求；已经导入的照片保留");
        menuItem(holder.inventory, 26, Material.BARRIER, "§7关闭", "照片不带游戏界面，保留人物名字");
        p.openInventory(holder.inventory);
    }
    private void menuItem(Inventory inventory, int slot, Material material, String name, String lore) {
        ItemStack item = new ItemStack(material); var meta = item.getItemMeta(); meta.setDisplayName(name); meta.setLore(List.of(lore)); item.setItemMeta(meta); inventory.setItem(slot, item);
    }
    @EventHandler public void onClick(InventoryClickEvent event) {
        if (!(event.getView().getTopInventory().getHolder() instanceof Menu holder)) return;
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player p) || !p.getUniqueId().equals(holder.owner) || event.getRawSlot() < 0 || event.getRawSlot() >= 27) return;
        String mode = switch (event.getRawSlot()) { case 10, 19 -> "first"; case 12, 21 -> "third"; case 14, 23 -> "top"; default -> ""; };
        if (!mode.isEmpty()) { p.closeInventory(); command(p, new String[]{"photo", "take", "生活_" + java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("MMdd_HHmmss")), mode, event.getRawSlot() >= 19 ? "2" : "1"}); }
        else if (event.getRawSlot() == 16) { p.closeInventory(); Bukkit.dispatchCommand(p, "imageframe list"); }
        else if(event.getRawSlot()==15||event.getRawSlot()==17){p.closeInventory();journal.command(p,new String[]{"photo",event.getRawSlot()==15?"album":"gallery"});}
        else if (event.getRawSlot() == 22) command(p, new String[]{"photo", "status"});
        else if (event.getRawSlot() == 18) { p.closeInventory(); p.performCommand("mycli menu"); }
        else if (event.getRawSlot() == 24) { p.closeInventory(); command(p, new String[]{"photo", "cancel"}); }
        else if (event.getRawSlot() == 25) { p.closeInventory();plugin.dungeon().openStashPages(p); }
        else if (event.getRawSlot() == 26) p.closeInventory();
    }
    @EventHandler public void onDrag(InventoryDragEvent event) { if (event.getView().getTopInventory().getHolder() instanceof Menu) event.setCancelled(true); }
    void stop() { if (task != null) task.cancel(); if(active!=null&&phase.equals("rendering"))uploadSent=true;finish(false, "服务器维护，停止拍照；上线后请检查相册。"); messages.close(); for(Job job:queue)record(job,"stopped",null);queue.clear(); Bukkit.getMessenger().unregisterIncomingPluginChannel(plugin, CHANNEL, this); Bukkit.getMessenger().unregisterOutgoingPluginChannel(plugin, CHANNEL); }
}
