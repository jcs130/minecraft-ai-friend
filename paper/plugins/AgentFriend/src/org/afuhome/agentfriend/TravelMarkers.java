package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import org.bukkit.*;
import org.bukkit.block.*;
import org.bukkit.block.sign.Side;
import org.bukkit.command.*;
import org.bukkit.event.*;
import org.bukkit.event.block.*;
import org.bukkit.event.entity.*;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;

/** Native markers. A reviewed, hash-pinned plan is installed only by the console.
 * Before-images are durable before editing; restart never silently reapplies a plan.
 * Read/click/protection paths do not load chunks or execute arbitrary commands. */
final class TravelMarkers implements Listener {
    private record Cell(String world,int x,int y,int z) {}
    private final AgentFriendPlugin plugin;
    private final Path folder,journal;
    private final Map<String,JsonObject> installed=new LinkedHashMap<>();
    private final Map<Cell,JsonObject> protectedCells=new HashMap<>();
    private boolean busy,healthy=true;
    private JsonObject last=new JsonObject();
    private void failed(JsonObject marker,String reason){
        JsonObject failure=new JsonObject();failure.addProperty("id",marker.get("id").getAsString());failure.addProperty("reason",reason);last.getAsJsonArray("blocked").add(failure);
    }
    TravelMarkers(AgentFriendPlugin plugin) {
        this.plugin=plugin;folder=plugin.getDataFolder().toPath();journal=folder.resolve("travel-markers-installed.json");
        try {
            if(Files.exists(journal))for(JsonElement value:JsonParser.parseString(Files.readString(journal)).getAsJsonArray()){
                JsonObject marker=value.getAsJsonObject();validate(marker);installed.put(marker.get("id").getAsString(),marker);
            }
            index();
        }catch(Exception error){healthy=false;plugin.getLogger().severe("Travel marker journal unreadable; no installation allowed: "+error);}
        Bukkit.getPluginManager().registerEvents(this,plugin);
        Bukkit.getCommandMap().register("agentfriend",new Command("aftravelmarkers"){
            @Override public boolean execute(CommandSender sender,String label,String[] args){
                if(!(sender instanceof ConsoleCommandSender||sender instanceof RemoteConsoleCommandSender))return false;
                try{command(sender,args);}catch(Exception error){sender.sendMessage("MC_TRAVEL_MARKERS error="+error.getMessage());}return true;
            }
        });
    }
    private static int[] position(JsonElement element){
        JsonArray a=element.getAsJsonArray();if(a.size()!=3)throw new IllegalArgumentException("invalid_position");int[] p=new int[3];
        for(int i=0;i<3;i++){double n=a.get(i).getAsDouble();if(!Double.isFinite(n)||n!=Math.rint(n)||Math.abs(n)>(i==1?4096:30000000))throw new IllegalArgumentException("invalid_position");p[i]=(int)n;}return p;
    }
    private static Cell cell(JsonObject m,JsonElement at){int[] p=position(at);return new Cell(m.get("worldName").getAsString(),p[0],p[1],p[2]);}
    private static JsonArray changes(JsonObject m){return m.getAsJsonObject("geometry").getAsJsonArray("changes");}
    private static void validate(JsonObject m){
        if(!m.get("id").getAsString().matches("[a-zA-Z0-9:_-]{1,100}")||!m.get("worldName").getAsString().matches("[a-zA-Z0-9_-]{1,80}"))throw new IllegalArgumentException("invalid_marker_id");
        if(changes(m).size()<2||changes(m).size()>16||m.getAsJsonArray("signLines").size()!=4)throw new IllegalArgumentException("invalid_marker_size");
        Cell beacon=cell(m,m.getAsJsonObject("geometry").get("beacon")),sign=cell(m,m.getAsJsonObject("geometry").get("sign"));Set<Cell> seen=new HashSet<>();
        boolean hasBeacon=false,hasSign=false;
        for(JsonElement value:changes(m)){
            JsonObject row=value.getAsJsonObject();Cell c=cell(m,row.get("position"));
            if(!seen.add(c)||Math.abs(c.x-beacon.x)>1||Math.abs(c.z-beacon.z)>1||c.y<beacon.y-1||c.y>beacon.y+1)throw new IllegalArgumentException("invalid_footprint");
            Material after=Bukkit.createBlockData(row.get("after").getAsString()).getMaterial();Bukkit.createBlockData(row.get("before").getAsString());
            if(!Set.of(Material.IRON_BLOCK,Material.BEACON,Material.OAK_WALL_SIGN,Material.AIR).contains(after))throw new IllegalArgumentException("invalid_after_image");
            hasBeacon|=c.equals(beacon)&&after==Material.BEACON;hasSign|=c.equals(sign)&&after==Material.OAK_WALL_SIGN;
        }
        if(!hasBeacon||!hasSign)throw new IllegalArgumentException("missing_beacon_or_sign");
        for(JsonElement line:m.getAsJsonArray("signLines"))if(line.getAsString().length()>48||line.getAsString().contains("\n"))throw new IllegalArgumentException("invalid_sign_text");
    }
    private void index(){protectedCells.clear();for(JsonObject m:installed.values())for(JsonElement v:changes(m))protectedCells.put(cell(m,v.getAsJsonObject().get("position")),m);}
    private void persist()throws Exception{
        JsonArray all=new JsonArray();installed.values().forEach(all::add);Path tmp=journal.resolveSibling(journal.getFileName()+".tmp");
        Files.writeString(tmp,all.toString(),StandardCharsets.UTF_8,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING);
        try(FileChannel f=FileChannel.open(tmp,StandardOpenOption.WRITE)){f.force(true);}
        Files.move(tmp,journal,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);index();
    }
    private static String sha(byte[] bytes)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
    private void command(CommandSender sender,String[] args)throws Exception{
        if(args.length!=2||!Set.of("audit","apply","rollback","status").contains(args[0])||!args[1].matches("[a-f0-9]{64}"))throw new IllegalArgumentException("usage: aftravelmarkers audit|apply|rollback|status <plan-sha256>");
        if(args[0].equals("status")){if(!last.has("plan")||!last.get("plan").getAsString().equals(args[1]))throw new IllegalStateException("unknown_plan_status");sender.sendMessage("MC_TRAVEL_MARKERS "+last);return;}
        if(!healthy||busy)throw new IllegalStateException("journal_unavailable_or_busy");
        byte[] bytes=Files.readAllBytes(folder.resolve("travel-markers-plan.json"));if(!sha(bytes).equals(args[1]))throw new IllegalArgumentException("plan_hash_mismatch");
        JsonObject plan=JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject();JsonArray rows=plan.getAsJsonArray("markers");
        if(plan.get("schema").getAsInt()!=1||rows.size()>256)throw new IllegalArgumentException("plan_schema_or_size");
        Set<String> ids=new HashSet<>();Set<Cell> cells=new HashSet<>();List<JsonObject> markers=new ArrayList<>();
        for(JsonElement value:rows){JsonObject m=value.getAsJsonObject();validate(m);if(!ids.add(m.get("id").getAsString()))throw new IllegalArgumentException("duplicate_id");
            for(JsonElement change:changes(m))if(!cells.add(cell(m,change.getAsJsonObject().get("position"))))throw new IllegalArgumentException("overlap");markers.add(m);}
        last=new JsonObject();last.addProperty("plan",args[1]);last.addProperty("action",args[0]);last.addProperty("finished",false);last.addProperty("checked",0);last.add("blocked",new JsonArray());last.add("skipped",new JsonArray());
        busy=true;run(sender,args[0],args[1],markers,0,new HashSet<>());sender.sendMessage("MC_TRAVEL_MARKERS accepted=true query=aftravelmarkers status "+args[1]);
    }
    private void run(CommandSender sender,String action,String hash,List<JsonObject> rows,int i,Set<World> touched){
        if(!plugin.isEnabled()){busy=false;return;}
        if(i==rows.size()){
            try{if(!action.equals("audit")){
                for(World w:touched)w.save();
                for(JsonObject row:rows){String id=row.get("id").getAsString();if(action.equals("rollback"))installed.remove(id);else installed.get(id).addProperty("state","installed");}
                persist();
            }last.addProperty("finished",true);sender.sendMessage("MC_TRAVEL_MARKERS status=finished action="+action+" count="+i+" plan="+hash);}
            catch(Exception e){healthy=false;last.addProperty("finished",true);last.addProperty("uncertain",true);sender.sendMessage("MC_TRAVEL_MARKERS status=uncertain journal_preserved=true error="+e.getClass().getSimpleName());}finally{busy=false;}return;
        }
        JsonObject m=rows.get(i);
        // The write-ahead record exists before any edit. A stopped batch may
        // never reach later rows; rollback must leave those rows alone and
        // still finalize the earlier restored records, including after restart.
        if(action.equals("rollback")&&!installed.containsKey(m.get("id").getAsString())){
            last.getAsJsonArray("skipped").add(m.get("id").getAsString());last.addProperty("checked",last.get("checked").getAsInt()+1);
            Bukkit.getScheduler().runTaskLater(plugin,()->run(sender,action,hash,rows,i+1,touched),1L);return;
        }
        World w=Bukkit.getWorld(m.get("worldName").getAsString());
        if(w==null){failed(m,"world_unavailable");if(action.equals("audit"))Bukkit.getScheduler().runTaskLater(plugin,()->run(sender,action,hash,rows,i+1,touched),1L);else{last.addProperty("finished",true);busy=false;}return;}
        Set<Long> chunks=new HashSet<>();for(JsonElement v:changes(m)){Cell c=cell(m,v.getAsJsonObject().get("position"));chunks.add(((long)(c.x>>4)<<32)|((c.z>>4)&0xffffffffL));}
        for(String key:List.of("anchor")){JsonArray p=m.getAsJsonArray(key);int x=(int)Math.floor(p.get(0).getAsDouble()),z=(int)Math.floor(p.get(2).getAsDouble());chunks.add(((long)(x>>4)<<32)|((z>>4)&0xffffffffL));}
        JsonArray reader=m.getAsJsonObject("geometry").getAsJsonArray("reader");chunks.add(((long)((int)Math.floor(reader.get(0).getAsDouble())>>4)<<32)|(((int)Math.floor(reader.get(2).getAsDouble())>>4)&0xffffffffL));
        if(chunks.size()>4||chunks.stream().anyMatch(c->!w.isChunkGenerated((int)(c>>32),(int)(long)c))){failed(m,"ungenerated_or_unbounded_chunks");if(action.equals("audit"))Bukkit.getScheduler().runTaskLater(plugin,()->run(sender,action,hash,rows,i+1,touched),1L);else{last.addProperty("finished",true);busy=false;}return;}
        JsonArray center=m.getAsJsonArray("anchor");int ax=(int)Math.floor(center.get(0).getAsDouble()),az=(int)Math.floor(center.get(2).getAsDouble());
        for(int cx=(ax-10)>>4;cx<=(ax+10)>>4;cx++)for(int cz=(az-10)>>4;cz<=(az+10)>>4;cz++)if(w.isChunkGenerated(cx,cz))chunks.add(((long)cx<<32)|(cz&0xffffffffL));
        CompletableFuture<?>[] loads=chunks.stream().map(c->w.getChunkAtAsync((int)(c>>32),(int)(long)c,false)).toArray(CompletableFuture[]::new);
        CompletableFuture.allOf(loads).orTimeout(20,java.util.concurrent.TimeUnit.SECONDS).whenComplete((ignored,error)->{
            if(!plugin.isEnabled())return;
            Bukkit.getScheduler().runTask(plugin,()->{
                Set<Long> tickets=new HashSet<>();
                try{
                    if(error!=null)throw new IllegalStateException("chunk_unavailable");
                    // Youer can complete the async load before Bukkit regards the
                    // chunk as available. Finalize existing chunks without generation,
                    // retain them only for this one bounded inspection, then release.
                    for(long c:chunks){int cx=(int)(c>>32),cz=(int)c;if(!w.isChunkLoaded(cx,cz)&&!w.loadChunk(cx,cz,false))throw new IllegalStateException("chunk_unavailable");if(w.addPluginChunkTicket(cx,cz,plugin))tickets.add(c);}
                    String id=m.get("id").getAsString();JsonObject previous=installed.get(id);boolean restoring=action.equals("rollback");
                    if(previous!=null&&!previous.get("planHash").getAsString().equals(hash))throw new IllegalStateException("different_installed_plan");
                    if(restoring&&previous==null)throw new IllegalStateException("not_installed");
                    for(JsonElement value:changes(m)){
                        JsonObject change=value.getAsJsonObject();Block b=block(w,position(change.get("position")));String current=b.getBlockData().getAsString();
                        boolean before=current.equals(change.get("before").getAsString()),after=current.equals(change.get("after").getAsString());
                        boolean interruptedRestore=previous!=null&&previous.get("state").getAsString().equals("restoring");
                        if(!(restoring?after||interruptedRestore&&before:before||previous!=null&&after))throw new IllegalStateException("before_image_changed");
                        if(before&&b.getState() instanceof TileState)throw new IllegalStateException("existing_block_entity");
                        String desired=change.get(restoring?"before":"after").getAsString();
                        if(!action.equals("audit")&&!current.equals(desired)&&Bukkit.createBlockData(desired).getMaterial().isSolid()){
                            var volume=new org.bukkit.util.BoundingBox(b.getX(),b.getY(),b.getZ(),b.getX()+1,b.getY()+1,b.getZ()+1);
                            if(!w.getNearbyEntities(volume,e->e instanceof org.bukkit.entity.LivingEntity&&e.isValid()&&e.getBoundingBox().overlaps(volume)).isEmpty())
                                throw new IllegalStateException("occupied_by_living_entity");
                        }
                    }
                    if(!restoring){
                        JsonArray anchor=m.getAsJsonArray("anchor");Location at=new Location(w,anchor.get(0).getAsDouble(),anchor.get(1).getAsDouble(),anchor.get(2).getAsDouble());
                        HomeLanding.Issue anchorIssue=HomeLanding.exactIssue(at);if(anchorIssue!=null)throw new IllegalStateException("unsafe_anchor:"+anchorIssue.code());
                        Location read=new Location(w,reader.get(0).getAsDouble(),reader.get(1).getAsDouble(),reader.get(2).getAsDouble());
                        HomeLanding.Issue readerIssue=HomeLanding.exactIssue(read);if(readerIssue!=null)throw new IllegalStateException("unsafe_sign_access:"+readerIssue.code());
                        if(!walkable(at,read,m))throw new IllegalStateException("no_walkable_sign_route");
                    }
                    if(!action.equals("audit")){
                        JsonObject record=m.deepCopy();record.addProperty("planHash",hash);record.addProperty("state",restoring?"restoring":"prepared");installed.put(id,record);
                        try{persist();}catch(Exception failure){if(previous==null)installed.remove(id);else installed.put(id,previous);index();throw failure;}
                        for(JsonElement value:changes(m)){JsonObject change=value.getAsJsonObject();block(w,position(change.get("position"))).setBlockData(Bukkit.createBlockData(change.get(restoring?"before":"after").getAsString()),false);}
                        if(!restoring){
                            Sign sign=(Sign)block(w,position(m.getAsJsonObject("geometry").get("sign"))).getState();
                            for(Side side:Side.values()){var text=sign.getSide(side);for(int l=0;l<4;l++)text.setLine(l,m.getAsJsonArray("signLines").get(l).getAsString());text.setGlowingText(true);}
                            sign.setWaxed(true);if(!sign.update(true,false))throw new IllegalStateException("sign_update_failed");
                            record.addProperty("state","applied_awaiting_world_save");
                        }
                        touched.add(w);persist();
                    }
                    sender.sendMessage("MC_TRAVEL_MARKERS status=checked action="+action+" id="+id);
                    last.addProperty("checked",last.get("checked").getAsInt()+1);
                    Bukkit.getScheduler().runTaskLater(plugin,()->run(sender,action,hash,rows,i+1,touched),1L);
                }catch(Exception e){sender.sendMessage("MC_TRAVEL_MARKERS status=blocked id="+m.get("id")+" reason="+e.getMessage()+" recovery=journal_and_exact_images");
                    failed(m,e.getMessage());if(action.equals("audit"))Bukkit.getScheduler().runTaskLater(plugin,()->run(sender,action,hash,rows,i+1,touched),1L);else{busy=false;last.addProperty("finished",true);}}
                finally{for(long c:tickets)w.removePluginChunkTicket((int)(c>>32),(int)c,plugin);}
            });
        });
    }
    private static boolean walkable(Location start,Location target,JsonObject marker){
        PriorityQueue<Location> queue=new PriorityQueue<>(java.util.Comparator.comparingDouble(p->p.distanceSquared(target)));Set<String> seen=new HashSet<>();queue.add(start);World world=start.getWorld();
        List<Cell> obstacles=new ArrayList<>();for(JsonElement v:changes(marker)){JsonObject row=v.getAsJsonObject();String after=row.get("after").getAsString();if(after.equals("minecraft:beacon")||after.startsWith("minecraft:oak_wall_sign"))obstacles.add(cell(marker,row.get("position")));}
        while(!queue.isEmpty()&&seen.size()<512){Location at=queue.remove();String key=at.getBlockX()+":"+at.getY()+":"+at.getBlockZ();if(!seen.add(key))continue;
            if(at.distanceSquared(target)<.1)return true;
            for(int[] d:new int[][]{{1,0},{-1,0},{0,1},{0,-1}})for(double y:surfaces(world,at.getBlockX()+d[0],at.getY(),at.getBlockZ()+d[1])){
                Location next=new Location(world,at.getBlockX()+d[0]+.5,y,at.getBlockZ()+d[1]+.5);
                if(next.distanceSquared(start)>144||Math.abs(y-at.getY())>1.001||seen.contains(next.getBlockX()+":"+y+":"+next.getBlockZ()))continue;
                if(obstacles.stream().anyMatch(c->c.x==next.getBlockX()&&c.z==next.getBlockZ()&&c.y+1>y&&c.y<y+1.8))continue;
                if(HomeLanding.walkIssue(next)==null)queue.add(next);
            }
        }return false;
    }
    private static Set<Double> surfaces(World w,int x,double current,int z){
        Set<Double> levels=new TreeSet<>();if(!w.isChunkLoaded(x>>4,z>>4))return levels;
        for(int y=(int)Math.floor(current)-2;y<=(int)Math.floor(current)+1;y++)if(y>=w.getMinHeight()&&y<w.getMaxHeight())
            for(var box:w.getBlockAt(x,y,z).getCollisionShape().getBoundingBoxes())if(.5>=box.getMinX()&&.5<=box.getMaxX()&&.5>=box.getMinZ()&&.5<=box.getMaxZ()){
                double top=y+box.getMaxY();if(Math.abs(top-current)<=1.001)levels.add(top);
            }
        return levels;
    }
    private static Block block(World world,int[] p){return world.getBlockAt(p[0],p[1],p[2]);}
    private JsonObject marker(Block b){return b==null?null:protectedCells.get(new Cell(b.getWorld().getName(),b.getX(),b.getY(),b.getZ()));}
    @EventHandler(priority=EventPriority.HIGHEST) public void breakBlock(BlockBreakEvent e){if(marker(e.getBlock())!=null){e.setCancelled(true);e.getPlayer().sendMessage("§e这是受保护的传送信标；右键路牌打开地点菜单。");}}
    @EventHandler(priority=EventPriority.HIGHEST) public void place(BlockPlaceEvent e){if(marker(e.getBlockPlaced())!=null)e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void edit(SignChangeEvent e){if(marker(e.getBlock())!=null)e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void interact(PlayerInteractEvent e){
        JsonObject m=marker(e.getClickedBlock());if(m==null||e.getAction()!=Action.RIGHT_CLICK_BLOCK)return;e.setCancelled(true);
        if(e.getHand()!=EquipmentSlot.HAND||!(e.getClickedBlock().getState() instanceof Sign))return;
        e.getPlayer().sendMessage("§b"+m.get("title").getAsString()+" · "+LocationOutput.worldLabel(e.getClickedBlock().getWorld())+" §7"+m.get("usage").getAsString());
        if("personal".equals(m.get("kind").getAsString()))plugin.waypoints().command(e.getPlayer(),new String[]{"waypoint","menu"});else plugin.openPlacesMenu(e.getPlayer());
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void explosion(EntityExplodeEvent e){e.blockList().removeIf(b->marker(b)!=null);}
    @EventHandler(priority=EventPriority.HIGHEST) public void explosion(BlockExplodeEvent e){e.blockList().removeIf(b->marker(b)!=null);}
    @EventHandler(priority=EventPriority.HIGHEST) public void burn(BlockBurnEvent e){if(marker(e.getBlock())!=null)e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void ignite(BlockIgniteEvent e){if(marker(e.getBlock())!=null)e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void flow(BlockFromToEvent e){if(marker(e.getToBlock())!=null||marker(e.getBlock())!=null)e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void entity(EntityChangeBlockEvent e){if(marker(e.getBlock())!=null)e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void piston(BlockPistonExtendEvent e){if(e.getBlocks().stream().anyMatch(b->marker(b)!=null||marker(b.getRelative(e.getDirection()))!=null))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void piston(BlockPistonRetractEvent e){if(e.getBlocks().stream().anyMatch(b->marker(b)!=null||marker(b.getRelative(e.getDirection().getOppositeFace()))!=null))e.setCancelled(true);}
}
