package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.hanging.HangingBreakEvent;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.world.ChunkLoadEvent;
import org.bukkit.inventory.*;
import org.bukkit.inventory.meta.*;
import org.bukkit.persistence.PersistentDataType;

/** Private originals, author-written captions and an opt-in public exhibition using native maps/books. */
final class PhotoJournal implements Listener {
    private final AgentFriendPlugin plugin;
    private final PhotoCameraManager camera;
    private final ProfessionLedger ledger;
    private final NamespacedKey exhibitKey;
    private final Map<Inventory,Menu> menus=new IdentityHashMap<>();
    private boolean reconcileQueued;
    private final Set<UUID> registeredFrames=new HashSet<>();
    private record Menu(UUID owner,boolean publicGallery,int page,List<String> ids,String detail) { }
    PhotoJournal(AgentFriendPlugin plugin,PhotoCameraManager camera) {
        this.plugin=plugin;this.camera=camera;exhibitKey=new NamespacedKey(plugin,"photo_exhibit");
        ledger=new ProfessionLedger(plugin.getDataFolder().toPath().resolve("photo-journal.json"));
        Bukkit.getPluginManager().registerEvents(this,plugin);
        // ImageFrame loads its saved originals asynchronously after onEnable.
        // Reconcile on its native add/load event, marshalled back to the main
        // thread; missing during startup must never mean "delete exhibition".
        var images=Bukkit.getPluginManager().getPlugin("ImageFrame");
        if(images!=null)try {
            Class<? extends Event> loaded=Class.forName("com.loohp.imageframe.api.events.ImageMapAddedEvent",true,
                    images.getClass().getClassLoader()).asSubclass(Event.class);
            Bukkit.getPluginManager().registerEvent(loaded,this,EventPriority.MONITOR,
                    (listener,event)->Bukkit.getScheduler().runTask(plugin,this::queueReconcile),plugin);
        } catch(ReflectiveOperationException ex){plugin.getLogger().warning("Photo gallery image-load event unavailable; existing exhibits retained");}
        if(!ledger.ready())plugin.getLogger().severe("Photo journal unavailable; retained file, no exam/photo exhibition writes: "+ledger.error());
        Bukkit.getScheduler().runTask(plugin,this::reconcile);
    }
    boolean ready(){return ledger.ready();}
    private JsonObject rows(UUID owner) {
        JsonObject p=ledger.profile(owner);return p.has("photos")?p.getAsJsonObject("photos"):new JsonObject();
    }
    private static JsonObject rows(JsonObject data,UUID owner) {
        JsonObject p=ProfessionLedger.profile(data,owner);if(!p.has("photos"))p.add("photos",new JsonObject());return p.getAsJsonObject("photos");
    }
    private JsonObject find(String id) {
        if(!ready()||!id.matches("[a-f0-9-]{36}"))return null;
        for(var p:ledger.data().getAsJsonObject("players").entrySet()) {
            JsonObject photos=p.getValue().getAsJsonObject().getAsJsonObject("photos");if(photos!=null&&photos.has(id))return photos.getAsJsonObject(id);
        }
        return null;
    }
    private JsonObject mine(Player p,String value) {
        for(var entry:rows(p.getUniqueId()).entrySet()) {
            JsonObject row=entry.getValue().getAsJsonObject();if(entry.getKey().equals(value)||row.get("name").getAsString().equals(value))return row;
        }
        return null;
    }
    /** Called after every tile is durably stored in the owner's personal reward chest or private overflow. */
    void delivered(Player p,UUID id,String name,String mode,long captured,Location at,JsonObject context,JsonObject scene,JsonObject image,Object map) throws Exception {
        if(rows(p.getUniqueId()).has(id.toString()))return;
        if(rows(p.getUniqueId()).size()>=64){say(p,"照片已存入个人奖励箱，但纪念册达到64份上限；请联系管理员归档，考试尚未计入。");return;}
        PhotoEvidence.Review review=PhotoEvidence.review(scene,image);
        JsonObject row=new JsonObject();row.addProperty("id",id.toString());row.addProperty("owner",p.getUniqueId().toString());row.addProperty("author",p.getName());
        row.addProperty("name",name);row.addProperty("title",name);row.addProperty("story","");row.addProperty("mode",mode);row.addProperty("capturedAt",captured);
        row.addProperty("world",at.getWorld().getName());row.addProperty("worldUuid",at.getWorld().getUID().toString());
        row.addProperty("x",at.getBlockX());row.addProperty("y",at.getBlockY());row.addProperty("z",at.getBlockZ());
        row.addProperty("biome",WorldBiomes.at(at));
        row.addProperty("imageIndex",((Number)map.getClass().getMethod("getImageIndex").invoke(map)).intValue());
        JsonArray ids=new JsonArray();for(Object tile:(List<?>)map.getClass().getMethod("getMapIds").invoke(map))ids.add(((Number)tile).intValue());row.add("mapIds",ids);
        row.addProperty("qualified",review.qualified());row.addProperty("honour",review.honour());row.addProperty("reason",review.reason());row.addProperty("review",review.advice());row.addProperty("published",false);
        if(context!=null)row.add("context",context.deepCopy());if(scene!=null)row.add("scene",scene.deepCopy());if(image!=null)row.add("image",image.deepCopy());
        if(!ledger.write(data->rows(data,p.getUniqueId()).add(id.toString(),row))) {say(p,"照片已存入个人奖励箱，但纪念册保存失败，考试尚未计入；请联系管理员核对，勿重复领取。");return;}
        say(p,review.advice()+" /mycli photo info "+name+" 查看作品。");
        if(context!=null)say(p,"探索照片进度：/mycli guild exam status；原来的走查和返程条件仍需完成。");
        else if(!plugin.skillAssessments().photoExam(p).isEmpty())say(p,"这张照片没有匹配当前考试的探索目的地，不计入考试。用 /mycli guild status 查当前阶段，先到该阶段的目标实地再拍。");
    }
    JsonArray matching(Player p,String exam,String market,int step,long started) {
        JsonArray out=new JsonArray();
        for(var item:rows(p.getUniqueId()).entrySet()) {
            JsonObject row=item.getValue().getAsJsonObject();
            if(PhotoEvidence.matches(row,p.getUniqueId(),exam,market,step,started)&&camera.originalExists(row)) {
                JsonObject proof=new JsonObject();proof.addProperty("id",item.getKey());proof.add("biome",row.get("biome"));
                proof.add("context",row.getAsJsonObject("context").deepCopy());out.add(proof);
            }
        }
        return out;
    }
    boolean locked(UUID owner,String name) {
        for(var item:rows(owner).entrySet())if(item.getValue().getAsJsonObject().get("name").getAsString().equals(name))return true;
        return false; // Recorded originals are immutable; taking a new image produces a new entry.
    }
    void command(Player p,String[] args) {
        String action=args.length>1?args[1]:"album";
        try {
            if(!ready())throw new IllegalArgumentException("纪念册暂不可用，请联系管理员检查存储；原照片地图保留。");
            if(action.equals("gallery")||action.equals("album")) {int page=args.length>2?Integer.parseInt(args[2]):1;if(page<1||page>256)throw new IllegalArgumentException("页码为1至256");menu(p,action.equals("gallery"),page);return;}
            if(args.length<3)throw new IllegalArgumentException("用 /mycli photo album 找本人作品；photo gallery 看艺术厅展览。");
            JsonObject row=mine(p,args[2]);if(row==null&&action.equals("info")) {JsonObject other=find(args[2]);if(other!=null&&other.get("published").getAsBoolean())row=other;}
            if(row==null)throw new IllegalArgumentException("没有这份可读作品；用 photo album 看本人照片名字，photo gallery 看已公开作品。");
            if(action.equals("info")){show(p,row);return;}
            JsonObject next=row.deepCopy();
            switch(action) {
                case "title","story" -> next.addProperty(action,PhotoEvidence.text(String.join(" ",Arrays.copyOfRange(args,3,args.length)),action.equals("title")?64:400));
                case "exhibit" -> {
                    if(!row.get("qualified").getAsBoolean())throw new IllegalArgumentException("照片尚未合格："+row.get("review").getAsString());
                    if(row.get("story").getAsString().isBlank())throw new IllegalArgumentException("先写作品故事：/mycli photo story "+row.get("name").getAsString()+" <你在当地的经历>；再用 photo exhibit 投稿。");
                    if(!camera.originalExists(row))throw new IllegalArgumentException("原始照片已不可读，请联系管理员检查 ImageFrame，相册不会自动重新发物品。");
                    next.addProperty("published",true);
                }
                case "withdraw" -> next.addProperty("published",false);
                default -> throw new IllegalArgumentException("用法：photo info|title|story|exhibit|withdraw <本人照片名> [文字]。");
            }
            String id=row.get("id").getAsString();
            if(!ledger.write(data->rows(data,p.getUniqueId()).add(id,next)))throw new IllegalArgumentException("保存失败，原作品保持；请联系管理员检查存储。");
            reconcile();say(p,action.equals("exhibit")?"作品已收入艺术厅目录；有合适的空展位时自动挂墙，photo info 可查展位。署名、地点和故事已公开。":action.equals("withdraw")?"作品已撤展，个人纪念册和原地图保留。":"作品说明已保存。");
            show(p,next);
        } catch(IllegalArgumentException e){say(p,e.getMessage());}
    }
    private void say(Player p,String message){p.sendMessage("§b[旅行纪念册] "+message);}
    private JsonObject visible(JsonObject row) {
        JsonObject out=new JsonObject();for(String key:List.of("id","author","title","story","world","x","y","z","biome","capturedAt","mode","qualified","honour","review","published"))out.add(key,row.get(key).deepCopy());
        out.addProperty("storySource","author");out.addProperty("hasExamContext",row.has("context"));out.addProperty("honourLabel",row.get("honour").getAsBoolean()?"摄影·层次分明":"无");
        out.addProperty("slot",slotOf(row.get("id").getAsString()));return out;
    }
    private void show(Player p,JsonObject row) {
        JsonObject out=visible(row);out.addProperty("schemaVersion",1);out.addProperty("type","record");out.addProperty("recipient",p.getName());
        p.sendPluginMessage(plugin,PhotoCameraManager.CHANNEL,out.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        if(plugin.isRegisteredAgent(p))p.sendMessage("MC_PHOTO_RECORD "+out);
        say(p,"《"+row.get("title").getAsString()+"》 摄影："+row.get("author").getAsString()+"；"+row.get("review").getAsString());
        ItemStack book=new ItemStack(Material.WRITTEN_BOOK);BookMeta meta=(BookMeta)book.getItemMeta();meta.setTitle("艺术厅 · 作品故事");meta.setAuthor(row.get("author").getAsString());
        meta.addPage("《"+row.get("title").getAsString()+"》\n摄影："+row.get("author").getAsString()+"\n地点："+row.get("world").getAsString()+"\n"+row.get("x")+", "+row.get("y")+", "+row.get("z")+"\n\n"+(row.get("honour").getAsBoolean()?"摄影·层次分明\n":"")+"作者故事见下一页");
        String story=row.get("story").getAsString();if(story.isEmpty())meta.addPage("作者尚未填写故事。\n\nphoto story <照片名> <经历>\nphoto title <照片名> <题目>\nphoto exhibit <照片名>\n填写后主动投稿艺术厅。");
        else {int[] cp=story.codePoints().toArray();for(int n=0;n<cp.length;n+=150)meta.addPage(new String(cp,n,Math.min(150,cp.length-n)));}
        book.setItemMeta(meta);p.openBook(book);
    }
    private List<JsonObject> all() {
        List<JsonObject> out=new ArrayList<>();if(!ready())return out;
        for(var p:ledger.data().getAsJsonObject("players").entrySet()){JsonObject photos=p.getValue().getAsJsonObject().getAsJsonObject("photos");if(photos!=null)for(var row:photos.entrySet())out.add(row.getValue().getAsJsonObject());}
        out.sort(Comparator.comparingLong(r->r.get("capturedAt").getAsLong()));return out;
    }
    private ItemStack tile(JsonObject row,int index) {
        ItemStack item=new ItemStack(Material.FILLED_MAP);MapMeta meta=(MapMeta)item.getItemMeta();
        var view=Bukkit.getMap(row.getAsJsonArray("mapIds").get(index).getAsInt());if(view==null)return null;meta.setMapView(view);
        meta.setDisplayName("§f《"+row.get("title").getAsString()+"》");meta.setLore(List.of("§7摄影："+row.get("author").getAsString(),"§7点击阅读作者故事",row.get("honour").getAsBoolean()?"§6摄影·层次分明":"§7旅行纪念"));item.setItemMeta(meta);return item;
    }
    private void menu(Player p,boolean gallery,int page) {
        List<JsonObject> list=all().stream().filter(r->gallery?r.get("published").getAsBoolean():r.get("owner").getAsString().equals(p.getUniqueId().toString())).toList();
        page=Math.min(page,Math.max(1,(list.size()+26)/27));int from=(page-1)*27;
        List<JsonObject> shown=list.subList(from,Math.min(list.size(),from+27));Inventory inv=Bukkit.createInventory(null,36,(gallery?"艺术厅 · 摄影展":"旅行纪念册 · 本人作品")+" "+page);
        for(int n=0;n<shown.size();n++)inv.setItem(n,tile(shown.get(n),0));
        inv.setItem(27,button(Material.ARROW,"上一页"));inv.setItem(31,button(Material.BARRIER,"关闭"));inv.setItem(32,button(Material.BOOK,gallery?"本人纪念册":"艺术厅展览"));inv.setItem(35,button(Material.ARROW,"下一页"));
        menus.put(inv,new Menu(p.getUniqueId(),gallery,page,shown.stream().map(r->r.get("id").getAsString()).toList(),""));p.openInventory(inv);
        JsonObject data=new JsonObject();data.addProperty("type",gallery?"gallery":"album");data.addProperty("page",page);data.addProperty("total",list.size());JsonArray works=new JsonArray();for(JsonObject row:shown){JsonObject brief=visible(row);brief.remove("story");brief.remove("review");brief.add("name",row.get("name"));works.add(brief);}data.add("works",works);
        if(plugin.isRegisteredAgent(p))p.sendMessage("MC_PHOTO_ALBUM "+data);say(p,"点击作品读署名、地点和故事；用 photo title/story/exhibit <本人照片名> 编辑并投稿。");
    }
    private ItemStack button(Material type,String text){ItemStack i=new ItemStack(type);var m=i.getItemMeta();m.setDisplayName(text);i.setItemMeta(m);return i;}
    @EventHandler(priority=EventPriority.HIGHEST) public void click(InventoryClickEvent e){Menu m=menus.get(e.getView().getTopInventory());if(m==null)return;e.setCancelled(true);if(!(e.getWhoClicked() instanceof Player p)||!p.getUniqueId().equals(m.owner))return;int slot=e.getRawSlot();p.closeInventory();
        if(slot>=0&&slot<m.ids.size()){JsonObject row=find(m.ids.get(slot));if(row!=null&&(row.get("published").getAsBoolean()||row.get("owner").getAsString().equals(p.getUniqueId().toString())))show(p,row);}
        else if(slot==27||slot==35)menu(p,m.publicGallery,Math.max(1,m.page+(slot==35?1:-1)));else if(slot==32)menu(p,!m.publicGallery,1);
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void drag(InventoryDragEvent e){if(menus.containsKey(e.getView().getTopInventory()))e.setCancelled(true);}
    @EventHandler public void close(InventoryCloseEvent e){menus.remove(e.getInventory());}
    private JsonObject slots(){return ready()&&ledger.data().has("photoSlots")?ledger.data().getAsJsonObject("photoSlots"):new JsonObject();}
    private String slotOf(String id){for(var s:slots().entrySet())if(s.getValue().getAsJsonObject().has("work")&&s.getValue().getAsJsonObject().get("work").getAsString().equals(id))return s.getKey();return "";}
    void admin(CommandSender sender,String[] args) {
        try {
            if(!ready())throw new IllegalArgumentException("纪念册存储不可用，保留原文件。");
            if(args.length==3&&args[2].equals("gallery-status")){sender.sendMessage("摄影展位："+slots()+"；公开作品："+all().stream().filter(r->r.get("published").getAsBoolean()).count());return;}
            if(args.length!=5||!args[2].equals("gallery-slot")||!args[3].matches("[a-z0-9_]{2,40}"))throw new IllegalArgumentException("控制台：mycli admin photo gallery-slot <展位ID> <1个或4个展示框UUID，逗号分隔，海报按左上/右上/左下/右下>；gallery-status 查询。只登记已有空框。");
            if(slots().has(args[3])||slots().size()>=64)throw new IllegalArgumentException("展位已登记或达到64个上限；不会覆盖原展品。");
            String[] ids=args[4].split(",");if(ids.length!=1&&ids.length!=4||new HashSet<>(List.of(ids)).size()!=ids.length)throw new IllegalArgumentException("展位需要1个或4个不同空展示框。");
            JsonArray frames=new JsonArray();
            Location first=null;
            for(String id:ids){Entity e=Bukkit.getEntity(UUID.fromString(id));if(!(e instanceof ItemFrame frame)||!frame.getItem().getType().isAir()||frame.getPersistentDataContainer().has(exhibitKey))throw new IllegalArgumentException("展示框未加载、非空或已使用；不会移走玩家物品。");
                if(first==null)first=frame.getLocation();else if(first.getWorld()!=frame.getWorld()||first.distanceSquared(frame.getLocation())>9)throw new IllegalArgumentException("同一海报的四个展框应相邻。");
                for(var slot:slots().entrySet())if(slot.getValue().getAsJsonObject().getAsJsonArray("frames").asList().stream().anyMatch(v->v.getAsString().equals(id)))throw new IllegalArgumentException("展示框已属于其他展位。");frames.add(id);
            }
            JsonObject slot=new JsonObject();slot.add("frames",frames);
            JsonArray chunks=new JsonArray();Set<String> seen=new HashSet<>();for(String id:ids){Location at=Objects.requireNonNull(Bukkit.getEntity(UUID.fromString(id))).getLocation();String chunk=at.getWorld().getUID()+":"+(at.getBlockX()>>4)+":"+(at.getBlockZ()>>4);if(seen.add(chunk))chunks.add(chunk);}slot.add("chunks",chunks);
            if(!ledger.write(data->{if(!data.has("photoSlots"))data.add("photoSlots",new JsonObject());data.getAsJsonObject("photoSlots").add(args[3],slot);}))throw new IllegalArgumentException("展位保存失败。");
            reconcile();sender.sendMessage("展位已登记；投稿作品有空位时自动展出。右键作品读故事，原照片留在作者背包。");
        } catch(IllegalArgumentException e){sender.sendMessage(e.getMessage());}
    }
    /** Durable assignment precedes entity changes; reload repairs only our own/empty registered frames. */
    private void reconcile() {
        if(!ready())return;
        registeredFrames.clear();for(var entry:slots().entrySet())for(JsonElement id:entry.getValue().getAsJsonObject().getAsJsonArray("frames"))registeredFrames.add(UUID.fromString(id.getAsString()));
        for(var entry:List.copyOf(slots().entrySet())) {
            JsonObject slot=entry.getValue().getAsJsonObject();List<ItemFrame> frames=new ArrayList<>();boolean loaded=true;
            for(JsonElement id:slot.getAsJsonArray("frames")){Entity entity=Bukkit.getEntity(UUID.fromString(id.getAsString()));if(!(entity instanceof ItemFrame f)){loaded=false;break;}frames.add(f);}
            if(!loaded)continue;
            for(ItemFrame frame:frames){frame.setFixed(true);frame.setItemDropChance(0);}
            String old=slot.has("work")?slot.get("work").getAsString():"";JsonObject work=find(old);
            if(work!=null&&!work.get("published").getAsBoolean())work=null;
            if(work!=null&&!camera.originalExists(work))continue; // unavailable is not deleted/withdrawn
            if(work==null&&!old.isEmpty()) {
                if(!ledger.write(data->data.getAsJsonObject("photoSlots").getAsJsonObject(entry.getKey()).remove("work")))continue;
                for(ItemFrame f:frames)if(old.equals(f.getPersistentDataContainer().get(exhibitKey,PersistentDataType.STRING))){f.setItem(null,false);f.setCustomName("艺术厅空展位 · photo exhibit 投稿");f.getPersistentDataContainer().remove(exhibitKey);}
            }
            if(work==null) {
                if(frames.stream().anyMatch(f->!f.getItem().getType().isAir()))continue;
                work=all().stream().filter(r->r.get("published").getAsBoolean()&&r.getAsJsonArray("mapIds").size()==frames.size()&&slotOf(r.get("id").getAsString()).isEmpty()&&camera.originalExists(r)).findFirst().orElse(null);
                if(work==null)continue;String chosen=work.get("id").getAsString();
                if(!ledger.write(data->data.getAsJsonObject("photoSlots").getAsJsonObject(entry.getKey()).addProperty("work",chosen)))continue;
            }
            String id=work.get("id").getAsString();
            for(int i=0;i<frames.size();i++){ItemFrame f=frames.get(i);if(!f.getItem().getType().isAir()&&!id.equals(f.getPersistentDataContainer().get(exhibitKey,PersistentDataType.STRING)))continue;
                ItemStack image=tile(work,i);if(image==null)continue;f.getPersistentDataContainer().set(exhibitKey,PersistentDataType.STRING,id);f.setFixed(true);f.setItemDropChance(0);f.setRotation(Rotation.NONE);f.setItem(image,false);
                f.setCustomName("《"+work.get("title").getAsString()+"》 · "+work.get("author").getAsString()+" · 右键读故事");f.setCustomNameVisible(true);
            }
        }
    }
    private boolean protectedFrame(Entity e){return e instanceof ItemFrame&&registeredFrames.contains(e.getUniqueId());}
    @EventHandler(priority=EventPriority.HIGHEST) public void interact(PlayerInteractEntityEvent e){if(!protectedFrame(e.getRightClicked()))return;e.setCancelled(true);if(e.getHand()!=EquipmentSlot.HAND)return;String id=e.getRightClicked().getPersistentDataContainer().get(exhibitKey,PersistentDataType.STRING);JsonObject row=id==null?null:find(id);if(row!=null&&row.get("published").getAsBoolean())show(e.getPlayer(),row);else say(e.getPlayer(),"这是艺术厅公共展位。/mycli photo album 查看本人作品，写标题与故事后用 photo exhibit <照片名> 投稿；请勿直接往展框塞物品。");}
    @EventHandler(priority=EventPriority.HIGHEST) public void damage(EntityDamageEvent e){if(protectedFrame(e.getEntity()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void broken(HangingBreakEvent e){if(protectedFrame(e.getEntity()))e.setCancelled(true);}
    @EventHandler public void chunk(ChunkLoadEvent e){if(!ready()||reconcileQueued)return;String key=e.getWorld().getUID()+":"+e.getChunk().getX()+":"+e.getChunk().getZ();
        boolean relevant=slots().entrySet().stream().anyMatch(s->!s.getValue().getAsJsonObject().has("chunks")||s.getValue().getAsJsonObject().getAsJsonArray("chunks").asList().stream().anyMatch(c->c.getAsString().equals(key)));
        if(relevant)queueReconcile();}
    private void queueReconcile(){if(reconcileQueued||!ready())return;reconcileQueued=true;
        Bukkit.getScheduler().runTaskLater(plugin,()->{reconcileQueued=false;reconcile();},20L);}
}
