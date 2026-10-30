package org.qiandengji.vortex;
import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;

/** Old engines remain installed as effect libraries; players use the native RPG. */
final class LegacyRpgCommands implements Listener {
    static boolean retiredOwner(String name){return Set.of("AuraSkills","MagicSpells").contains(name);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)
    public void command(PlayerCommandPreprocessEvent event){
        String line=event.getMessage();if(!line.startsWith("/"))return;
        String label=line.substring(1).split("\\s+",2)[0].toLowerCase(Locale.ROOT);
        var command=Bukkit.getServer().getCommandMap().getCommand(label);
        String owner=command instanceof org.bukkit.command.PluginIdentifiableCommand identified?identified.getPlugin().getName():"";
        // Some command frameworks register Command rather than PluginCommand.
        if(!retiredOwner(owner)&&!label.startsWith("auraskills:")&&!label.startsWith("magicspells:"))return;
        event.setCancelled(true);
        if(owner.equals("AuraSkills")||label.startsWith("auraskills:")){
            event.getPlayer().sendMessage("§e[foundation_entry] 基础熟练度与被动已保留，使用统一查询：/mycli skills list passive；职业与主动技能：/mycli skills list");return;
        }
        event.getPlayer().sendMessage("§e[legacy_progression_retired] 此旧RPG入口已归档，本次未执行；职业、成长、魔力、技能统一使用Vortex。下一步：/mycli skills list；总览：/mycli status");
    }
}
