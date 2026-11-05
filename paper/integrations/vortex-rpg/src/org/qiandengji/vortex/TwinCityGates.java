package org.qiandengji.vortex;

import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.block.Block;
import org.bukkit.event.*;
import org.bukkit.event.block.*;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
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
        boolean protects(Block b){return b!=null&&b.getWorld().getName().equals(world)
            &&b.getX()>=x-1&&b.getX()<=x+3&&b.getY()>=y-1&&b.getY()<=y+3
            &&b.getZ()>=z&&b.getZ()<=z+2;}
    }
    private final VortexBridge owner;
    private final List<Gate> gates;
    private final Map<UUID,Long> attempts=new HashMap<>();
    private final Map<UUID,Long> notices=new HashMap<>();
    private boolean protectedBlock(Block b){return gates.stream().anyMatch(g->g.protects(b));}
    private void notice(Player p,String text){long now=System.currentTimeMillis();
        if(now-notices.getOrDefault(p.getUniqueId(),0L)>=2000){notices.put(p.getUniqueId(),now);p.sendMessage(text);}}
    private void protectedNotice(Player p){notice(p,"§e双城传送门、按钮和说明牌受保护（含创造/OP）。请右键左柱按钮传送；需要迁移请联系服主维护。");}

    // The configured gate footprint is authoritative, including when a gate is
    // damaged. Do not grant implicit OP/creative bypass for accidental edits.
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)
    public void breakBlock(BlockBreakEvent e){if(protectedBlock(e.getBlock())){e.setCancelled(true);protectedNotice(e.getPlayer());}}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)
    public void placeBlock(BlockPlaceEvent e){boolean hit=protectedBlock(e.getBlockPlaced());
        if(e instanceof BlockMultiPlaceEvent multi)hit|=multi.getReplacedBlockStates().stream().anyMatch(s->protectedBlock(s.getBlock()));
        if(hit){e.setCancelled(true);protectedNotice(e.getPlayer());}}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)
    public void editSign(SignChangeEvent e){if(protectedBlock(e.getBlock())){e.setCancelled(true);protectedNotice(e.getPlayer());}}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)
    public void burn(BlockBurnEvent e){if(protectedBlock(e.getBlock()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)
    public void ignite(BlockIgniteEvent e){if(protectedBlock(e.getBlock()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)
    public void flow(BlockFromToEvent e){if(protectedBlock(e.getToBlock()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)
    public void bucket(PlayerBucketEmptyEvent e){if(protectedBlock(e.getBlock())){e.setCancelled(true);protectedNotice(e.getPlayer());}}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)
    public void entityChange(EntityChangeBlockEvent e){if(protectedBlock(e.getBlock()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)
    public void entityExplode(EntityExplodeEvent e){e.blockList().removeIf(this::protectedBlock);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)
    public void blockExplode(BlockExplodeEvent e){e.blockList().removeIf(this::protectedBlock);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)
    public void extend(BlockPistonExtendEvent e){if(protectedBlock(e.getBlock())||protectedBlock(e.getBlock().getRelative(e.getDirection()))||e.getBlocks().stream()
        .anyMatch(b->protectedBlock(b)||protectedBlock(b.getRelative(e.getDirection()))))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)
    public void retract(BlockPistonRetractEvent e){if(protectedBlock(e.getBlock())||protectedBlock(e.getBlock().getRelative(e.getDirection()))||e.getBlocks().stream()
        .anyMatch(b->protectedBlock(b)||protectedBlock(b.getRelative(e.getDirection()))
            ||protectedBlock(b.getRelative(e.getDirection().getOppositeFace()))))e.setCancelled(true);}
    private boolean built(Gate gate){
        World w=Bukkit.getWorld(gate.world());if(w==null||!w.isChunkLoaded((gate.x()-1)>>4,gate.z()>>4)||!w.isChunkLoaded((gate.x()+3)>>4,gate.z()>>4))return false;
        for(int y=gate.y();y<=gate.y()+2;y++)for(int x:List.of(gate.x()-1,gate.x()+3))
            if(w.getBlockAt(x,y,gate.z()).getType()!=Material.SMOOTH_QUARTZ)return false;
        for(int x=gate.x()-1;x<=gate.x()+3;x++)
            if(w.getBlockAt(x,gate.y()+3,gate.z()).getType()!=Material.CHISELED_QUARTZ_BLOCK)return false;
        return true;
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
        Player p=e.getPlayer();
        for(Gate gate:gates)if(gate.button(e.getClickedBlock())&&gate.inReach(p)){
            if(!Set.of(GameMode.SURVIVAL,GameMode.ADVENTURE).contains(p.getGameMode())){
                notice(p,"§e双城门供生存/冒险角色使用；你当前为"+(p.getGameMode()==GameMode.CREATIVE?"创造":"旁观")+"模式。请切回生存后再点击左柱按钮；未传送、未扣魔力。");return;}
            if(!built(gate)){notice(p,"§e双城门框损坏，暂不能传送；请联系服主修复，不要改成命令方块。未扣魔力。");return;}
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
    @EventHandler public void quit(PlayerQuitEvent e){attempts.remove(e.getPlayer().getUniqueId());notices.remove(e.getPlayer().getUniqueId());}
}
