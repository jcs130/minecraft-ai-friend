package org.afuhome.agentfriend;

import org.bukkit.*;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.block.*;
import org.bukkit.event.entity.*;
import org.bukkit.event.player.*;

/** Permanent authored-site protection, independent of combat runs and wilderness grants.
 * Does not restrict combat, doors, chests or natural terrain outside authored sites. */
final class DungeonIntegrity implements Listener {
    private final AgentFriendPlugin plugin;
    DungeonIntegrity(AgentFriendPlugin plugin){this.plugin=plugin;Bukkit.getPluginManager().registerEvents(this,plugin);}
    boolean protectedAt(Block b){return plugin.siteDungeons().activityArea(b.getLocation())
            ||plugin.dungeon().deniesEdit(b.getLocation());}
    private boolean deny(Player p,Block b){
        if(plugin.trustedBlockEditor(p)||!protectedAt(b))return false;
        plugin.protectionAdvisor().denied(p,"break",b.getLocation(),"site_dungeon",plugin.siteDungeons().protectionArea(b.getLocation()));return true;
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void damage(BlockDamageEvent e){if(deny(e.getPlayer(),e.getBlock()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void multi(BlockMultiPlaceEvent e){for(var b:e.getReplacedBlockStates())if(deny(e.getPlayer(),b.getBlock())){e.setCancelled(true);return;}}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void bucket(PlayerBucketEmptyEvent e){if(deny(e.getPlayer(),e.getBlockClicked())||deny(e.getPlayer(),e.getBlockClicked().getRelative(e.getBlockFace())))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void fill(PlayerBucketFillEvent e){if(deny(e.getPlayer(),e.getBlockClicked())||deny(e.getPlayer(),e.getBlockClicked().getRelative(e.getBlockFace())))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void entityChange(EntityChangeBlockEvent e){if(protectedAt(e.getBlock()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void entityExplosion(EntityExplodeEvent e){e.blockList().removeIf(this::protectedAt);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void blockExplosion(BlockExplodeEvent e){e.blockList().removeIf(this::protectedAt);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void burn(BlockBurnEvent e){if(protectedAt(e.getBlock()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void ignite(BlockIgniteEvent e){if(protectedAt(e.getBlock()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void fluid(BlockFromToEvent e){if(protectedAt(e.getToBlock())||protectedAt(e.getBlock()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void extend(BlockPistonExtendEvent e){if(protectedAt(e.getBlock())||e.getBlocks().stream().anyMatch(b->protectedAt(b)||protectedAt(b.getRelative(e.getDirection()))))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void retract(BlockPistonRetractEvent e){if(protectedAt(e.getBlock())||e.getBlocks().stream().anyMatch(b->protectedAt(b)||protectedAt(b.getRelative(e.getDirection()))))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.MONITOR) public void death(PlayerDeathEvent e){
        Player p=e.getEntity();
        // Read the final event after every plugin has applied its actual death policy.
        Bukkit.getScheduler().runTask(plugin,()->{
            if(!p.isOnline())return;
            boolean kept=e.getKeepInventory();boolean drops=e.getDrops().stream().anyMatch(i->!i.getType().isAir()&&i.getAmount()>0);
            String text=kept&&!drops?"本次死亡背包和已穿装备保留，不必返回寻找掉落物。"
                :drops?"本次死亡确有物品掉落，请重生后核对背包；不要在危险处盲目找回。":"本次死亡没有物品掉落实体，请重生后核对背包。";
            p.sendMessage("§e[死亡结果] "+text+" 原版经验、RPG金币或副本结算另查状态。命令：/mycli status");
            plugin.getLogger().info("Death result: player="+p.getUniqueId()+", keepInventory="+kept+", itemDrops="+drops);
        });
    }
}
