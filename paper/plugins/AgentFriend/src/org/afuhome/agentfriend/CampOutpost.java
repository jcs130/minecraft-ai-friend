package org.afuhome.agentfriend;

import java.util.*;
import org.bukkit.*;
import org.bukkit.block.*;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;

/** Small additive camp buildings and real shared loot. Never replaces existing containers,
 * clears leftover items, copies villagers, or retries an unconfirmed inventory mutation. */
final class CampOutpost {
    private static final String ROOT="blackbanner-outpost";
    private final AgentFriendPlugin plugin;
    private final NamespacedKey owner,delivery;
    private record Cell(int x,int y,int z,Material material) {}
    private static final List<List<Integer>> CHEST_POINTS=List.of(
        List.of(-1080,67,-1113),List.of(-1081,67,-1112),List.of(-1079,67,-1111));
    CampOutpost(AgentFriendPlugin plugin){
        this.plugin=plugin;owner=new NamespacedKey(plugin,"camp_loot_chest");delivery=new NamespacedKey(plugin,"camp_loot_run");
    }
    List<Integer> chestPoint(){
        var point=plugin.getConfig().getIntegerList(ROOT+".chest.point");
        return CHEST_POINTS.contains(point)?point:CHEST_POINTS.getFirst();
    }
    private void save(){plugin.saveConfig();}
    private static boolean replaceable(Block block){
        return block.getType().isAir()||Set.of(Material.SHORT_GRASS,Material.TALL_GRASS,Material.FERN).contains(block.getType());
    }
    private List<Cell> shelter(int x,int z){
        List<Cell> cells=new ArrayList<>();
        for(int dx:new int[]{-2,2})for(int dz:new int[]{-1,1})for(int y=67;y<70;y++)
            cells.add(new Cell(x+dx,y,z+dz,Material.STRIPPED_SPRUCE_LOG));
        for(int dx=-2;dx<=2;dx++)for(int dz=-1;dz<=1;dz++)
            cells.add(new Cell(x+dx,70,z+dz,dx==0?Material.BLACK_WOOL:Material.WHITE_WOOL));
        cells.add(new Cell(x+1,67,z,Material.CRAFTING_TABLE));
        return List.copyOf(cells);
    }
    private void building(World world,String id,List<Cell> cells){
        String path=ROOT+".buildings."+id;
        String status=plugin.getConfig().getString(path,"");
        if(status.equals("applied"))return;
        if(cells.stream().anyMatch(c->!world.isChunkLoaded(c.x>>4,c.z>>4)))return;
        if(status.equals("prepared")){
            // Reconcile this original construction only; a partial/unknown edit is never replayed.
            if(cells.stream().allMatch(c->world.getBlockAt(c.x,c.y,c.z).getType()==c.material)){
                plugin.getConfig().set(path,"applied");save();
            }
            return;
        }
        if(cells.stream().anyMatch(c->!replaceable(world.getBlockAt(c.x,c.y,c.z))))return;
        for(Cell c:cells)if(c.y==67&&!world.getBlockAt(c.x,66,c.z).getType().isSolid())return;
        int minX=cells.stream().mapToInt(Cell::x).min().orElseThrow(),maxX=cells.stream().mapToInt(Cell::x).max().orElseThrow();
        int minZ=cells.stream().mapToInt(Cell::z).min().orElseThrow(),maxZ=cells.stream().mapToInt(Cell::z).max().orElseThrow();
        if(!world.getNearbyEntities(new Location(world,(minX+maxX+1)/2.0,68.5,(minZ+maxZ+1)/2.0),
                (maxX-minX+2)/2.0,2,(maxZ-minZ+2)/2.0,e->e instanceof org.bukkit.entity.LivingEntity).isEmpty())return;
        plugin.getConfig().set(ROOT+".building-before."+id,cells.stream().map(c->Map.of("point",List.of(c.x,c.y,c.z),"before",world.getBlockAt(c.x,c.y,c.z).getBlockData().getAsString(),"after",c.material.name())).toList());
        plugin.getConfig().set(path,"prepared");save();
        for(Cell c:cells)world.getBlockAt(c.x,c.y,c.z).setType(c.material,false);
        world.save();
        plugin.getConfig().set(path,"applied");save();
    }
    void prepare(){
        World world=Bukkit.getWorld("world");if(world==null)return;
        var futures=new ArrayList<java.util.concurrent.CompletableFuture<?>>();
        for(int cx=-69;cx<=-66;cx++)for(int cz=-71;cz<=-69;cz++){
            if(world.isChunkGenerated(cx,cz))futures.add(ExistingChunkAccess.load(plugin,world,cx,cz));
        }
        java.util.concurrent.CompletableFuture.allOf(futures.toArray(java.util.concurrent.CompletableFuture[]::new))
            .thenRun(()->{if(plugin.isEnabled())Bukkit.getScheduler().runTask(plugin,this::ensure);});
    }
    void ensure(){
        World world=Bukkit.getWorld("world");if(world==null)return;
        building(world,"north-shelter-v1",shelter(-1086,-1122));
        building(world,"east-shelter-v1",shelter(-1058,-1116));
        building(world,"south-shelter-v1",shelter(-1072,-1102));
        if(chest()!=null){
            if("prepared".equals(plugin.getConfig().getString(ROOT+".chest.status"))){plugin.getConfig().set(ROOT+".chest.status","applied");save();}
            return;
        }
        String status=plugin.getConfig().getString(ROOT+".chest.status","");
        if(!status.isEmpty())return; // missing/unknown original chest is not replaced
        for(var point:CHEST_POINTS){
            int x=point.get(0),y=point.get(1),z=point.get(2);
            if(!world.isChunkLoaded(x>>4,z>>4))continue;
            Block block=world.getBlockAt(x,y,z);
            if(!replaceable(block)||!AgentFriendPlugin.safeLanding(block)
                    ||!world.getNearbyEntities(block.getLocation().add(.5,.5,.5),.6,1,.6,
                        e->e instanceof org.bukkit.entity.LivingEntity).isEmpty())continue;
            plugin.getConfig().set(ROOT+".chest.point",point);plugin.getConfig().set(ROOT+".chest.status","prepared");save();
            block.setType(Material.CHEST,false);
            if(!(block.getState() instanceof Chest chest))return;
            chest.setCustomName("黑旗营地 · 战利品");chest.getPersistentDataContainer().set(owner,PersistentDataType.BYTE,(byte)1);
            if(!chest.update(false,false))return;
            world.save();plugin.getConfig().set(ROOT+".chest.status","applied");save();return;
        }
    }
    private Chest chest(){
        World world=Bukkit.getWorld("world");var point=chestPoint();if(world==null)return null;
        if(!world.isChunkLoaded(point.get(0)>>4,point.get(2)>>4))return null;
        if(world.getBlockAt(point.get(0),point.get(1),point.get(2)).getState() instanceof Chest chest
                &&chest.getPersistentDataContainer().getOrDefault(owner,PersistentDataType.BYTE,(byte)0)==1)return chest;
        return null;
    }
    /** Add to empty slots only. Leftovers/player items are never removed or overwritten. */
    static ItemStack[] append(ItemStack[] before,List<ItemStack> items){
        ItemStack[] next=Arrays.stream(before).map(item->item==null?null:item.clone()).toArray(ItemStack[]::new);
        for(ItemStack reward:items){
            int remaining=reward.getAmount();
            for(int slot=0;slot<next.length&&remaining>0;slot++)if(next[slot]==null||next[slot].getType().isAir()){
                ItemStack part=reward.clone();int amount=Math.min(remaining,part.getMaxStackSize());part.setAmount(amount);
                next[slot]=part;remaining-=amount;
            }
            if(remaining>0)throw new IllegalArgumentException("camp_reward_chest_full");
        }
        return next;
    }
    void publish(String run,List<ItemStack> rewards){
        UUID.fromString(run);
        String path=ROOT+".deliveries."+run;
        String status=plugin.getConfig().getString(path,"");
        if(status.equals("applied"))return;
        Chest chest=chest();if(chest==null)throw new IllegalArgumentException("camp_reward_chest_unavailable");
        if(run.equals(chest.getPersistentDataContainer().get(delivery,PersistentDataType.STRING))){
            plugin.getConfig().set(path,"applied");save();return;
        }
        if(status.equals("prepared"))throw new IllegalArgumentException("camp_reward_delivery_unconfirmed");
        ItemStack[] after=append(chest.getSnapshotInventory().getContents(),rewards);
        plugin.getConfig().set(path,"prepared");save();
        chest.getSnapshotInventory().setContents(after);
        chest.getPersistentDataContainer().set(delivery,PersistentDataType.STRING,run);
        if(!chest.update(false,false))throw new IllegalArgumentException("camp_reward_delivery_unconfirmed");
        chest.getWorld().save();
        plugin.getConfig().set(path,"applied");save();
    }
    void drop(String run,Location at,List<ItemStack> rewards){
        UUID.fromString(run);String path=ROOT+".drops."+run;
        String status=plugin.getConfig().getString(path,"");
        if(status.equals("applied"))return;
        if(status.equals("prepared"))throw new IllegalArgumentException("arena_reward_drop_unconfirmed");
        if(at.getWorld()==null||!at.getWorld().isChunkLoaded(at.getBlockX()>>4,at.getBlockZ()>>4))
            throw new IllegalArgumentException("arena_reward_drop_unavailable");
        plugin.getConfig().set(path,"prepared");save();
        var entities=new ArrayList<String>();
        for(ItemStack reward:rewards){
            var entity=at.getWorld().dropItemNaturally(at,reward.clone());
            entity.getPersistentDataContainer().set(delivery,PersistentDataType.STRING,run);
            entity.setPickupDelay(20);entities.add(entity.getUniqueId().toString());
        }
        at.getWorld().save();
        plugin.getConfig().set(ROOT+".drop-entities."+run,entities);
        plugin.getConfig().set(path,"applied");save();
    }
    int buildings(){
        var section=plugin.getConfig().getConfigurationSection(ROOT+".buildings");
        return section==null?0:(int)section.getKeys(false).stream().filter(k->"applied".equals(section.getString(k))).count();
    }
}
