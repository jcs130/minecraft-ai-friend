package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.Block;
import org.bukkit.block.data.type.Door;
import org.bukkit.craftbukkit.CraftWorld;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.*;
import org.bukkit.util.BoundingBox;

/** Console-only, loaded-chunk observations for the Goddess MCP. No persistent state or actions. */
final class GoddessObservation {
    private final AgentFriendPlugin plugin;
    private long lastQuery;
    private static final Set<String> OPS=Set.of("player","block","area","blocks","entities","places","route","access");
    private static final Set<Material> DANGER=Set.of(Material.LAVA,Material.FIRE,Material.SOUL_FIRE,Material.CACTUS,Material.MAGMA_BLOCK,Material.CAMPFIRE,Material.SOUL_CAMPFIRE,Material.POWDER_SNOW,Material.SWEET_BERRY_BUSH,Material.WITHER_ROSE);
    private static final Set<String> FIELDS=Set.of("op","player","world","x","y","z","radius","height","limit","blocks","type","query","targetX","targetY","targetZ","action");
    private static final class Budget extends RuntimeException { }
    private static final class Scan {
        final long began=System.nanoTime();int reads;final Set<String> unknown=new HashSet<>();
        void tick(){if(++reads>12000||(reads%64==0&&System.nanoTime()-began>8_000_000L))throw new Budget();}
    }
    GoddessObservation(AgentFriendPlugin plugin){this.plugin=plugin;}
    void command(CommandSender sender,String[] args){
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("observedAt",java.time.Instant.now().toString());out.addProperty("readOnly",true);
        Scan scan=new Scan();
        try{
            long now=System.nanoTime();if(now-lastQuery<200_000_000L){out.addProperty("status","unknown");out.addProperty("reason","rate_limited");out.addProperty("nextAction","等待至少200毫秒后重新查询；不要连续扫描同一位置。");}
            else{
                lastQuery=now;
                if(args.length!=3||args[2].length()>2048||!args[2].matches("[A-Za-z0-9_-]+"))throw new IllegalArgumentException("encoded_request_required");
                JsonObject q=JsonParser.parseString(new String(Base64.getUrlDecoder().decode(args[2]),StandardCharsets.UTF_8)).getAsJsonObject();
                if(!FIELDS.containsAll(q.keySet()))throw new IllegalArgumentException("unknown_request_field");
                String op=text(q,"op",20);if(!OPS.contains(op))throw new IllegalArgumentException("unknown_operation");out.addProperty("op",op);
                switch(op){
                    case "player"->player(out,q,scan);
                    case "places"->places(out,q);
                    case "route"->route(out,q,scan);
                    default->{World w=world(q);int x=number(q,"x",-29_999_000,29_999_000),y=number(q,"y",w.getMinHeight(),w.getMaxHeight()-1),z=number(q,"z",-29_999_000,29_999_000);out.addProperty("world",w.getKey().toString());
                        switch(op){case "block"->{Block b=block(w,x,y,z,scan);if(b!=null)out.add("block",detail(b));}
                            case "area","blocks"->area(out,q,w,x,y,z,scan,op.equals("blocks"));
                            case "entities"->{if(block(w,x,y,z,scan)!=null)entities(out,q,w,x,y,z);}
                            case "access"->access(out,q,w,x,y,z,scan);
                            default->throw new IllegalArgumentException("unknown_operation");}
                    }
                }
                if(!out.has("status"))out.addProperty("status",scan.unknown.isEmpty()?"ok":"partial");
                if(!out.has("complete"))out.addProperty("complete",scan.unknown.isEmpty());
            }
        }catch(Budget e){out.addProperty("status","partial");out.addProperty("complete",false);out.addProperty("reason","scan_budget");out.addProperty("nextAction","缩小半径/高度或拆成不同小范围查询；部分结果不能证明不存在。");}
        catch(IllegalArgumentException|IllegalStateException e){out.addProperty("status","error");out.addProperty("complete",false);out.addProperty("reason",String.valueOf(e.getMessage()).substring(0,Math.min(100,String.valueOf(e.getMessage()).length())));out.addProperty("nextAction","先查询玩家当前世界和位置，使用准确在线账号、合法世界、整数坐标及工具规定范围。");}
        catch(RuntimeException|LinkageError e){out.addProperty("status","unknown");out.addProperty("complete",false);out.addProperty("reason","observation_unavailable");out.addProperty("nextAction","暂时无法核实，请稍后查询；不能据此判断玩家离线或目标不存在。");plugin.getLogger().warning("Goddess observation: "+e.getClass().getSimpleName());}
        out.addProperty("blockReads",scan.reads);out.addProperty("durationMs",Math.round((System.nanoTime()-scan.began)/10000.0)/100.0);out.addProperty("unknownChunkCount",scan.unknown.size());
        if(!scan.unknown.isEmpty())out.addProperty("nextAction","只读查询未加载区块不会强行加载。让旅人靠近后重查，或查询已登记公共地点；未扫描不等于没有。");
        String encoded=out.toString();if(encoded.getBytes(StandardCharsets.UTF_8).length>28000)encoded="{\"schemaVersion\":1,\"status\":\"partial\",\"complete\":false,\"reason\":\"output_budget\",\"nextAction\":\"缩小范围和结果数后重新查询\"}";
        sender.sendMessage("MC_OBSERVATION "+encoded);
    }
    private static String text(JsonObject q,String k,int max){if(!q.has(k)||!q.get(k).isJsonPrimitive()||!q.get(k).getAsJsonPrimitive().isString())throw new IllegalArgumentException("invalid_"+k);String s=q.get(k).getAsString();if(s.isEmpty()||s.length()>max||s.chars().anyMatch(c->c<32))throw new IllegalArgumentException("invalid_"+k);return s;}
    private static int number(JsonObject q,String k,int min,int max){if(!q.has(k)||!q.get(k).isJsonPrimitive()||!q.get(k).getAsJsonPrimitive().isNumber())throw new IllegalArgumentException("invalid_"+k);double v=q.get(k).getAsDouble();if(!Double.isFinite(v)||v!=Math.rint(v)||v<min||v>max)throw new IllegalArgumentException("invalid_"+k);return (int)v;}
    private static int optional(JsonObject q,String k,int value,int min,int max){return q.has(k)?number(q,k,min,max):value;}
    private static Player target(JsonObject q){String name=text(q,"player",32);if(!name.matches("[A-Za-z0-9_.-]{1,32}"))throw new IllegalArgumentException("invalid_player");Player p=Bukkit.getPlayerExact(name);if(p==null)throw new IllegalArgumentException("player_offline");return p;}
    private static World world(JsonObject q){String s=text(q,"world",64);World w=Bukkit.getWorld(s);if(w==null)try{w=Bukkit.getWorld(UUID.fromString(s));}catch(IllegalArgumentException ignored){}
        if(w==null)for(World candidate:Bukkit.getWorlds())if(candidate.getKey().toString().equals(s))w=candidate;
        if(w==null)throw new IllegalArgumentException("world_not_loaded");return w;}
    private static Block block(World w,int x,int y,int z,Scan scan){scan.tick();if(y<w.getMinHeight()||y>=w.getMaxHeight())return null;if(!w.isChunkLoaded(x>>4,z>>4)){scan.unknown.add((x>>4)+","+(z>>4));return null;}return w.getBlockAt(x,y,z);}
    private static JsonArray pos(int x,int y,int z){var a=new JsonArray();a.add(x);a.add(y);a.add(z);return a;}
    private static JsonObject location(Location p){var j=new JsonObject();j.addProperty("world",p.getWorld().getKey().toString());j.addProperty("worldUuid",p.getWorld().getUID().toString());j.addProperty("x",p.getX());j.addProperty("y",p.getY());j.addProperty("z",p.getZ());return j;}
    // Bukkit's 1.20.6 enum collapses datapack biomes into CUSTOM. Read the
    // existing chunk's quart biome holder directly, never request another chunk.
    private static String biome(Block b){return WorldBiomes.at(b);}
    private JsonObject detail(Block b){var j=new JsonObject();j.add("position",pos(b.getX(),b.getY(),b.getZ()));j.addProperty("type",b.getType().getKey().toString());j.addProperty("data",b.getBlockData().getAsString());j.addProperty("biome",biome(b));j.addProperty("biomeResolution","loaded_quart_cell_4x4x4");j.addProperty("passable",b.isPassable());j.addProperty("liquid",b.isLiquid());j.addProperty("hazard",DANGER.contains(b.getType()));j.addProperty("light",b.getLightLevel());plugin.lands().fields(j,b.getLocation());return j;}
    private void player(JsonObject out,JsonObject q,Scan scan){Player p=target(q);Location at=p.getLocation();out.addProperty("player",p.getName());out.addProperty("uuid",p.getUniqueId().toString());out.add("position",location(at));out.addProperty("yaw",at.getYaw());out.addProperty("pitch",at.getPitch());out.addProperty("gameMode",p.getGameMode().name());out.addProperty("health",p.getHealth());out.addProperty("food",p.getFoodLevel());out.addProperty("onGround",p.isOnGround());Block b=block(p.getWorld(),at.getBlockX(),at.getBlockY()-1,at.getBlockZ(),scan);if(b!=null)out.add("underfoot",detail(b));out.addProperty("inventoryIncluded",false);}
    private static Set<Material> filter(JsonObject q){if(!q.has("blocks")||!q.get("blocks").isJsonArray()||q.getAsJsonArray("blocks").isEmpty()||q.getAsJsonArray("blocks").size()>8)throw new IllegalArgumentException("blocks_requires_1_to_8_ids");Set<Material> wanted=new HashSet<>();for(JsonElement e:q.getAsJsonArray("blocks")){if(!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isString()||!e.getAsString().matches("(?:minecraft:)?[a-z0-9_]{1,60}"))throw new IllegalArgumentException("invalid_block_id");Material m=Material.matchMaterial(e.getAsString());if(m==null||!m.isBlock()||m.isAir())throw new IllegalArgumentException("invalid_block_id");wanted.add(m);}return wanted;}
    private void area(JsonObject out,JsonObject q,World w,int x,int y,int z,Scan scan,boolean search){
        int r=optional(q,"radius",6,1,12),h=optional(q,"height",4,1,6),limit=optional(q,"limit",12,1,24),lo=Math.max(w.getMinHeight(),y-h),hi=Math.min(w.getMaxHeight()-1,y+h);
        if((2*r+1)*(2*r+1)*(hi-lo+1)>8192)throw new IllegalArgumentException("volume_exceeds_8192");
        JsonObject bounds=new JsonObject();bounds.add("min",pos(x-r,lo,z-r));bounds.add("max",pos(x+r,hi,z+r));out.add("bounds",bounds);
        JsonArray hits=new JsonArray();out.add("matches",hits);Map<Material,Integer> counts=new HashMap<>();Set<Material> wanted=search?filter(q):Set.of();
        // Center-first ring order lets a bounded partial response remain useful.
        var columns=new ArrayList<int[]>();for(int dx=-r;dx<=r;dx++)for(int dz=-r;dz<=r;dz++)columns.add(new int[]{x+dx,z+dz});columns.sort(Comparator.comparingInt(a->Math.abs(a[0]-x)+Math.abs(a[1]-z)));
        var found=new ArrayList<Block>();int matches=0;boolean exhausted=false;
        try{for(int[] column:columns)for(int yy=lo;yy<=hi;yy++){Block b=block(w,column[0],yy,column[1],scan);if(b==null)continue;counts.merge(b.getType(),1,Integer::sum);
            if(search&&wanted.contains(b.getType())){matches++;if(found.size()<limit)found.add(b);} }}
        catch(Budget e){exhausted=true;out.addProperty("status","partial");out.addProperty("complete",false);out.addProperty("reason","scan_budget");out.addProperty("nextAction","仅返回已扫描部分；缩小半径或高度重查，未扫描不等于没有。");}
        found.sort(Comparator.comparingDouble(b->b.getLocation().distanceSquared(new Location(w,x,y,z))));for(Block b:found)hits.add(detail(b));
        var materials=new JsonArray();counts.entrySet().stream().filter(e->!e.getKey().isAir()).sorted(Map.Entry.<Material,Integer>comparingByValue().reversed()).limit(12).forEach(e->{var row=new JsonObject();row.addProperty("type",e.getKey().getKey().toString());row.addProperty("count",e.getValue());materials.add(row);});out.add("materials",materials);
        out.addProperty("matchCount",matches);out.addProperty("truncated",matches>limit);out.addProperty("includesHiddenBlocks",search);out.addProperty("containerContentsIncluded",false);
        if(!search){var surfaces=new JsonArray();out.add("surfaceSamples",surfaces);int stride=Math.max(1,r/2);if(!exhausted)for(int dx=-r;dx<=r;dx+=stride)for(int dz=-r;dz<=r;dz+=stride){if(!w.isChunkLoaded((x+dx)>>4,(z+dz)>>4))continue;scan.tick();int top=w.getHighestBlockYAt(x+dx,z+dz,HeightMap.MOTION_BLOCKING_NO_LEAVES);Block b=block(w,x+dx,top,z+dz,scan);if(b!=null){var row=new JsonObject();row.add("position",pos(b.getX(),b.getY(),b.getZ()));row.addProperty("type",b.getType().getKey().toString());row.addProperty("biome",biome(b));surfaces.add(row);}}out.addProperty("surfaceMeaning","已加载区块高度图的最上层，可能是屋顶或树；不是天然山峰识别，也不是当前洞穴地面。");}
    }
    private void entities(JsonObject out,JsonObject q,World w,int x,int y,int z){int r=optional(q,"radius",16,1,48),h=optional(q,"height",12,1,24),limit=optional(q,"limit",12,1,24);String type=q.has("type")?text(q,"type",64):"any";
        if(!type.matches("any|living|item|(?:minecraft:)?[a-z0-9_]{1,60}"))throw new IllegalArgumentException("invalid_entity_type");
        var list=w.getNearbyEntities(new Location(w,x+.5,y,z+.5),r,h,r,e->e.isValid()&&!(e instanceof Player p&&(plugin.isObserver(p)||p.isInvisible()))&&(type.equals("any")||type.equals("living")&&e instanceof LivingEntity||type.equals("item")&&e instanceof Item||e.getType().getKey().toString().equals(type)||e.getType().getKey().getKey().equals(type))).stream().sorted(Comparator.comparingDouble(e->e.getLocation().distanceSquared(new Location(w,x,y,z)))).toList();
        var array=new JsonArray();out.add("entities",array);for(Entity e:list.stream().limit(limit).toList()){var j=new JsonObject();j.addProperty("type",e.getType().getKey().toString());j.addProperty("entityId",e.getEntityId());j.add("position",location(e.getLocation()));if(e instanceof Player p)j.addProperty("player",p.getName());if(e instanceof Item item){j.addProperty("item",item.getItemStack().getType().getKey().toString());j.addProperty("amount",item.getItemStack().getAmount());}if(e instanceof LivingEntity l)j.addProperty("health",l.getHealth());array.add(j);}out.addProperty("truncated",list.size()>limit);out.addProperty("matchCount",list.size());out.addProperty("complete",false);out.addProperty("scope","附近已加载实体的瞬时快照；不证明未知区块没有实体，不包含背包或箱内物品。");}
    private void places(JsonObject out,JsonObject q){String search=q.has("query")?text(q,"query",40).toLowerCase(Locale.ROOT):"";var all=new JsonArray();all.addAll(plugin.waypoints().observationShares());all.addAll(plugin.lands().observationPlaces());all.addAll(plugin.worldLife().observationPlaces());World w=Bukkit.getWorld("world");if(w!=null)for(var site:DungeonExpeditions.SITES){var j=new JsonObject();j.addProperty("id",site.id());j.addProperty("name",site.name());j.addProperty("world",w.getKey().toString());j.addProperty("x",site.x());j.addProperty("z",site.z());j.addProperty("kind","registered_ruin_center");j.addProperty("precision","horizontal_approximate");all.add(j);}
        var selected=new JsonArray();for(JsonElement e:all){JsonObject j=e.getAsJsonObject();if(search.isEmpty()||j.toString().toLowerCase(Locale.ROOT).contains(search)){selected.add(j);if(selected.size()>=24)break;}}out.add("places",selected);out.addProperty("complete",all.size()<24);out.addProperty("scope","现役公开分享地点、公共领地和登记遗迹；不含私人家，不执行locate或生成新区块。");}
    private void access(JsonObject out,JsonObject q,World w,int x,int y,int z,Scan scan){Player p=target(q);String action=text(q,"action",16);if(!Set.of("break","place","container","use").contains(action))throw new IllegalArgumentException("invalid_action");Block b=block(w,x,y,z,scan);if(b==null)return;if(p.getWorld()!=w){out.addProperty("status","unknown");out.addProperty("reason","different_world");return;}out.add("protection",plugin.protectionAdvisor().observe(p,action,x,y,z));}
    private void route(JsonObject out,JsonObject q,Scan scan){Player p=target(q);World w=p.getWorld();Location at=p.getLocation();int tx=number(q,"targetX",-29_999_000,29_999_000),ty=number(q,"targetY",w.getMinHeight()+1,w.getMaxHeight()-2),tz=number(q,"targetZ",-29_999_000,29_999_000);int sx=at.getBlockX(),sy=at.getBlockY(),sz=at.getBlockZ();out.addProperty("world",w.getKey().toString());out.add("start",pos(sx,sy,sz));out.add("target",pos(tx,ty,tz));
        if(Math.abs(tx-sx)>24||Math.abs(tz-sz)>24||Math.abs(ty-sy)>8){out.addProperty("status","unknown");out.addProperty("reason","outside_local_route");out.addProperty("nextAction","目标超出局部24格/高差8格路线预算；先查询公共地点或让旅人分段接近再规划，方向和直线距离不能当作可走路线。");out.addProperty("complete",false);return;}
        var cache=new HashMap<ObservationRoute.Pos,ObservationRoute.Cell>();
        java.util.function.Function<ObservationRoute.Pos,ObservationRoute.Cell> cells=n->cache.computeIfAbsent(n,v->{if(Math.abs(v.x()-sx)>26||Math.abs(v.z()-sz)>26||Math.abs(v.y()-sy)>9)return new ObservationRoute.Cell(false,false,false,false,false);Block foot=block(w,v.x(),v.y(),v.z(),scan),head=block(w,v.x(),v.y()+1,v.z(),scan),floor=block(w,v.x(),v.y()-1,v.z(),scan);if(foot==null||head==null||floor==null)return new ObservationRoute.Cell(false,false,false,false,false);
            boolean door=foot.getBlockData() instanceof Door d&&d.getMaterial()!=Material.IRON_DOOR;
            boolean permission=!door||plugin.lands().allows(p,"use",foot.getLocation())&&plugin.lands().stateAllows(p,"use",foot.getLocation());
            boolean clear=permission&&safeAir(foot,door)&&safeAir(head,door);BoundingBox box=floor.getBoundingBox();boolean fullFloor=!floor.isLiquid()&&!DANGER.contains(floor.getType())&&box.getWidthX()>=.99&&box.getWidthZ()>=.99&&box.getHeight()>=.99;
            boolean ladder=foot.getType()==Material.LADDER||foot.getType()==Material.VINE;return new ObservationRoute.Cell(clear&&fullFloor,clear&&ladder,door,true,clear);});
        var result=ObservationRoute.find(new ObservationRoute.Pos(sx,sy,sz),new ObservationRoute.Pos(tx,ty,tz),cells,768);var route=new JsonArray();out.add("route",route);for(var n:result.points()){var j=new JsonObject();j.add("position",pos(n.x(),n.y(),n.z()));var c=cells.apply(n);j.addProperty("action",c.climb()?"climb_ladder":c.door()?"open_wooden_door":"walk_or_step");route.add(j);}out.addProperty("routeStatus",result.status());out.addProperty("visited",result.visited());out.addProperty("complete",result.status().equals("found")&&scan.unknown.isEmpty());out.addProperty("dynamicObstaclesChecked",false);out.addProperty("scope","局部保守原版步行/单格台阶/木门/连续梯子路线；不挖方块、不传送、不施法、不移动。半砖/复杂碰撞/游泳需现场检查，实体会移动，执行前重查。");if(!result.status().equals("found"))out.addProperty("nextAction","未证明存在可走局部路线；先检查目标落脚点和入口/梯子，靠近后缩小范围重查，不要拆保护建筑。");}
    private static boolean safeAir(Block b,boolean door){return !b.isLiquid()&&!DANGER.contains(b.getType())&&(b.isPassable()||b.getType()==Material.LADDER||b.getType()==Material.VINE||door&&b.getBlockData() instanceof Door d&&d.getMaterial()!=Material.IRON_DOOR);}
}
