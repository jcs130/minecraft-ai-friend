package org.qiandengji.mcbot;

import com.dwinovo.numen.api.entity.NumenPlayer;
import com.google.gson.*;
import net.minecraft.core.BlockPos;
import org.bukkit.*;
import org.bukkit.block.*;
import org.bukkit.entity.*;
import org.bukkit.inventory.*;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.loot.Lootable;
import java.util.*;
import java.util.Comparator;
import java.util.concurrent.*;

/** Projections and adapters; world and item writes use the existing native APIs. */
public final class Toolbox {
    public record Result(boolean ok,String feedback,JsonObject data){
        public static Result ok(String text,JsonObject data){return new Result(true,text,data);}
    }
    private final NumenPlayer body;
    private final Player player;
    private final NativeCalls calls;
    public Toolbox(NumenPlayer body,NativeCalls calls){this.body=body;this.player=(Player)body.getBukkitEntity();this.calls=calls;}
    private static <T> CompletableFuture<T> ready(T value){return CompletableFuture.completedFuture(value);}
    private static JsonObject object(Object... pairs){JsonObject o=new JsonObject();for(int i=0;i<pairs.length;i+=2)o.add(pairs[i].toString(),new Gson().toJsonTree(pairs[i+1]));return o;}
    public CompletableFuture<Result> execute(String tool,JsonObject a){
        return switch(tool){
            case "status"->{Policy.keys(a,"details","recovery");yield ready(status(Wire.bool(a,"details",false)));}
            case "inventory"->{Policy.keys(a);yield ready(Result.ok("本人实时背包与装备；槽位不是物品名称。",inventory()));}
            case "equip"->equip(a);
            case "consume"->{Policy.keys(a,"slot");int slot=(int)Wire.integer(a,"slot",0,35);ItemStack stack=player.getInventory().getItem(slot);if(stack==null||stack.getType().isAir())throw new IllegalArgumentException("槽位为空");body.hotbar().hold(slot);yield nativeResult("numen.inv.eat",List.of(id(stack.getType())),Map.of(),"进食终态");}
            case "move_to"->{Policy.keys(a,"x","y","z","may_alter_terrain","authorization_id","walk_only");Wire.bool(a,"walk_only",false);Wire.bool(a,"may_alter_terrain",false);if(a.has("authorization_id"))Wire.string(a,"authorization_id",1,64);Map<String,Object> at=pos(a,64);yield nativeResult("numen.move.to",List.of(at),Map.of(),"移动终态；核对实际位置");}
            case "follow"->{Policy.keys(a,"target_uuid","distance","seconds","protect_owner");if(Wire.bool(a,"protect_owner",false))throw new IllegalArgumentException("当前Paper后端不支持护卫自动攻击，未开始跟随。");int distance=a.has("distance")?(int)Wire.integer(a,"distance",2,16):3;int seconds=a.has("seconds")?(int)Wire.integer(a,"seconds",1,120):60;
                List<Object> args=new ArrayList<>();if(a.has("target_uuid")){Entity target=player.getWorld().getEntity(UUID.fromString(Wire.string(a,"target_uuid",36,36)));if(target==null||!player.hasLineOfSight(target))throw new IllegalArgumentException("跟随目标当前不可见");args.add(target.getEntityId());}yield nativeResult("numen.move.follow",args,Map.of("distance",distance,"seconds",seconds),"跟随终态");}
            case "wait"->{Policy.keys(a,"seconds","ticks");if(a.has("seconds")==a.has("ticks"))throw new IllegalArgumentException("seconds/ticks须二选一");double seconds=a.has("seconds")?Wire.integer(a,"seconds",1,60):Wire.integer(a,"ticks",1,1200)/20d;yield nativeResult("numen.time.wait",List.of(seconds),Map.of(),"等待已结束；工艺产物须另查");}
            case "break_block"->breakBlock(a);
            case "place_block"->placeBlock(a);
            case "scan_area"->scan(a);
            case "find_resource"->find(a);
            case "inspect_block"->ready(inspect(a));
            case "craft"->craft(a);
            case "transfer"->new Containers(body,calls).transfer(a);
            case "smelt"->new Containers(body,calls).smelt(a);
            case "attack"->attack(a);
            case "collect"->collect(a);
            case "command"->{Policy.keys(a,"command");String command=Policy.command(Wire.string(a,"command",1,240));yield calls.call("numen.mc.run",List.of(command),Map.of()).thenApply(value->{JsonObject d=value.isJsonObject()?value.getAsJsonObject():object("result",value);d.addProperty("command_dispatched",true);d.addProperty("gameplay_verified",false);return Result.ok("命令已交给本人游戏角色；这不表示任务完成或施法成功。请按服务器回执查询核对。\n"+value,d);});}
            case "use_item"->{Policy.keys(a,"seconds");double seconds=a.has("seconds")?Wire.integer(a,"seconds",1,10):1;yield nativeResult("numen.use.item",List.of(),Map.of("hold",seconds),"原生持物交互终态");}
            case "use_block"->{Policy.keys(a,"x","y","z");yield nativeResult("numen.use.block",List.of(pos(a,5.5)),Map.of(),"原生方块交互终态");}
            default->throw new IllegalArgumentException("当前Paper后端尚未实现 "+tool+"，未执行。请使用已公布能力。");
        };
    }
    private CompletableFuture<Result> nativeResult(String function,List<Object> args,Map<String,Object> options,String label){
        return calls.call(function,args,options).thenApply(value->Result.ok(label+"："+value,object("native",value,"x",body.getX(),"y",body.getY(),"z",body.getZ())));
    }
    private CompletableFuture<Result> breakBlock(JsonObject a){
        Policy.keys(a,"x","y","z");Map<String,Object> at=pos(a,6);
        Block target=player.getWorld().getBlockAt((int)at.get("x"),(int)at.get("y"),(int)at.get("z"));Material before=target.getType();
        return calls.call("numen.work.dig",List.of(at),Map.of("count",1)).thenApply(value->{boolean changed=before!=target.getType();return new Result(changed,changed?"目标格已实际挖除；掉落和拾取另核对。":"目标格未挖除；检查保护、工具和原生缺项，勿把程序收尾当作成功。",object("native",value,"changed",changed,"block_before",id(before),"block_after",id(target.getType())));});
    }
    private CompletableFuture<Result> placeBlock(JsonObject a){
        Policy.keys(a,"x","y","z","item","face");Map<String,Object> at=pos(a,6);String item=Policy.item(a,"item");
        if(a.has("face")&&!Wire.string(a,"face",1,8).equals("up"))throw new IllegalArgumentException("该Paper放置入口尚不支持强制接触面；未放置。");
        Block target=player.getWorld().getBlockAt((int)at.get("x"),(int)at.get("y"),(int)at.get("z"));
        return calls.call("numen.build.place",List.of(List.of(Map.of("name",item,"pos",at))),Map.of()).thenApply(value->{boolean placed=id(target.getType()).equals(item);return new Result(placed,placed?"目标格已核对为请求方块；实际消耗以库存为准。":"目标格未放置成功；检查保护或原生缺项，未自动重放。",object("native",value,"placed",placed,"block_after",id(target.getType())));});
    }
    private Map<String,Object> pos(JsonObject a,double distance){
        int x=(int)Wire.integer(a,"x",-29999984,29999984),y=(int)Wire.integer(a,"y",player.getWorld().getMinHeight(),player.getWorld().getMaxHeight()-1),z=(int)Wire.integer(a,"z",-29999984,29999984);
        if(!player.getWorld().isChunkLoaded(x>>4,z>>4))throw new IllegalArgumentException("目标区块未加载；先在已知范围内接近。");
        if(player.getLocation().distanceSquared(new Location(player.getWorld(),x+.5,y+.5,z+.5))>distance*distance)throw new IllegalArgumentException("目标超过本工具距离；先移动并重新查询。");
        return Map.of("x",x,"y",y,"z",z);
    }
    public JsonObject inventory(){
        JsonObject d=object("selected_slot",player.getInventory().getHeldItemSlot(),"storage_size",36,"mining_tools_known",true);
        JsonArray slots=new JsonArray(),armor=new JsonArray();int used=0;
        for(int i=0;i<36;i++){ItemStack stack=player.getInventory().getItem(i);JsonObject s=stack(stack);s.addProperty("slot",i);slots.add(s);if(stack!=null&&!stack.getType().isAir())used++;}
        String[] names={"feet","legs","chest","head","offhand"};ItemStack[] values={player.getInventory().getBoots(),player.getInventory().getLeggings(),player.getInventory().getChestplate(),player.getInventory().getHelmet(),player.getInventory().getItemInOffHand()};
        for(int i=0;i<names.length;i++){JsonObject s=stack(values[i]);s.addProperty("slot",names[i]);armor.add(s);}
        d.add("slots",slots);d.add("equipment",armor);d.addProperty("slots_used",used);return d;
    }
    public static JsonObject stack(ItemStack s){
        JsonObject d=object("item",s==null||s.getType().isAir()?"":id(s.getType()),"count",s==null||s.getType().isAir()?0:s.getAmount());
        if(s!=null&&!s.getType().isAir()){
            d.addProperty("mining_tool",s.getType().name().matches(".*_(PICKAXE|AXE|SHOVEL|HOE)")||s.getType()==Material.SHEARS);
            if(s.getItemMeta() instanceof Damageable damage){d.addProperty("damage",damage.getDamage());d.addProperty("max_damage",s.getType().getMaxDurability());}
            if(s.hasItemMeta()&&s.getItemMeta().hasDisplayName())d.addProperty("display_name",s.getItemMeta().getDisplayName().replaceAll("§.","").substring(0,Math.min(80,s.getItemMeta().getDisplayName().replaceAll("§.","").length())));
        }return d;
    }
    private Result status(boolean details){
        JsonObject inv=inventory(),d=object("x",body.blockPosition().getX(),"y",body.blockPosition().getY(),"z",body.blockPosition().getZ(),"dimension",player.getWorld().getKey().toString(),
                "hp",player.getHealth(),"food",player.getFoodLevel(),"held",id(player.getInventory().getItemInMainHand().getType()),"on_fire",player.getFireTicks()>0,"game_tick",player.getWorld().getFullTime(),
                "on_ground",body.onGround(),"in_water",body.isInWater(),"in_lava",body.isInLava(),"air_supply",body.getAirSupply(),"max_air_supply",body.getMaxAirSupply(),"slots_used",inv.get("slots_used"));
        if(details)d.add("inventory",inv);
        var rpg=Bukkit.getPluginManager().getPlugin("QiandengjiRpg");
        if(rpg!=null&&rpg.isEnabled())try{d.add("rpg",JsonParser.parseString((String)rpg.getClass().getMethod("selfState",Player.class).invoke(rpg,player)));}
        catch(ReflectiveOperationException|RuntimeException unavailable){d.add("rpg",object("available",false,"next_command","/mycli status"));}
        d.add("paper_backend",object("name","QiandengjiMcbot","version","0.1.0","native_executor","Numen","next_command","/mycli status","gameplay_extensions",List.of("command","use_item","use_block"),"client_extension_required",true));
        return Result.ok("本人实时位置、生命和库存；任务耗时不代表完成率。Paper后端复用Numen权限。RPG从 /mycli status 开始；原mcbot客户端需公开command扩展才能自主执行游戏命令。",d);
    }
    private CompletableFuture<Result> equip(JsonObject a){
        Policy.keys(a,"slot","target");int slot=(int)Wire.integer(a,"slot",0,35);
        String target=a.has("target")?Wire.string(a,"target",1,16):"mainhand";
        if(!target.equals("mainhand")&&!target.equals("main"))throw new IllegalArgumentException("当前兼容入口只支持精确槽位切主手；未改动护甲或副手。");
        if(body.containerMenu!=body.inventoryMenu)throw new IllegalArgumentException("已有窗口打开；先关闭再换装。");
        ItemStack source=player.getInventory().getItem(slot);if(source==null||source.getType().isAir())throw new IllegalArgumentException("指定槽位为空");
        ItemStack expected=source.clone();body.hotbar().hold(slot);body.inventoryMenu.broadcastChanges();
        if(!expected.equals(player.getInventory().getItemInMainHand()))throw new IllegalStateException("主手尚未核对成功；先查看inventory，不要重放。");
        return ready(Result.ok("主手已按实际槽位切换；原组件和耐久保留。",inventory()));
    }
    private CompletableFuture<Result> find(JsonObject a){
        Policy.keys(a,"targets","r");JsonArray targets=a.getAsJsonArray("targets");if(targets==null||targets.size()<1||targets.size()>8)throw new IllegalArgumentException("targets须1至8种方块或标签");
        List<Object> ids=new ArrayList<>();for(JsonElement e:targets){if(!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isString()||!e.getAsString().matches("#?[a-z0-9_.:/-]{1,128}"))throw new IllegalArgumentException("无效目标ID");ids.add(e.getAsString());}
        int radius=a.has("r")?(int)Wire.integer(a,"r",1,16):8;
        return calls.call("numen.scan.blocks",ids,Map.of("radius",radius)).thenApply(value->{JsonArray list=resources(value);return Result.ok("只读可见资源候选；不证明可达、可采收或实际掉落。",object("targets",list,"radius",radius,"scan_center",Map.of("x",body.getX(),"y",body.getY(),"z",body.getZ()),"results_truncated",list.size()>=16,"work_checked",false));});
    }
    private JsonArray resources(JsonElement value){
        JsonArray out=new JsonArray();if(!value.isJsonArray())return out;
        for(JsonElement row:value.getAsJsonArray()){
            if(!row.isJsonObject())continue;JsonObject group=row.getAsJsonObject();JsonElement n=group.get("nearest");
            if(n==null||!n.isJsonObject())continue;JsonObject nearest=n.getAsJsonObject(),p=nearest.has("pos")?nearest.getAsJsonObject("pos"):nearest;
            if(!p.has("x")||!p.has("y")||!p.has("z"))continue;
            if(!Perception.visible(body,new BlockPos(p.get("x").getAsInt(),p.get("y").getAsInt(),p.get("z").getAsInt())))continue;
            JsonObject target=p.deepCopy();target.add("block",nearest.has("name")?nearest.get("name"):new JsonPrimitive("unknown"));target.addProperty("work_checked",false);out.add(target);if(out.size()==16)break;
        }return out;
    }
    private CompletableFuture<Result> scan(JsonObject a){
        Policy.keys(a,"r","items_only");int radius=a.has("r")?(int)Wire.integer(a,"r",1,32):16;
        boolean items=Wire.bool(a,"items_only",false);List<Object> kinds=items?List.of("item"):List.of();
        return calls.call("numen.scan.entities",kinds,Map.of("radius",radius)).thenCompose(value->{
            JsonArray entities=new JsonArray();if(value.isJsonArray())for(JsonElement row:value.getAsJsonArray()){
                if(!row.isJsonObject())continue;JsonObject e=row.getAsJsonObject().deepCopy();
                if(e.has("id")){int id=e.get("id").getAsInt();var nativeEntity=body.serverLevel().getEntity(id);if(nativeEntity==null)continue;e.addProperty("entity_id",id);e.addProperty("target_uuid",nativeEntity.getUUID().toString());}
                e.addProperty("hostile",e.has("category")&&e.get("category").getAsString().equals("hostile"));entities.add(e);if(entities.size()==64)break;
            }
            JsonObject data=object("entities",entities,"entity_targets",entities,"radius",radius,"groups",List.of(),"truncated",entities.size()>=64);
            if(items){data.add("special_blocks",new JsonArray());return ready(Result.ok("附近实际可见掉落物；未出现不等于不存在。",data));}
            return calls.call("numen.scan.blocks",List.of("crafting_table","furnace","blast_furnace","smoker","chest","barrel","anvil","enchanting_table"),Map.of("radius",Math.min(radius,8))).thenCompose(blocks->{
                data.add("special_blocks",resources(blocks));
                return calls.call("numen.scan.map",List.of(),Map.of("radius",Math.clamp(radius,4,8))).thenApply(map->{data.add("terrain",map);return Result.ok("可见实体、附近工位和脚下地形；资源用find_resource，未读取区域不当作空地。",data);});
            });
        });
    }
    private Result inspect(JsonObject a){
        Policy.keys(a,"x","y","z","offset");Map<String,Object> at=pos(a,6.5);Block block=player.getWorld().getBlockAt((int)at.get("x"),(int)at.get("y"),(int)at.get("z"));BlockState state=block.getState();
        if(!Perception.visible(body,block))throw new IllegalArgumentException("方块被遮挡；不能透过墙读取容器。");
        JsonObject data=object("x",block.getX(),"y",block.getY(),"z",block.getZ(),"block",id(block.getType()),"dimension",player.getWorld().getKey().toString());
        if(state instanceof Container c){
            if(c.isLocked()||state instanceof Lootable l&&l.getLootTable()!=null)throw new IllegalArgumentException("锁定或未展开战利品容器不能只读窥视。");
            Inventory inv=c.getInventory();int offset=a.has("offset")?(int)Wire.integer(a,"offset",0,1023):0;
            JsonArray slots=new JsonArray();for(int i=offset;i<Math.min(offset+24,inv.getSize());i++){JsonObject row=stack(inv.getItem(i));row.addProperty("slot",i);slots.add(row);}
            data.addProperty("container",true);data.add("slots",slots);data.addProperty("slot_count",inv.getSize());data.addProperty("next_offset",offset+24<inv.getSize()?offset+24:-1);data.addProperty("contents_complete",offset==0&&inv.getSize()<=24);
        }else data.addProperty("container",false);
        return Result.ok("只读方块和本体容器快照；未打开窗口或移动物品。",data);
    }
    private CompletableFuture<Result> craft(JsonObject a){
        Policy.keys(a,"item","count","query","recipe");String item=Policy.item(a,"item");int count=a.has("count")?(int)Wire.integer(a,"count",1,64):1;boolean query=Wire.bool(a,"query",false);
        String chosen=a.has("recipe")?Policy.item(a,"recipe"):null;
        return calls.call("numen.inv.recipes",List.of(item),Map.of()).thenCompose(value->{
            if(!value.isJsonArray())throw new IllegalStateException("原生配方结果不可用");
            JsonObject selected=null;for(JsonElement row:value.getAsJsonArray()){
                if(!row.isJsonObject())continue;JsonObject recipe=row.getAsJsonObject();if(!recipe.has("grid"))continue;
                if(chosen!=null&&!recipe.get("id").getAsString().equals(chosen))continue;
                if(selected==null)selected=recipe;
                if(!recipe.has("missing")||recipe.get("missing").isJsonNull()||recipe.getAsJsonArray("missing").isEmpty()){selected=recipe;break;}
            }
            if(selected==null)throw new IllegalArgumentException("没有匹配的普通合成配方");
            int grid=selected.get("grid").getAsInt();Block table=null;
            if(grid==3){
                Location at=player.getLocation();double nearest=25;
                for(int x=at.getBlockX()-4;x<=at.getBlockX()+4;x++)for(int z=at.getBlockZ()-4;z<=at.getBlockZ()+4;z++)for(int y=at.getBlockY()-2;y<=at.getBlockY()+2;y++){
                    if(!player.getWorld().isChunkLoaded(x>>4,z>>4))continue;Block block=player.getWorld().getBlockAt(x,y,z);
                    if(block.getType()!=Material.CRAFTING_TABLE)continue;double d=block.getLocation().add(.5,.5,.5).distanceSquared(at);
                    if(d<nearest&&Perception.visible(body,block)){nearest=d;table=block;}
                }
            }
            boolean materials=!selected.has("missing")||selected.get("missing").isJsonNull()||selected.getAsJsonArray("missing").isEmpty();
            if(query)return ready(Result.ok("原生配方预览；can_craft_once只判断一次配方，不代表整批足够；查询不制作。",object("query",true,"recipes",value,"selected",selected,"requested_count",count,"can_craft_once",materials&&(grid==2||grid==3&&table!=null),"workbench_available",table!=null)));
            if(grid<2||grid>3)throw new IllegalArgumentException("该配方需要未支持工位；未制作。");
            if(grid==3&&table==null)throw new IllegalArgumentException("需要可见、近身的工作台；先放置工作台再制作。");
            String recipe=selected.get("id").getAsString();
            if(grid==3)return new Containers(body,calls).atBlock(table,menu->nativeResult("numen.inv.craft",List.of(recipe),Map.of("count",count),"工作台原生合成终态；实际成品数以库存为准"));
            return nativeResult("numen.inv.craft",List.of(recipe),Map.of("count",count),"原生合成终态；实际成品数以库存为准");
        });
    }
    private CompletableFuture<Result> attack(JsonObject a){
        Policy.keys(a,"entity_id","target_uuid","max_hits","authorization_id");int hits=a.has("max_hits")?(int)Wire.integer(a,"max_hits",1,10):1;LivingEntity target=null;
        JsonElement requested=a.get("entity_id");
        if(requested!=null&&requested.isJsonPrimitive()&&requested.getAsJsonPrimitive().isString()&&requested.getAsString().equals("hostile_nearby")){
            target=player.getNearbyEntities(3,3,3).stream().filter(e->e instanceof Monster&&e.getCustomName()==null&&player.hasLineOfSight(e)).map(e->(LivingEntity)e).min(Comparator.comparingDouble(e->e.getLocation().distanceSquared(player.getLocation()))).orElse(null);
        }else{
            int id=(int)Wire.integer(a,"entity_id",1,Integer.MAX_VALUE);UUID uuid=UUID.fromString(Wire.string(a,"target_uuid",36,36));Entity e=player.getWorld().getEntity(uuid);if(e instanceof LivingEntity living&&e.getEntityId()==id)target=living;
        }
        if(target==null||target instanceof Player||target instanceof Tameable tame&&tame.isTamed()||!(target instanceof Monster)||target.getCustomName()!=null)throw new IllegalArgumentException("只能攻击可见、未命名的敌对怪物；玩家、宠物、中立和命名目标未派发。");
        if(!player.hasLineOfSight(target)||target.getLocation().distanceSquared(player.getLocation())>16)throw new IllegalArgumentException("目标不在当前视线和近战范围");
        final LivingEntity victim=target;double before=victim.getHealth();
        String attack=NativeCalls.code("numen.use.hit",victim.getEntityId()),pause=NativeCalls.code("numen.time.wait",.6);
        String expression="(function() local n=0; for i=1,"+hits+" do "+attack+"; n=n+1; if i<"+hits+" then "+pause+" end end; return {attacks=n} end)()";
        return calls.expression(expression).thenApply(value->Result.ok("原生近战终态；挥击次数不等于伤害。",object("native",value,"target_uuid",victim.getUniqueId().toString(),"target_dead",victim.isDead(),"health_before",before,"health_after",victim.isDead()?0:victim.getHealth())));
    }
    private CompletableFuture<Result> collect(JsonObject a){
        Policy.keys(a,"x","y","z","r");int radius=a.has("r")?(int)Wire.integer(a,"r",1,12):3;
        Map<String,Object> center=a.has("x")||a.has("y")||a.has("z")?pos(a,6):Map.of("x",body.getX(),"y",body.getY(),"z",body.getZ());
        Location at=new Location(player.getWorld(),((Number)center.get("x")).doubleValue(),((Number)center.get("y")).doubleValue(),((Number)center.get("z")).doubleValue());
        List<Entity> drops=player.getWorld().getNearbyEntities(at,radius,radius,radius).stream().filter(e->e instanceof Item&&player.hasLineOfSight(e)).sorted(Comparator.comparingDouble(e->e.getLocation().distanceSquared(player.getLocation()))).limit(8).toList();
        if(drops.isEmpty())return ready(Result.ok("附近没有可见掉落物；未移动或凭空入包。",object("collected_count",0)));
        StringBuilder code=new StringBuilder("(function() ");for(Entity drop:drops)code.append(NativeCalls.code("numen.move.to",Map.of("x",drop.getLocation().getBlockX(),"y",drop.getLocation().getBlockY(),"z",drop.getLocation().getBlockZ()))).append(';');
        code.append("return true end)()");int before=countInventory();return calls.expression(code.toString()).thenApply(v->Result.ok("已沿原生移动接近掉落物；只计实际库存净变化，其他拾取仍需核对。",object("inventory_net_change",countInventory()-before,"inventory",inventory())));
    }
    private int countInventory(){int count=0;for(ItemStack s:player.getInventory().getStorageContents())if(s!=null)count+=s.getAmount();return count;}
    public static String id(Material material){return material.getKey().toString();}
}
