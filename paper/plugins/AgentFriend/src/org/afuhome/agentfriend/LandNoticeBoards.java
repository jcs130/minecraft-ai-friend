package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.*;
import org.bukkit.block.data.Rotatable;
import org.bukkit.block.sign.Side;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.block.*;
import org.bukkit.event.entity.*;
import org.bukkit.event.player.*;
import org.bukkit.event.world.ChunkLoadEvent;
import org.bukkit.persistence.PersistentDataType;

/** Small native signs, never overwrites another block or loads a chunk. */
final class LandNoticeBoards implements Listener {
    private record Spot(String world,int x,int y,int z) {
        World level(){return Bukkit.getWorld(world);}
        boolean loaded(){World w=level();return w!=null&&w.isChunkLoaded(x>>4,z>>4);}
        Block block(){return level().getBlockAt(x,y,z);}
        Spot below(){return new Spot(world,x,y-1,z);}
    }
    private final AgentFriendPlugin plugin;
    private final LandManager lands;
    private final LandAccess access;
    private final Path file;
    private final NamespacedKey tag;
    private final Map<String,Spot> positions=new TreeMap<>();
    private final Map<Spot,String> protectedBlocks=new HashMap<>();
    private final Set<String> queued=new HashSet<>();
    private byte[] active;
    private boolean healthy=true;
    LandNoticeBoards(AgentFriendPlugin plugin,LandManager lands,LandAccess access) {
        this.plugin=plugin;this.lands=lands;this.access=access;file=plugin.getDataFolder().toPath().resolve("land-boards.json");
        tag=new NamespacedKey(plugin,"land_notice_board");
        try {
            if(Files.exists(file)) {
                active=Files.readAllBytes(file);if(active.length>65536)throw new IllegalArgumentException("board_index_size");
                JsonObject root=JsonParser.parseString(new String(active,StandardCharsets.UTF_8)).getAsJsonObject();
                if(root.get("schemaVersion").getAsInt()!=1)throw new IllegalArgumentException("board_schema");
                JsonObject entries=root.getAsJsonObject("boards");if(entries.size()>128)throw new IllegalArgumentException("board_limit");
                for(var entry:entries.entrySet()) {
                    if(!entry.getKey().matches("[a-z0-9][a-z0-9_-]{0,39}"))throw new IllegalArgumentException("board_land");
                    JsonObject b=entry.getValue().getAsJsonObject();String world=b.get("world").getAsString();
                    if(!Set.of("world","world_nether","world_the_end").contains(world))throw new IllegalArgumentException("board_world");
                    Spot spot=new Spot(world,b.get("x").getAsInt(),b.get("y").getAsInt(),b.get("z").getAsInt());
                    if(Math.abs((long)spot.x)>29999984||Math.abs((long)spot.z)>29999984||spot.y< -64||spot.y>320)throw new IllegalArgumentException("board_bounds");
                    if(positions.containsValue(spot))throw new IllegalArgumentException("duplicate_board_position");positions.put(entry.getKey(),spot);
                }
            }
        }catch(Exception failure){healthy=false;positions.clear();plugin.getLogger().warning("Land board index unavailable; automatic placement paused: "+failure.getClass().getSimpleName());}
        rebuild();Bukkit.getPluginManager().registerEvents(this,plugin);
        try{refresh();}catch(RuntimeException failure){plugin.getLogger().warning("Land board placement deferred: "+failure);}
    }
    private void rebuild(){protectedBlocks.clear();positions.forEach((id,s)->{protectedBlocks.put(s,id);protectedBlocks.put(s.below(),id);});}
    private boolean save(Map<String,Spot> next) {
        try {
            if(!healthy||!Arrays.equals(active,Files.exists(file)?Files.readAllBytes(file):null))return false;
            JsonObject root=new JsonObject(),entries=new JsonObject();root.addProperty("schemaVersion",1);root.add("boards",entries);
            next.forEach((id,s)->{JsonObject b=new JsonObject();b.addProperty("world",s.world);b.addProperty("x",s.x);b.addProperty("y",s.y);b.addProperty("z",s.z);entries.add(id,b);});
            byte[] bytes=root.toString().getBytes(StandardCharsets.UTF_8);Path temp=file.resolveSibling("land-boards.json.tmp");Files.write(temp,bytes);
            try{Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}catch(AtomicMoveNotSupportedException e){Files.move(temp,file,StandardCopyOption.REPLACE_EXISTING);}
            active=bytes;positions.clear();positions.putAll(next);rebuild();return true;
        }catch(Exception failure){plugin.getLogger().warning("Land board index save deferred: "+failure.getClass().getSimpleName());return false;}
    }
    private Spot spot(Block b){return new Spot(b.getWorld().getName(),b.getX(),b.getY(),b.getZ());}
    boolean protects(Block b){return protectedBlocks.containsKey(spot(b));}
    private String marked(Block b){return b.getState() instanceof Sign s?s.getPersistentDataContainer().get(tag,PersistentDataType.STRING):null;}
    boolean isBoard(Block b){String id=protectedBlocks.get(spot(b));return id!=null&&id.equals(marked(b));}
    private boolean inside(LandManager.Land l,Spot s){
        if(!l.world().getName().equals(s.world)||s.x<l.min().x()-2||s.x>l.max().x()+2||s.z<l.min().z()-2||s.z>l.max().z()+2||s.y<Math.max(l.world().getMinHeight()+1,l.min().y()-16)||s.y>Math.min(l.world().getMaxHeight()-2,l.max().y()+1))return false;
        // A small entrance sign may stand just outside the plot; never claim a neighbour's block.
        for(LandManager.Land other:lands.definitions())if(!other.id().equals(l.id())&&other.world().equals(l.world())&&s.x>=other.min().x()&&s.x<=other.max().x()&&s.z>=other.min().z()&&s.z<=other.max().z()&&s.y>=other.min().y()&&s.y-1<=other.max().y())return false;
        return true;
    }
    private boolean safe(Spot s) {
        if(!s.loaded())return false;Block b=s.block(),floor=b.getRelative(BlockFace.DOWN);
        if(!b.getType().isAir()||!b.getRelative(BlockFace.UP).getType().isAir()||!floor.getType().isOccluding()||floor.getType()==Material.MAGMA_BLOCK)return false;
        // Keep doors, ladders, existing signs and stairs untouched; do not occupy their approach.
        for(BlockFace face:List.of(BlockFace.NORTH,BlockFace.SOUTH,BlockFace.EAST,BlockFace.WEST)) {
            Block beside=b.getRelative(face);if(!beside.getWorld().isChunkLoaded(beside.getX()>>4,beside.getZ()>>4))return false;
            if(Tag.DOORS.isTagged(beside.getType())||Tag.TRAPDOORS.isTagged(beside.getType())||beside.getType()==Material.LADDER||Tag.STAIRS.isTagged(beside.getType()))return false;
        }
        return true;
    }
    private Spot choose(LandManager.Land l) {
        int a=l.min().x(),b=l.max().x(),c=l.min().z(),d=l.max().z();
        int[][] points={{(a+b)/2,c-2},{(a+b)/2,d+2},{a-2,(c+d)/2},{b+2,(c+d)/2},{a,c},{a,d},{b,c},{b,d}};
        for(int[] p:points) {
            if(!l.world().isChunkLoaded(p[0]>>4,p[1]>>4))continue;
            LinkedHashSet<Integer> heights=new LinkedHashSet<>();
            int bottom=Math.max(l.world().getMinHeight()+1,l.min().y()-16),ceiling=Math.min(l.world().getMaxHeight()-2,l.max().y()+1);
            for(int y=bottom;y<=Math.min(ceiling,bottom+31);y++)heights.add(y);
            int top=Math.min(ceiling,l.world().getHighestBlockYAt(p[0],p[1],HeightMap.MOTION_BLOCKING_NO_LEAVES)+1);
            for(int y=top;y>=Math.max(bottom,top-31);y--)heights.add(y);
            for(int y:heights){Spot s=new Spot(l.world().getName(),p[0],y,p[1]);if(inside(l,s)&&!protectedBlocks.containsKey(s)&&safe(s))return s;}
        }
        return null;
    }
    private String name(UUID id){String n=Bukkit.getOfflinePlayer(id).getName();return n==null?id.toString().substring(0,8):n;}
    private String shortText(String text,int max){return text.length()>max?text.substring(0,max-1)+"…":text;}
    private void text(String id,Spot s) {
        LandManager.Land l=lands.definition(id);if(l==null||!s.loaded()||!id.equals(marked(s.block())))return;
        Sign sign=(Sign)s.block().getState();String[] lines={"§6【领地公告】",shortText(l.title(),13),"主人："+name(l.owner()),"协作 "+l.members().size()+" 人 · 右键查看"};
        for(Side side:Side.values())for(int i=0;i<4;i++)sign.getSide(side).setLine(i,lines[i]);
        sign.setWaxed(true);sign.setEditable(false);sign.update(false,false);
    }
    private void ensure(String id) {
        if(!healthy)return;LandManager.Land l=lands.definition(id);Spot current=positions.get(id);
        if(l==null) {
            if(current!=null&&current.loaded()) {
                Map<String,Spot> next=new TreeMap<>(positions);next.remove(id);
                boolean ours=id.equals(marked(current.block()));if(save(next)&&ours)current.block().setType(Material.AIR,false);
            }return;
        }
        if(current!=null&&!current.loaded())return;
        if(current!=null&&inside(l,current)&&id.equals(marked(current.block()))){text(id,current);return;}
        Spot chosen=current!=null&&inside(l,current)&&safe(current)?current:choose(l);
        if(chosen==null)return;
        Map<String,Spot> next=new TreeMap<>(positions);next.put(id,chosen);
        if(!save(next))return;
        if(current!=null&&!current.equals(chosen)&&id.equals(marked(current.block())))current.block().setType(Material.AIR,false);
        if(!safe(chosen))return;Block block=chosen.block();block.setType(Material.OAK_SIGN,false);
        Rotatable rotation=(Rotatable)block.getBlockData();rotation.setRotation(chosen.x==l.min().x()?BlockFace.WEST:chosen.x==l.max().x()?BlockFace.EAST:chosen.z==l.min().z()?BlockFace.NORTH:BlockFace.SOUTH);block.setBlockData(rotation,false);
        Sign sign=(Sign)block.getState();sign.getPersistentDataContainer().set(tag,PersistentDataType.STRING,id);sign.setWaxed(true);sign.setEditable(false);sign.update(false,false);text(id,chosen);
    }
    void refresh(){Set<String> ids=new LinkedHashSet<>(positions.keySet());ids.addAll(lands.ids());ids.forEach(this::ensure);}
    void info(Player p,String id) {
        Spot s=positions.get(id);JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("landId",id);
        out.addProperty("status",s==null?"pending":s.loaded()&&id.equals(marked(s.block()))?"ready":"unverified");out.addProperty("indexReady",healthy);
        if(s!=null){out.addProperty("world",s.world);out.addProperty("x",s.x);out.addProperty("y",s.y);out.addProperty("z",s.z);}
        out.addProperty("membersCommand","/mycli land members "+id);out.addProperty("nextAction",s==null?"公告牌待安全空位或区块加载；先用 members 查询，联系服主检查；不会覆盖建筑或加载远方区块。":"亲自走近公告牌右键查看完整名单；主人可以在菜单授权/撤权。离线区块未验证不代表牌已丢失。");lands.machine(p,"MC_LAND_BOARD",out);
    }
    void audit(CommandSender sender){JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("indexReady",healthy);out.addProperty("indexed",positions.size());out.addProperty("loadPolicy","loaded_only");JsonArray rows=new JsonArray();for(LandManager.Land l:lands.definitions()){JsonObject row=new JsonObject();row.addProperty("landId",l.id());Spot s=positions.get(l.id());row.addProperty("status",s==null?"pending":s.loaded()&&l.id().equals(marked(s.block()))?"ready":"unverified");if(s!=null){row.addProperty("world",s.world);row.addProperty("x",s.x);row.addProperty("y",s.y);row.addProperty("z",s.z);}rows.add(row);}out.add("boards",rows);sender.sendMessage("MC_LAND_BOARDS "+out);}
    private void queue(String id){if(queued.add(id))Bukkit.getScheduler().runTask(plugin,()->{queued.remove(id);ensure(id);});}
    @EventHandler public void loaded(ChunkLoadEvent e){
        for(var entry:positions.entrySet()){Spot s=entry.getValue();if(s.world.equals(e.getWorld().getName())&&(s.x>>4)==e.getChunk().getX()&&(s.z>>4)==e.getChunk().getZ())queue(entry.getKey());}
        for(LandManager.Land l:lands.definitions())if(l.world().equals(e.getWorld())&&((l.min().x()-2)>>4)<=e.getChunk().getX()&&((l.max().x()+2)>>4)>=e.getChunk().getX()&&((l.min().z()-2)>>4)<=e.getChunk().getZ()&&((l.max().z()+2)>>4)>=e.getChunk().getZ())queue(l.id());
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void use(PlayerInteractEvent e) {
        Block b=e.getClickedBlock();if(b==null||e.getAction()!=Action.RIGHT_CLICK_BLOCK||e.getHand()!=org.bukkit.inventory.EquipmentSlot.HAND||!isBoard(b))return;
        e.setCancelled(true);String id=marked(b);Player p=e.getPlayer();if(p.getWorld()!=b.getWorld()||p.getLocation().distanceSquared(b.getLocation().add(.5,.5,.5))>49)return;
        Bukkit.getScheduler().runTask(plugin,()->{if(p.isOnline()){text(id,spot(b));access.openPublic(p,id);}});
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void breakBlock(BlockBreakEvent e){if(protects(e.getBlock())){e.setCancelled(true);e.getPlayer().sendMessage("§c领地公告牌及支撑方块受保护；右键查看归属和协作者，用 /mycli land board <ID> 查位置。调整位置请联系服主。");}}
    @EventHandler(priority=EventPriority.HIGHEST) public void damage(BlockDamageEvent e){if(protects(e.getBlock())){e.setCancelled(true);plugin.protectionAdvisor().denied(e.getPlayer(),"break",e.getBlock().getLocation(),"land_notice_board");}}
    @EventHandler(priority=EventPriority.HIGHEST) public void flow(BlockFromToEvent e){if(protects(e.getToBlock()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void bucket(PlayerBucketEmptyEvent e){if(protects(e.getBlock())||protects(e.getBlockClicked().getRelative(e.getBlockFace())))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void entityExplosion(EntityExplodeEvent e){e.blockList().removeIf(this::protects);}
    @EventHandler(priority=EventPriority.HIGHEST) public void blockExplosion(BlockExplodeEvent e){e.blockList().removeIf(this::protects);}
    @EventHandler(priority=EventPriority.HIGHEST) public void burn(BlockBurnEvent e){if(protects(e.getBlock()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void change(EntityChangeBlockEvent e){if(protects(e.getBlock()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void physics(BlockPhysicsEvent e){if(protects(e.getBlock()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void extend(BlockPistonExtendEvent e){if(e.getBlocks().stream().anyMatch(b->protects(b)||protects(b.getRelative(e.getDirection()))))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void retract(BlockPistonRetractEvent e){if(e.getBlocks().stream().anyMatch(b->protects(b)||protects(b.getRelative(e.getDirection()))))e.setCancelled(true);}
}
