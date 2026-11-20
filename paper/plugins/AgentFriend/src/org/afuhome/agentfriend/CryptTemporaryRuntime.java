package org.afuhome.agentfriend;

import com.google.gson.Gson;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.Block;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;
import org.bukkit.entity.LivingEntity;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.persistence.PersistentDataType;
import static org.afuhome.agentfriend.CryptTemporaryBlocks.*;

/** Only the configured crypt can acquire a temporary build reservation. */
final class CryptTemporaryRuntime implements AutoCloseable {
    private static final Gson JSON = new Gson();
    private record Saved(long revision, UUID world, Image image,List<CryptCleanupReceipts.Entry> cleanup) {}
    private record Bounds(int x0,int y0,int z0,int x1,int y1,int z1) {
        boolean contains(Location p) {
            return p.getBlockX()>=x0 && p.getBlockX()<=x1 && p.getBlockY()>=y0 && p.getBlockY()<=y1 && p.getBlockZ()>=z0 && p.getBlockZ()<=z1;
        }
    }
    private final AgentFriendPlugin plugin;
    private final SiteDungeonManager sites;
    private final DurableConfigFiles store;
    private final World world;
    private final List<Bounds> zones;
    private final Location exit;
    private final String structure;
    private final boolean enabled;
    private final CryptTemporaryBlocks blocks;
    private final CryptCleanupReceipts cleanup;
    private final Map<BlockPlaceEvent,Change> pending = new IdentityHashMap<>();
    private boolean faulted;
    private boolean warming;

