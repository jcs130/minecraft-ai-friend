package org.qiandengji.vortex;

import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.*;
import org.bukkit.plugin.Plugin;

/** Two bounded entrance areas, using the existing charged/safe warp executor. */
final class TwinCityGates implements Listener {
    record Gate(String id,String world,int x,int y,int z,String destination){
        boolean contains(Location l){return l!=null&&l.getWorld()!=null&&l.getWorld().getName().equals(world)
            &&l.getX()>=x&&l.getX()<x+3&&l.getY()>=y&&l.getY()<y+3&&l.getZ()>=z&&l.getZ()<z+1;}
    }
    private final VortexBridge owner;
    private final List<Gate> gates;
    private final Map<UUID,Long> attempts=new HashMap<>();
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
    public void move(PlayerMoveEvent e){
        if(e instanceof PlayerTeleportEvent||e.getTo()==null||e.getFrom().getBlockX()==e.getTo().getBlockX()
                &&e.getFrom().getBlockY()==e.getTo().getBlockY()&&e.getFrom().getBlockZ()==e.getTo().getBlockZ())return;
        Player p=e.getPlayer();if(!Set.of(GameMode.SURVIVAL,GameMode.ADVENTURE).contains(p.getGameMode()))return;
        for(Gate gate:gates)if(gate.contains(e.getTo())&&!gate.contains(e.getFrom())){
            long now=System.currentTimeMillis();if(now-attempts.getOrDefault(p.getUniqueId(),0L)<5000)return;
            attempts.put(p.getUniqueId(),now);
            // Defer to the next tick, after the accepted move. Never cancel a
            // move at MONITOR, scan chunks, elevate permissions or fake success.
            Bukkit.getScheduler().runTask(owner,()->{
                if(!p.isOnline()||!gate.contains(p.getLocation()))return;
                Plugin af=Bukkit.getPluginManager().getPlugin("AgentFriend");
                try{if(af==null||!af.isEnabled())throw new IllegalStateException("travel unavailable");
                    af.getClass().getMethod("nativeCityTravel",Player.class,String.class).invoke(af,p,gate.destination());
                }catch(Exception unavailable){p.sendMessage("§e城门暂不可用；未执行传送。查询：/mycli status");}
            });return;
        }
    }
    @EventHandler public void quit(PlayerQuitEvent e){attempts.remove(e.getPlayer().getUniqueId());}
}
