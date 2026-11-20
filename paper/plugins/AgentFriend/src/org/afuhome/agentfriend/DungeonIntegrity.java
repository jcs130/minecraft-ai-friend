package org.afuhome.agentfriend;

import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.entity.*;

/** Reports actual death drops. DungeonBuildPolicy handles edits and environmental damage. */
final class DungeonIntegrity implements Listener {
    private final AgentFriendPlugin plugin;
    DungeonIntegrity(AgentFriendPlugin plugin){this.plugin=plugin;Bukkit.getPluginManager().registerEvents(this,plugin);}
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
