package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.util.*;
import org.bukkit.*;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerTeleportEvent;

/** Follow one accepted owner teleport using already-loaded safe destinations only. */
final class NativeMaidOwnerTravel implements Listener {
    private final HybridMaidPlugin plugin;
    private final Map<UUID,Long> generations=new HashMap<>();
    NativeMaidOwnerTravel(HybridMaidPlugin plugin){this.plugin=plugin;Bukkit.getPluginManager().registerEvents(this,plugin);}
    private boolean follows(EntityMaid maid){return maid.isAlive()&&!maid.isRemoved()&&!maid.isNoAi()&&!maid.isMaidInSittingPose()&&!maid.isHomeModeEnable()&&!maid.isSleeping()&&maid.canBrainMoving()
        &&(maid.getTask().getUid().toString().equals("touhou_little_maid:idle")||!maid.getPersistentData().getString("qiandengji_auto_defence_task").isEmpty());}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void teleport(PlayerTeleportEvent event){
        if(event.getTo()==null||event.getPlayer().getGameMode()==GameMode.SPECTATOR)return;
        Location from=event.getFrom(),to=event.getTo().clone();
        if(from.getWorld().equals(to.getWorld())&&from.distanceSquared(to)<256)return;
        var owner=event.getPlayer();long generation=generations.merge(owner.getUniqueId(),1L,Long::sum);
        List<UUID> companions=new ArrayList<>();
        for(String key:plugin.registeredMaids().keySet()){
            EntityMaid maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(UUID.fromString(key)));
            if(maid!=null&&plugin.sharedDialogueEnabled(maid)&&owner.getUniqueId().equals(maid.getOwnerUUID())&&follows(maid)
                &&maid.getBukkitEntity().getWorld().equals(from.getWorld())&&maid.getBukkitEntity().getLocation().distanceSquared(from)<=256)companions.add(maid.getUUID());
        }
        Bukkit.getScheduler().runTaskLater(plugin,()->{
            if(!Objects.equals(generations.get(owner.getUniqueId()),generation))return;
            generations.remove(owner.getUniqueId());
            if(Bukkit.getPlayer(owner.getUniqueId())!=owner||!owner.isOnline()||owner.isDead()||owner.getGameMode()==GameMode.SPECTATOR||!owner.getWorld().equals(to.getWorld())||owner.getLocation().distanceSquared(to)>64)return;
            for(UUID id:companions){
                EntityMaid maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));
                if(maid==null||!plugin.sharedDialogueEnabled(maid)||!owner.getUniqueId().equals(maid.getOwnerUUID())||!follows(maid))continue;
                if(maid.getBukkitEntity().getWorld().equals(owner.getWorld())&&maid.getBukkitEntity().getLocation().distanceSquared(owner.getLocation())<16)continue;
                Location landing=safe(owner.getLocation());
                if(landing==null){owner.sendMessage("[女仆·随行] 附近没有已加载的安全落点，肥鱼暂未传送；请先站到有地面、两格净空的地方，再查询女仆位置。");continue;}
                // Original entity only; Bukkit/NeoForge transfer retains its UUID and complete inventory.
                if(!maid.getBukkitEntity().teleport(landing,PlayerTeleportEvent.TeleportCause.PLUGIN))owner.sendMessage("[女仆·随行] 本次传送未成功，原女仆仍保留；请查询 context，不重复创建或复活。");
            }
        },2);
    }
    private static Location safe(Location centre){
        World world=centre.getWorld();
        for(int dy:new int[]{0,1,-1,2})for(int[] offset:new int[][]{{1,0},{-1,0},{0,1},{0,-1},{1,1},{-1,-1}}){
            int x=centre.getBlockX()+offset[0],y=centre.getBlockY()+dy,z=centre.getBlockZ()+offset[1];
            if(y<=world.getMinHeight()||y+2>=world.getMaxHeight()||!world.isChunkLoaded(x>>4,z>>4))continue;
            Location at=new Location(world,x+0.5,y,z+0.5,centre.getYaw(),0);
            if(!world.getWorldBorder().isInside(at))continue;
            var floor=world.getBlockAt(x,y-1,z);var feet=world.getBlockAt(x,y,z);var head=world.getBlockAt(x,y+1,z);
            if(floor.getType().isSolid()&&floor.getType().isOccluding()&&feet.getType().isAir()&&head.getType().isAir()
                &&!Set.of(Material.MAGMA_BLOCK,Material.CACTUS,Material.CAMPFIRE,Material.SOUL_CAMPFIRE).contains(floor.getType()))return at;
        }return null;
    }
}