    static CryptTemporaryRuntime open(AgentFriendPlugin plugin,SiteDungeonManager sites) throws Exception {
        Path dir=plugin.getDataFolder().toPath().resolve("crypt-temporary");
        ConfigurationSection cfg=plugin.getConfig().getConfigurationSection("crypt-temporary");
        if ((cfg==null||!cfg.getBoolean("enabled",false))&&!Files.exists(dir)) return null;
        if(cfg==null)throw new IOException("crypt_temporary_restore_configuration_required");
        return new CryptTemporaryRuntime(plugin,sites,cfg,dir);
    }
    private static List<Integer> ints(List<?> list,int n) {
        if(list.size()!=n||list.stream().anyMatch(v->!(v instanceof Integer)))throw new IllegalArgumentException("crypt_invalid_coordinates");
        return list.stream().map(Integer.class::cast).toList();
    }
    private CryptTemporaryRuntime(AgentFriendPlugin plugin,SiteDungeonManager sites,ConfigurationSection cfg,Path dir) throws Exception {
        this.plugin=plugin;this.sites=sites;enabled=cfg.getBoolean("enabled",false);
        UUID worldId=UUID.fromString(Objects.requireNonNull(cfg.getString("world-uuid")));
        world=Objects.requireNonNull(Bukkit.getWorld(worldId),"crypt_world_unavailable");
        structure=Objects.requireNonNull(cfg.getString("generated-structure-id"));
        if(!structure.matches("generated:[a-z0-9_.-]+:[a-z0-9_/.-]+:-?[0-9]+:-?[0-9]+:-?[0-9]+"))throw new IllegalArgumentException("crypt_invalid_structure_id");
        zones=new ArrayList<>();
        for(Object value:cfg.getList("reserved-boxes",List.of())) {
            if(!(value instanceof List<?> row))throw new IllegalArgumentException("crypt_invalid_box");
            var b=ints(row,6);if(b.get(0)>b.get(3)||b.get(1)>b.get(4)||b.get(2)>b.get(5)||b.get(1)<world.getMinHeight()||b.get(4)>=world.getMaxHeight())throw new IllegalArgumentException("crypt_invalid_box");
            zones.add(new Bounds(b.get(0),b.get(1),b.get(2),b.get(3),b.get(4),b.get(5)));
        }
        if(zones.isEmpty()||zones.size()>64)throw new IllegalArgumentException("crypt_invalid_reserved_boxes");
        var landing=ints(cfg.getList("exit-feet",List.of()),3);
        exit=new Location(world,landing.get(0)+.5,landing.get(1),landing.get(2)+.5);
        if(zones.stream().anyMatch(b->exit.getBlockX()>=b.x0&&exit.getBlockX()<=b.x1&&exit.getBlockZ()>=b.z0&&exit.getBlockZ()<=b.z1&&exit.getY()>=b.y0))
            throw new IllegalArgumentException("crypt_exit_above_reserved_zone");
        Rules rules=new Rules(Math.multiplyExact(cfg.getLong("exit-seconds"),1000L),cfg.getInt("maximum-cells"),Set.copyOf(cfg.getStringList("materials")));
        if(rules.maximumCells()>1024)throw new IllegalArgumentException("crypt_single_reset_budget_1024");
        Files.createDirectories(dir);Path path=dir.resolve("blocks.json");
        store=new DurableConfigFiles(path);
        try{
            byte[] bytes=Files.exists(path)?Files.readAllBytes(path):JSON.toJson(new Saved(0,worldId,Image.idle(),List.of())).getBytes(StandardCharsets.UTF_8);
            var disk=JSON.fromJson(new String(bytes,StandardCharsets.UTF_8),Saved.class);
            var recovered=JSON.fromJson(new String(store.initialize(bytes,disk.revision),StandardCharsets.UTF_8),Saved.class);
            if(!worldId.equals(recovered.world))throw new IOException("crypt_journal_world_changed");
            cleanup=new CryptCleanupReceipts(worldId,recovered.cleanup==null?List.of():recovered.cleanup);
            blocks=new CryptTemporaryBlocks(worldId,rules,new Journal(){
                public Image load(){return recovered.image;}
                public void commit(Image image)throws IOException{
                    persist(image);
                }
            });
        }catch(Exception e){store.close();throw e;}
    }
    private void persist(Image image)throws IOException{
        long revision=store.revision()+1;
        store.commit(JSON.toJson(new Saved(revision,world.getUID(),image,cleanup.rows())).getBytes(StandardCharsets.UTF_8),revision);
    }
    private boolean zone(Location at){return world.equals(at.getWorld())&&zones.stream().anyMatch(box->box.contains(at));}
    private Cell cell(Location at){return new Cell(world.getUID(),at.getBlockX(),at.getBlockY(),at.getBlockZ());}
    private void fault(Exception failure){faulted=true;plugin.getLogger().severe("Crypt temporary build journal retained: "+failure);}
    String structure(){return structure;}
    private Place data(Player p,Location at,Material before,Material after){
        Image image=blocks.image();return new Place(p.getUniqueId(),image.run(),cell(at),sites.cryptContains(at),zone(at),
                true,false,sites.cryptMember(p,image.run()),sites.cryptContains(p.getLocation())&&p.isOnline()&&!p.isDead()
                &&p.getGameMode()==GameMode.SURVIVAL&&!plugin.isObserver(p),true,before.getKey().toString(),after.getKey().toString());
    }
    boolean eligible(Player p,Location at,Material before,Material after){
        return enabled&&!faulted&&before!=null&&after!=null&&blocks.inspect(data(p,at,before,after),"place",System.currentTimeMillis())==Decision.ALLOWED;
    }
    boolean reserve(BlockPlaceEvent event){
        Player p=event.getPlayer();Block b=event.getBlockPlaced();Material before=event.getBlockReplacedState().getType(),after=b.getType();
        if(!eligible(p,b.getLocation(),before,after)||plugin.generatedStructures()==null
                ||plugin.generatedStructures().temporaryConflict(b.getLocation(),structure)!=null)return false;
        UUID id=UUID.randomUUID();
        try{
            Place data=data(p,b.getLocation(),before,after);
            if(blocks.reserve(data,id,System.currentTimeMillis())!=Decision.ALLOWED)return false;
            pending.put(event,new Change(data.cell(),data.original(),data.placed(),id));return true;
        }catch(Exception failure){fault(failure);return false;}
    }
    void finishPlacement(BlockPlaceEvent event){
        Change c=pending.remove(event);
        if(c==null||!event.isCancelled()&&event.canBuild())return;
        try{blocks.cancelled(blocks.image().run(),c.cell(),c.placement());}catch(Exception failure){fault(failure);}
    }
    boolean reservedEvent(BlockPlaceEvent e){return pending.containsKey(e);}
    void left(UUID id){blocks.left(id);}
    boolean tracksExit(UUID id){return blocks.tracksExit(id);}
    String restored(boolean known,UUID run){
        try{
            String state=blocks.afterRunRestore(known,run);
            if(!known||state.equals("different_checkpoint")){fault(new IOException(state));return state;}
            return recoverOlder();
        }catch(Exception failure){fault(failure);return "crypt_build_restore_unavailable";}
    }
    // The encounter itself is already durably admitted. A failed secondary journal disables
    // temporary building instead of falsely reporting a failed encounter and encouraging a retry.
    void begin(UUID run){if(!enabled)return;try{blocks.begin(run);}catch(Exception e){fault(e);}}
    void end(UUID run,Set<UUID> present){
        if(!Objects.equals(run,blocks.image().run()))return;
        try{blocks.finish(run,present,System.currentTimeMillis());}catch(Exception failure){fault(failure);}
    }
    private boolean load(int x,int z){return world.isChunkLoaded(x>>4,z>>4);}
    private boolean readyChunks(){
        Set<Long> needed=new LinkedHashSet<>();
        for(Change c:blocks.image().changes())if(!load(c.cell().x(),c.cell().z()))needed.add(chunkKey(c.cell().x(),c.cell().z()));
        for(var c:cleanup.rows())if(!load(c.cell().x(),c.cell().z()))needed.add(chunkKey(c.cell().x(),c.cell().z()));
        if((!blocks.image().changes().isEmpty()||!cleanup.rows().isEmpty())&&!load(exit.getBlockX(),exit.getBlockZ()))
            needed.add(chunkKey(exit.getBlockX(),exit.getBlockZ()));
        if(needed.isEmpty())return true;
        if(!warming){warming=true;warm(new ArrayDeque<>(needed));}return false;
    }
    private static long chunkKey(int x,int z){return ((long)(x>>4)<<32)|((z>>4)&0xffffffffL);}
    private void warm(Deque<Long> queue){
        if(queue.isEmpty()||!plugin.isEnabled()){warming=false;return;}
        long key=queue.removeFirst();
        Bukkit.getScheduler().runTask(plugin,()->ExistingChunkAccess.load(plugin,world,(int)(key>>32),(int)key).whenComplete((chunk,error)->{
            if(!plugin.isEnabled())return;
            Bukkit.getScheduler().runTask(plugin,()->{
                if(chunk==null||error!=null){warming=false;plugin.getLogger().warning("Crypt cleanup awaits an existing recorded chunk");}
                else warm(queue);
            });
        }));
    }
    private final CryptCleanupReceipts.Markers markers=new CryptCleanupReceipts.Markers(){
        private NamespacedKey key(Cell c){return new NamespacedKey(plugin,"crypt_reset_"+(c.x()&15)+"_"+c.y()+"_"+(c.z()&15));}
        public Long read(Cell c){
            if(!load(c.x(),c.z()))return null;
            return world.getChunkAt(c.x()>>4,c.z()>>4).getPersistentDataContainer().getOrDefault(key(c),PersistentDataType.LONG,0L);
        }
        public void mark(Cell c,long generation){
            world.getChunkAt(c.x()>>4,c.z()>>4).getPersistentDataContainer().set(key(c),PersistentDataType.LONG,generation);
        }
    };
    private Terrain terrain(){
        return new Terrain(){
            public String read(Cell c){return load(c.x(),c.z())?world.getBlockAt(c.x(),c.y(),c.z()).getBlockData().getAsString():null;}
            public boolean ownedBy(Cell c,UUID run,UUID placement){return Objects.equals(blocks.image().run(),run)&&blocks.image().changes().stream().anyMatch(v->v.cell().equals(c)&&v.placement().equals(placement));}
            private Set<LivingEntity> exposed(Set<Cell> cells){
                Set<LivingEntity> result=new LinkedHashSet<>();
                for(Cell cell:cells){
                    var column=new org.bukkit.util.BoundingBox(cell.x(),cell.y(),cell.z(),cell.x()+1,world.getMaxHeight(),cell.z()+1);
                    for(var entity:world.getNearbyEntities(column)){
                        if(!(entity instanceof LivingEntity living))continue;
                        boolean supported=false;
                        int feet=(int)Math.floor(entity.getBoundingBox().getMinY());
                        for(int y=cell.y()+1;y<feet&&!supported;y++){
                            Block intervening=world.getBlockAt(cell.x(),y,cell.z());
                            if(!cells.contains(new Cell(world.getUID(),cell.x(),y,cell.z()))&&intervening.getType().isSolid())supported=true;
                        }
                        if(!supported)result.add(living);
                    }
                }
                return result;
            }
            public boolean clearOccupants(Set<Cell> cells){
                var affected=exposed(cells);
                if(affected.isEmpty())return true;
                if(!load(exit.getBlockX(),exit.getBlockZ())||!AgentFriendPlugin.safeLanding(exit.getBlock()))return false;
                Set<Block> assigned=new HashSet<>();
                for(LivingEntity occupant:affected){
                    Location destination=null;
                    for(int radius=0;radius<=3&&destination==null;radius++)for(int dx=-radius;dx<=radius&&destination==null;dx++)for(int dz=-radius;dz<=radius;dz++){
                        Location candidate=exit.clone().add(dx,0,dz);
                        if(Math.max(Math.abs(dx),Math.abs(dz))!=radius||!world.isChunkLoaded(candidate.getBlockX()>>4,candidate.getBlockZ()>>4)
                                ||zones.stream().anyMatch(b->candidate.getBlockX()>=b.x0&&candidate.getBlockX()<=b.x1&&candidate.getBlockZ()>=b.z0&&candidate.getBlockZ()<=b.z1&&candidate.getY()>=b.y0)
                                ||!TeamTravelSafety.insideBorder(candidate)||!AgentFriendPlugin.safeLanding(candidate.getBlock())
                                ||occupant.collidesAt(candidate)||assigned.contains(candidate.getBlock())
                                ||!world.getNearbyEntities(candidate.clone().add(0,.9,0),.45,.85,.45).isEmpty())continue;
                        destination=candidate;break;
                    }
                    if(destination==null||!occupant.teleport(destination)||!world.equals(occupant.getWorld())
                            ||occupant.getLocation().distanceSquared(destination)>2||!TeamTravelSafety.insideBorder(occupant.getLocation())
                            ||!AgentFriendPlugin.safeLanding(occupant.getLocation().getBlock()))return false;
                    assigned.add(destination.getBlock());occupant.setFallDistance(0);
                }
                return exposed(cells).isEmpty();
            }
            public void restoreWithoutDrops(Cell c,String original){world.getBlockAt(c.x(),c.y(),c.z()).setBlockData(Bukkit.createBlockData(original),false);}
            public void flushAndVerify(List<Change> changes)throws IOException{
                for(Change row:changes)if(!row.original().equals(read(row.cell())))throw new IOException("crypt_original_image_unconfirmed");
                if(!changes.isEmpty()){
                    long generation=store.revision()+1;
                    cleanup.stage(changes,generation);
                    for(Change row:changes)markers.mark(row.cell(),generation);
                }
            }
        };
    }
    String recoverOlder(){
        if(faulted)return "crypt_build_journal_unavailable";
        if(!readyChunks())return "await_existing_chunk";
        return cleanup.recover(blocks.image().changes(),terrain(),markers);
    }
    String prepareNext(){
        long started=System.nanoTime();
        int cells=blocks.image().changes().size();
        String result;
        try{
            String older=recoverOlder();
            result=older.equals("ready")?blocks.resetBeforeAdmission(terrain()):older;
        }catch(Exception failure){fault(failure);result="crypt_build_restore_unavailable";}
        if(cells>0||!result.equals("ready"))plugin.getLogger().info("MC_CRYPT_CLEANUP status="+result+" cells="+cells+" tracked="+cleanup.rows().size()+" elapsedMicros="+(System.nanoTime()-started)/1000);
        return result;
    }
    boolean relinquish(int x,int y,int z)throws Exception{
        Cell cell=new Cell(world.getUID(),x,y,z);
        boolean archived=cleanup.forget(cell);
        try{
            if(blocks.relinquish(cell))return true;
            if(archived)persist(blocks.image());
            return archived;
        }catch(Exception failed){fault(failed);throw failed;}
    }
    public void close(){try{store.close();}catch(IOException failed){fault(failed);}}
}
