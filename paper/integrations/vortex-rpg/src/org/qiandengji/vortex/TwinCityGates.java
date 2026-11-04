package org.qiandengji.vortex;

import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.block.Block;
import org.bukkit.event.*;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.*;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.plugin.Plugin;

/** Deliberate button interaction, using the existing charged/safe warp executor. */
final class TwinCityGates implements Listener {
    record Gate(String id,String world,int x,int y,int z,String destination){
        // South face of the left pillar. Stone buttons cannot be fired by arrows.
        boolean button(Block b){return b!=null&&b.getWorld().getName().equals(world)
            &&b.getX()==x-1&&b.getY()==y+1&&b.getZ()==z+1&&b.getType()==Material.STONE_BUTTON;}
        boolean inReach(Player p){return p.getWorld().getName().equals(world)
            &&p.getEyeLocation().distanceSquared(new Location(p.getWorld(),x-.5,y+1.5,z+1.5))<=30.25;}
    }
    private final VortexBridge owner;
    private final List<Gate> gates;
    private final Map<UUID,Long> attempts=new HashMap<>();
    private boolean built(Gate gate){
        World w=Bukkit.getWorld(gate.world());if(w==null||!w.isChunkLoaded((gate.x()-1)>>4,gate.z()>>4)||!w.isChunkLoaded((gate.x()+3)>>4,gate.z()>>4))return false;
        return w.getBlockAt(gate.x()-1,gate.y(),gate.z()).getType()==Material.SMOOTH_QUARTZ
            &&w.getBlockAt(gate.x()+3,gate.y(),gate.z()).getType()==Material.SMOOTH_QUARTZ
            &&w.getBlockAt(gate.x()+1,gate.y()+3,gate.z()).getType()==Material.CHISELED_QUARTZ_BLOCK;
    }
    TwinCityGates(VortexBridge owner){
        this.owner=owner;var root=owner.getConfig().getConfigurationSection("city-gates");
        List<Gate> values=new ArrayList<>();
        if(root!=null&&root.getBoolean("enabled",false))for(String id:List.of("village","aincrad")){
            var c=Objects.requireNonNull(root.getConfigurationSection(id));
            String target=c.getString("destination");if(!Set.of("village","aincrad").contains(target))throw new IllegalArgumentException("city destination");
            values.add(new Gate(id,c.getString("world"),c.getInt("x"),c.getInt("y"),c.getInt("z"),target));
        }
        gates=List.copyOf(values);
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void interact(PlayerInteractEvent e){
        if(e.getAction()!=Action.RIGHT_CLICK_BLOCK||e.getHand()!=EquipmentSlot.HAND
                ||e.useInteractedBlock()==Event.Result.DENY)return;
        Player p=e.getPlayer();if(!Set.of(GameMode.SURVIVAL,GameMode.ADVENTURE).contains(p.getGameMode()))return;
        for(Gate gate:gates)if(gate.button(e.getClickedBlock())&&gate.inReach(p)&&built(gate)){
            long now=System.currentTimeMillis();if(now-attempts.getOrDefault(p.getUniqueId(),0L)<5000)return;
            attempts.put(p.getUniqueId(),now);
            // Honor protection decisions and recheck next tick. Never scan/load
            // chunks, elevate permissions or dispatch a console teleport.
            Block button=e.getClickedBlock();
            Bukkit.getScheduler().runTask(owner,()->{
                if(!p.isOnline()||!Set.of(GameMode.SURVIVAL,GameMode.ADVENTURE).contains(p.getGameMode())
                        ||!gate.inReach(p)||!gate.button(button)||!built(gate))return;
                Plugin af=Bukkit.getPluginManager().getPlugin("AgentFriend");
                try{if(af==null||!af.isEnabled())throw new IllegalStateException("travel unavailable");
                    af.getClass().getMethod("nativeCityTravel",Player.class,String.class).invoke(af,p,gate.destination());
                }catch(Exception unavailable){p.sendMessage("§e城门暂不可用；未执行传送。查询：/mycli status");}
            });return;
        }
    }
    @EventHandler public void quit(PlayerQuitEvent e){attempts.remove(e.getPlayer().getUniqueId());}
}
