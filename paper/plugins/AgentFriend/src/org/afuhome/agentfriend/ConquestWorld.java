package org.afuhome.agentfriend;

import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.event.*;
import org.bukkit.event.block.*;
import org.bukkit.event.entity.*;

/** Bind the real imported map. Never generate a replacement void castle or paste
 * over existing terrain. Protect only the configured encounter footprint. */
final class ConquestWorld implements Listener {
    static final String WORLD="aincrad";
    private record Area(int minX,int maxX,int minY,int maxY,int minZ,int maxZ) {
        boolean contains(Location l){return l.getX()>=minX&&l.getX()<=maxX&&l.getY()>=minY&&l.getY()<=maxY&&l.getZ()>=minZ&&l.getZ()<=maxZ;}
    }
    private final List<Area> areas;
    private final AgentFriendPlugin plugin;
    private ConquestWorld(AgentFriendPlugin plugin,List<Area> areas){this.plugin=plugin;this.areas=List.copyOf(areas);}
    static boolean load(AgentFriendPlugin plugin){
        if(!plugin.getConfig().getBoolean("conquest-world.enabled",false))return false;
        Path directory=Bukkit.getWorldContainer().toPath().resolve(WORLD);
        if(!Files.isRegularFile(directory.resolve("level.dat"))||!Files.isDirectory(directory.resolve("region")))
            throw new IllegalStateException("conquest_map_missing_import_real_aincrad_first");
        // Import is a separate audited operation. Do not change the shared world's
        // gamerules, spawn, clock, blocks or player state while binding a campaign.
        World world=Bukkit.getWorld(WORLD);
        if(world==null)world=new WorldCreator(WORLD).createWorld();
        if(world==null)throw new IllegalStateException("conquest_world_unavailable");
        var sites=YamlConfiguration.loadConfiguration(new java.io.File(plugin.getDataFolder(),"dungeons.yml")).getConfigurationSection("sites");
        var areas=new ArrayList<Area>();
        if(sites!=null)for(String id:sites.getKeys(false)){
            var s=sites.getConfigurationSection(id);
            if(s==null||s.getInt("conquest-floor",0)<=0||!WORLD.equals(s.getString("world")))continue;
            int minX=Integer.MAX_VALUE,minY=minX,minZ=minX,maxX=Integer.MIN_VALUE,maxY=maxX,maxZ=maxX;
            for(var room:s.getMapList("rooms")){
                if(!(room.get("center") instanceof List<?> xyz)||xyz.size()!=3)throw new IllegalArgumentException("conquest_room_invalid");
                int x=Integer.parseInt(xyz.get(0).toString()),y=Integer.parseInt(xyz.get(1).toString()),z=Integer.parseInt(xyz.get(2).toString());
                if(Math.abs((long)x)>29_000_000||Math.abs((long)z)>29_000_000||y<-60||y>309)throw new IllegalArgumentException("conquest_room_bounds");
                minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
            }
            if(minX==Integer.MAX_VALUE||maxX-minX>128||maxY-minY>128||maxZ-minZ>128)throw new IllegalArgumentException("conquest_site_bounds");
            areas.add(new Area(minX-24,maxX+24,minY-8,maxY+12,minZ-24,maxZ+24));
        }
        Bukkit.getPluginManager().registerEvents(new ConquestWorld(plugin,areas),plugin);
        return !areas.isEmpty();
    }
    private boolean protectedAt(Location l){return l.getWorld()!=null&&WORLD.equals(l.getWorld().getName())&&areas.stream().anyMatch(a->a.contains(l));}
    private boolean editor(org.bukkit.entity.Player p){return p.isOp()||plugin.trustedBlockEditor(p);}
    @EventHandler(ignoreCancelled=true) public void breaking(BlockBreakEvent e){if(protectedAt(e.getBlock().getLocation())&&!editor(e.getPlayer())){e.setCancelled(true);e.getPlayer().sendActionBar(net.kyori.adventure.text.Component.text("艾恩葛朗特建筑受保护，可探索与战斗；/aincrad 查看往返。"));}}
    @EventHandler(ignoreCancelled=true) public void placing(BlockPlaceEvent e){if(protectedAt(e.getBlock().getLocation())&&!editor(e.getPlayer()))e.setCancelled(true);}
    @EventHandler(ignoreCancelled=true) public void explosion(EntityExplodeEvent e){e.blockList().removeIf(b->protectedAt(b.getLocation()));}
    @EventHandler(ignoreCancelled=true) public void blocks(BlockExplodeEvent e){e.blockList().removeIf(b->protectedAt(b.getLocation()));}
    @EventHandler(ignoreCancelled=true) public void mobGrief(EntityChangeBlockEvent e){if(protectedAt(e.getBlock().getLocation()))e.setCancelled(true);}
    @EventHandler(ignoreCancelled=true) public void burning(BlockBurnEvent e){if(protectedAt(e.getBlock().getLocation()))e.setCancelled(true);}
    @EventHandler(ignoreCancelled=true) public void fluids(BlockFromToEvent e){if(protectedAt(e.getToBlock().getLocation()))e.setCancelled(true);}
    @EventHandler(ignoreCancelled=true) public void extending(BlockPistonExtendEvent e){
        if(e.getBlocks().stream().anyMatch(b->protectedAt(b.getLocation())||protectedAt(b.getRelative(e.getDirection()).getLocation())))e.setCancelled(true);
    }
    @EventHandler(ignoreCancelled=true) public void retracting(BlockPistonRetractEvent e){
        if(e.getBlocks().stream().anyMatch(b->protectedAt(b.getLocation())||protectedAt(b.getRelative(e.getDirection()).getLocation())))e.setCancelled(true);
    }
}
