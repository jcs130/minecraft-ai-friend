package org.afuhome.agentfriend;

import com.google.gson.*;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import net.minecraft.core.component.DataComponents;
import net.minecraft.world.item.component.MapDecorations;
import net.minecraft.world.level.saveddata.maps.MapDecorationTypes;
import org.bukkit.*;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.craftbukkit.inventory.CraftItemStack;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.MapMeta;

/** Exam prerequisites use the existing personal chest, with one atomic allocation receipt. */
final class ExamSupplies {
    private static final String ROOT="exam-supplies-issued.";
    private record Destination(String id,String title,String world,int x,int y,int z,String structure) { }
    private final AgentFriendPlugin plugin;
    private final SkillAssessments exams;
    private final Map<UUID,UUID> pending=new HashMap<>();
    private List<Destination> destinations=List.of();
    private boolean enabled;
    ExamSupplies(AgentFriendPlugin plugin,SkillAssessments exams) {
        this.plugin=plugin;this.exams=exams;
        File file=new File(plugin.getDataFolder(),"exam-supplies.yml");
        if(!file.exists())plugin.saveResource(file.getName(),false);
        try {
            YamlConfiguration cfg=new YamlConfiguration();cfg.load(file);
            if(cfg.getInt("schema-version")!=1||cfg.getMapList("map-targets").size()>8)throw new IllegalArgumentException("schema/target limit");
            List<Destination> rows=new ArrayList<>();Set<String> ids=new HashSet<>();
            for(Map<?,?> row:cfg.getMapList("map-targets")) {
                YamlConfiguration q=new YamlConfiguration();row.forEach((k,v)->q.set(k.toString(),v));
                String id=q.getString("id",""),world=q.getString("world",""),structure=q.getString("structure","");
                String title=q.getString("title","");
                if(!id.matches("[a-z0-9_]{2,40}")||!ids.add(id)||world.isBlank()||world.length()>64||title.isBlank()||title.length()>60
                        ||!structure.matches("[a-z0-9_.-]+:[a-z0-9_/.-]+"))throw new IllegalArgumentException("invalid destination");
                for(String field:List.of("x","y","z"))if(!q.isInt(field))throw new IllegalArgumentException("integer coordinates required");
                int x=q.getInt("x"),y=q.getInt("y"),z=q.getInt("z");
                if(Math.abs((long)x)>29_999_984||Math.abs((long)z)>29_999_984||y< -64||y>319)throw new IllegalArgumentException("coordinates");
                rows.add(new Destination(id,title,world,x,y,z,structure));
            }
            destinations=List.copyOf(rows);enabled=cfg.getBoolean("enabled",true);
        }catch(Exception invalid){plugin.getLogger().warning("Exam supplies unavailable; catalog retained on disk: "+invalid.getMessage());}
    }
    private String path(Player p,String key){return ROOT+p.getUniqueId()+"."+key;}
    private String itemsPath(Player p,String key){return "exam-supplies-items."+p.getUniqueId()+"."+key;}
    private String photoKey(AssessmentCatalog.Definition d){return "photo_"+d.id();}
    private boolean issued(Player p,String key){return plugin.getConfig().contains(path(p,key));}
    private String mapRunPath(Player p){return "exam-supplies-map-runs."+p.getUniqueId()+"."+exams.supplyRun(p);}
    private static String mapKey(World world,Destination d){return "map_"+UUID.nameUUIDFromBytes((world.getUID()+":"+d.x+":"+d.z).getBytes(StandardCharsets.UTF_8)).toString().replace("-","");}
    private Destination nextMap(Player p) {
        JsonObject active=plugin.taskMarket()==null?null:plugin.taskMarket().examRequirements(p);
        JsonArray required=active!=null&&active.has("exploration")&&active.get("goal").getAsString().equals("STRUCTURE")?active.getAsJsonObject("exploration").getAsJsonArray("keys"):null;
        for(Destination d:destinations) {
            if(required!=null&&!required.isEmpty()&&required.asList().stream().noneMatch(key->key.getAsString().equals(d.structure)))continue;
            World world=Bukkit.getWorld(d.world);
            if(world!=null&&!issued(p,mapKey(world,d))&&!MapObjectives.destinationClaimed(plugin,p,world.getUID(),d.x,d.z))return d;
        }
        return null;
    }
    JsonObject status(Player p,AssessmentCatalog.Definition d,String kind) {
        JsonObject out=new JsonObject();out.addProperty("id",kind);out.addProperty("providedBy","exam");
        out.addProperty("storage","personal_chest");out.addProperty("free",true);
        if(kind.equals("photo")) {
            out.addProperty("name","摄影直接成片");out.addProperty("status","not_required");
            out.addProperty("required",false);out.addProperty("count",0);
            out.addProperty("advice","摄影无需空地图或主背包空位；实际拍摄耗魔力，成片自动入个人奖励箱。已发旧地图保留，可继续用take photo取出。");
            out.addProperty("nextCommand","/mycli photo menu");return out;
        }
        boolean relevant=d!=null&&d.proofs().contains("survey");
        String key=d==null?"":plugin.getConfig().getString(mapRunPath(p),"");
        out.addProperty("name","遗迹探险图 · 带真实目标");
        String reason=!enabled?"supplies_unavailable":!relevant?"not_required_by_exam":!key.isEmpty()&&issued(p,key)?"already_issued"
                :kind.equals("map")&&nextMap(p)==null?"no_new_chart_destination":"requestable";
        out.addProperty("status",reason);out.addProperty("required",false);
        out.addProperty("count",1);out.addProperty("item","minecraft:filled_map");
        out.addProperty("advice","仅原图寻宝路线需要；普通走查不需要。领取时核验公会已勘察的天然遗迹，发真正有目标标记的地图，非空白图。每人每个目的地提供一次。");
        if(reason.equals("requestable"))out.addProperty("claimCommand","/mycli guild exam supplies claim "+kind);
        if(!key.isEmpty()&&issued(p,key)) {
            JsonObject allocation=JsonParser.parseString(plugin.getConfig().getString(path(p,key))).getAsJsonObject();out.add("allocation",allocation);
            if(allocation.has("map"))out.add("map",allocation.get("map").deepCopy());
            for(var value:allocation.getAsJsonArray("items"))if(value.getAsJsonObject().has("page")){out.addProperty("nextCommand","/mycli arena stash page "+value.getAsJsonObject().get("page").getAsInt());break;}
        }
        out.addProperty("openCommand","/mycli arena stash");out.addProperty("takeCommand","/mycli guild exam supplies take "+kind);return out;
    }
    JsonObject all(Player p,AssessmentCatalog.Definition d) {
        JsonObject out=new JsonObject();JsonArray items=new JsonArray();for(String kind:List.of("photo","map"))items.add(status(p,d,kind));
        out.add("items",items);out.addProperty("status",pending.containsKey(p.getUniqueId())?"checking_destination":"idle");
        out.addProperty("nextCommand","/mycli guild exam supplies list");return out;
    }
    void automaticPhoto(Player p,AssessmentCatalog.Definition d,UUID run,Consumer<JsonObject> reply) {
        // Photography now creates original map tiles directly in the reward chest.
        // Keep old allocation receipts and take-photo compatibility, but issue no new blank maps.
    }
    void claim(Player p,AssessmentCatalog.Definition d,UUID run,String kind,Consumer<JsonObject> reply) {
        JsonObject out=status(p,d,kind);out.addProperty("type","supplies");out.addProperty("action","claim");out.addProperty("runId",run.toString());
        if(!exams.canSupply(p,run)){finish(out,false,"active_exam_required",reply);return;}
        if(kind.equals("photo")){out.addProperty("ok",true);out.addProperty("reason","photo_materials_not_required");out.addProperty("changed",false);reply.accept(out);return;}
        if(!out.get("status").getAsString().equals("requestable")){finish(out,out.get("status").getAsString().equals("already_issued"),out.get("status").getAsString(),reply);return;}
        if(pending.containsKey(p.getUniqueId())){finish(out,false,"checking_destination",reply);return;}
        if(pending.size()>=4){finish(out,false,"destination_check_busy",reply);return;}
        Destination destination=nextMap(p);World world=Bukkit.getWorld(destination.world);
        if(!world.getWorldBorder().isInside(new Location(world,destination.x,destination.y,destination.z))){finish(out,false,"map_target_outside_world_border",reply);return;}
        pending.put(p.getUniqueId(),run);
        out.addProperty("status","pending");out.addProperty("reason","checking_existing_natural_structure");out.addProperty("nextCommand","/mycli guild exam supplies status");reply.accept(out.deepCopy());
        // Load at most 25 EXISTING chunks, asynchronously, only on an explicit claim.
        // Status/info/start never locate, scan the world, or generate distant terrain.
        List<CompletableFuture<Chunk>> loads=new ArrayList<>();
        int cx=destination.x>>4,cz=destination.z>>4;
        for(int x=cx-2;x<=cx+2;x++)for(int z=cz-2;z<=cz+2;z++)loads.add(world.getChunkAtAsync(x,z,false));
        CompletableFuture.allOf(loads.toArray(CompletableFuture[]::new)).whenComplete((ignored,error)->Bukkit.getScheduler().runTask(plugin,()->{
            List<Chunk> held=new ArrayList<>();
            try {
                if(!p.isOnline()||!exams.canSupply(p,run)) {if(p.isOnline())finish(out,false,"exam_changed",reply);return;}
                if(error!=null){finish(out,false,"destination_load_failed",reply);return;}
                // Async completion alone does not keep a remote chunk available to
                // the native structure reader. Hold only the 25 verified EXISTING
                // chunks during this synchronous check; never generate or retain them.
                // Main-thread callbacks cannot interleave, and only tickets we added
                // are removed, preserving dungeon/waypoint tickets owned elsewhere.
                for(CompletableFuture<Chunk> load:loads){
                    Chunk chunk=load.join();
                    if(chunk==null){finish(out,false,"destination_load_failed",reply);return;}
                    if(chunk.addPluginChunkTicket(plugin))held.add(chunk);
                }
                Location at=new Location(world,destination.x,destination.y,destination.z);
                var place=ExplorationObjectives.mapPlace(at,destination.x,destination.z);
                if(place==null||!place.key().equals(destination.structure)||place.key().equals("minecraft:buried_treasure")) {
                    finish(out,false,"natural_destination_unverified",reply);return;
                }
                String key=mapKey(world,destination);
                if(issued(p,key)||MapObjectives.destinationClaimed(plugin,p,world.getUID(),destination.x,destination.z)){finish(out,false,"destination_already_used",reply);return;}
                var view=Bukkit.createMap(world);view.setCenterX(destination.x);view.setCenterZ(destination.z);view.setScale(org.bukkit.map.MapView.Scale.NORMAL);view.setTrackingPosition(true);
                ItemStack item=new ItemStack(Material.FILLED_MAP);MapMeta meta=(MapMeta)item.getItemMeta();meta.setMapView(view);
                meta.setDisplayName("公会探险图 · "+destination.title);
                meta.setLore(List.of("考试提供的天然遗迹探险图","主手持图 → 接取 tm_map_hunt","亲自走查、现场拍照，再回接单点交付","不是埋藏宝箱，不要求挖掘或清空遗迹"));item.setItemMeta(meta);
                var nativeItem=CraftItemStack.asNMSCopy(item);
                nativeItem.set(DataComponents.MAP_DECORATIONS,new MapDecorations(Map.of("exam_target",new MapDecorations.Entry(MapDecorationTypes.TARGET_X,destination.x,destination.z,180F))));
                item=CraftItemStack.asBukkitCopy(nativeItem);
                JsonObject target=new JsonObject();target.addProperty("dimension",world.getKey().toString());target.addProperty("worldUuid",world.getUID().toString());
                target.addProperty("x",destination.x);target.addProperty("z",destination.z);target.addProperty("heightKnown",false);
                target.addProperty("structure",place.key());target.addProperty("mapId",view.getId());target.addProperty("source","verified_public_natural_structure");
                out.add("map",target);out.addProperty("nextCommand","/mycli guild map");
                allocate(p,key,run,List.of(item),out,reply);
            }finally{for(Chunk chunk:held)chunk.removePluginChunkTicket(plugin);pending.remove(p.getUniqueId(),run);}
        }));
    }
    private record Move(String key,int row,int slot,int queue,ItemStack item) { }
    /** Free checkout of issued prerequisites only; never grants access to unrelated chest items. */
    void take(Player p,AssessmentCatalog.Definition d,UUID run,String kind,Consumer<JsonObject> reply) {
        JsonObject out=new JsonObject();out.addProperty("type","supplies");out.addProperty("action","take");out.addProperty("id",kind);out.addProperty("runId",run.toString());
        out.addProperty("nextCommand","/mycli guild exam supplies status");
        if(!exams.canSupply(p,run)){finish(out,false,"active_exam_required",reply);return;}
        List<String> keys=new ArrayList<>();if(!kind.equals("map"))keys.add(photoKey(d));
        if(!kind.equals("photo")){String key=plugin.getConfig().getString(mapRunPath(p),"");if(!key.isEmpty())keys.add(key);}
        var dungeon=plugin.dungeon();UUID owner=p.getUniqueId();String queuePath="dungeon-bonus-items."+owner;
        List<ItemStack> queue=new ArrayList<>();for(Object value:plugin.getConfig().getList(queuePath,List.of()))if(value instanceof ItemStack item)queue.add(item.clone());
        List<ItemStack> oldQueue=new ArrayList<>(queue);Map<String,String> oldReceipts=new LinkedHashMap<>();Map<String,JsonObject> receipts=new LinkedHashMap<>();List<Move> moves=new ArrayList<>();
        for(String key:keys)if(issued(p,key)) {
            String raw=plugin.getConfig().getString(path(p,key));JsonObject receipt=JsonParser.parseString(raw).getAsJsonObject();oldReceipts.put(key,raw);receipts.put(key,receipt);
            List<?> originals=plugin.getConfig().getList(itemsPath(p,key),List.of());JsonArray rows=receipt.getAsJsonArray("items");
            for(int i=0;i<rows.size();i++) {
                JsonObject row=rows.get(i).getAsJsonObject();if(row.has("taken")&&row.get("taken").getAsBoolean()||i>=originals.size()||!(originals.get(i) instanceof ItemStack expected))continue;
                int slot=row.has("slot")?row.get("slot").getAsInt()-1:-1,q=-1;ItemStack source=slot<0?null:dungeon.stashItem(owner,slot);
                if(slot<0)for(int n=0;n<queue.size();n++)if(queue.get(n)!=null&&queue.get(n).isSimilar(expected)&&queue.get(n).getAmount()==expected.getAmount()){q=n;source=queue.set(n,null);break;}
                if(source==null||!source.isSimilar(expected)||source.getAmount()!=expected.getAmount())continue;
                moves.add(new Move(key,i,slot,q,source.clone()));
            }
        }
        if(moves.isEmpty()){
            boolean taken=!receipts.isEmpty()&&receipts.values().stream().allMatch(receipt->receipt.getAsJsonArray("items").asList().stream().allMatch(value->value.getAsJsonObject().has("taken")&&value.getAsJsonObject().get("taken").getAsBoolean()));
            out.addProperty("advice","这份材料已取出、移动，或尚未领取；先查本人背包和allocation记录。不会按缺失物重新生成。");finish(out,taken,taken?"already_taken":"already_taken_or_moved",reply);return;
        }
        ItemStack[] before=p.getInventory().getStorageContents();var simulated=Bukkit.createInventory(null,36);simulated.setContents(before);
        for(Move move:moves)if(!simulated.addItem(move.item.clone()).isEmpty()){out.addProperty("advice","主背包先腾出空间；本次材料保留原处，没有掉地或扣除。");finish(out,false,"inventory_full",reply);return;}
        try {
            for(Move move:moves){if(move.slot>=0)dungeon.setStashItem(owner,move.slot,null);JsonObject row=receipts.get(move.key).getAsJsonArray("items").get(move.row).getAsJsonObject();row.addProperty("taken",true);row.addProperty("takenAt",System.currentTimeMillis());}
            plugin.getConfig().set(queuePath,queue.stream().filter(Objects::nonNull).toList());
            receipts.forEach((key,receipt)->plugin.getConfig().set(path(p,key),receipt.toString()));
            p.getInventory().setStorageContents(simulated.getContents());p.saveData();atomicConfig();
        }catch(Exception failure){
            p.getInventory().setStorageContents(before);for(Move move:moves)if(move.slot>=0)dungeon.setStashItem(owner,move.slot,move.item.clone());
            plugin.getConfig().set(queuePath,oldQueue);oldReceipts.forEach((key,raw)->plugin.getConfig().set(path(p,key),raw));p.saveData();finish(out,false,"supply_save_failed",reply);return;
        }
        JsonArray items=new JsonArray();for(Move move:moves){JsonObject row=new JsonObject();row.addProperty("item","minecraft:"+move.item.getType().name().toLowerCase(Locale.ROOT));row.addProperty("count",move.item.getAmount());items.add(row);}
        out.add("items",items);out.addProperty("saved",true);out.addProperty("free",true);out.addProperty("storage","player_inventory");out.addProperty("nextCommand","/mycli guild exam status");
        out.addProperty("advice","考试材料已直接放入主背包，无需先学习传送术或支付魔力；图拿到主手后guild map查看目标。");finish(out,true,"taken_into_inventory",reply);
    }
    private void finish(JsonObject out,boolean ok,String reason,Consumer<JsonObject> reply){out.addProperty("ok",ok);out.addProperty("status",ok?"allocated":"denied");out.addProperty("reason",reason);reply.accept(out);}
    private void allocate(Player p,String key,UUID run,List<ItemStack> items,JsonObject out,Consumer<JsonObject> reply) {
        UUID owner=p.getUniqueId();var dungeon=plugin.dungeon();
        if(issued(p,key)){finish(out,true,"already_issued",reply);return;}
        List<Integer> free=new ArrayList<>();for(int i=0;i<PagedPersonalStash.CAPACITY&&free.size()<items.size();i++)if(dungeon.stashItem(owner,i)==null||dungeon.stashItem(owner,i).getType().isAir())free.add(i);
        if(free.size()<items.size()&&dungeon.queuedItems(owner)+items.size()-free.size()>1024){finish(out,false,"personal_storage_full",reply);return;}
        Object previousQueue=plugin.getConfig().get("dungeon-bonus-items."+owner);
        String assignment=mapRunPath(p);Object previousAssignment=plugin.getConfig().get(assignment);
        Object previousItems=plugin.getConfig().get(itemsPath(p,key));
        JsonObject receipt=new JsonObject();receipt.addProperty("runId",run.toString());receipt.addProperty("issuedAt",System.currentTimeMillis());
        JsonArray allocations=new JsonArray();int index=0;
        try {
            for(ItemStack item:items) {
                JsonObject row=new JsonObject();row.addProperty("item","minecraft:"+item.getType().name().toLowerCase(Locale.ROOT));row.addProperty("count",item.getAmount());
                if(index<free.size()) {int slot=free.get(index++);dungeon.setStashItem(owner,slot,item.clone());row.addProperty("slot",slot+1);row.addProperty("page",slot/54+1);row.addProperty("queued",false);}
                else {if(!dungeon.queuePurchased(owner,item))throw new IllegalStateException("queue full");row.addProperty("queued",true);}
                allocations.add(row);
            }
            receipt.add("items",allocations);if(out.has("map"))receipt.add("map",out.get("map").deepCopy());
            plugin.getConfig().set(path(p,key),receipt.toString());
            plugin.getConfig().set(itemsPath(p,key),items.stream().map(ItemStack::clone).toList());
            if(out.has("map"))plugin.getConfig().set(assignment,key);
            atomicConfig();
        }catch(Exception failed) {
            for(int slot:free)dungeon.setStashItem(owner,slot,null);
            plugin.getConfig().set("dungeon-bonus-items."+owner,previousQueue);plugin.getConfig().set(path(p,key),null);
            plugin.getConfig().set(assignment,previousAssignment);
            plugin.getConfig().set(itemsPath(p,key),previousItems);
            plugin.getLogger().warning("Exam supply allocation rolled back for "+owner+": "+failed.getClass().getSimpleName());
            finish(out,false,"supply_save_failed",reply);return;
        }
        out.add("allocation",receipt);out.addProperty("saved",true);out.addProperty("storage","personal_chest");
        out.addProperty("nextCommand","/mycli guild exam supplies take all");
        out.addProperty("advice","材料已发到本人个人箱；supplies take all免费直接取到主背包，或按allocation的页码/槽位正常取出。探险图拿到主手后guild map查真实目标，再接tm_map_hunt。重复领取不会多发。");
        finish(out,true,"allocated_to_personal_storage",reply);
    }
    private void atomicConfig() throws Exception {
        Path file=plugin.getDataFolder().toPath().resolve("config.yml"),temp=file.resolveSibling("config.yml.exam-supplies.tmp");
        byte[] bytes=plugin.getConfig().saveToString().getBytes(StandardCharsets.UTF_8);
        try(FileChannel channel=FileChannel.open(temp,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING,StandardOpenOption.WRITE)) {
            ByteBuffer buffer=ByteBuffer.wrap(bytes);while(buffer.hasRemaining())channel.write(buffer);channel.force(true);
        }
        Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
    }
}
