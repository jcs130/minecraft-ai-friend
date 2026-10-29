package org.afuhome.agentfriend;

import java.util.*;
import me.neznamy.tab.api.TabAPI;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** TAB polls only immutable strings. No Bukkit entity access from TAB's worker.
 * TAB owns sidebar packet diffing; existing name teams and chat remain intact. */
final class RpgTabBridge {
    private final AgentFriendPlugin plugin;
    private final CombatRpg combat;
    private volatile Map<UUID,Map<String,String>> cached=Map.of();
    private static final List<String> FIELDS=List.of("level","xp","profession","floor","rank","goal","visible","health");
    RpgTabBridge(AgentFriendPlugin plugin,CombatRpg combat){
        this.plugin=plugin;this.combat=combat;
        for(String field:FIELDS)TabAPI.getInstance().getPlaceholderManager().registerPlayerPlaceholder("%qd_"+field+"%",1000,
                p->cached.getOrDefault(p.getUniqueId(),Map.of()).getOrDefault(field,"—"));
    }
    void refresh(){var next=new HashMap<UUID,Map<String,String>>();var ranks=new HashMap<UUID,Integer>();
        var ranking=combat.ranking();for(int i=0;i<ranking.size();i++)ranks.put(ranking.get(i).id(),i+1);
        for(Player p:Bukkit.getOnlinePlayers()){
            if(plugin.isObserver(p))continue;var state=combat.state(p);String role=combat.profession(p);
            String label=switch(role){case "warrior"->"战士";case "tank"->"坦克";case "mage"->"法师";case "priest"->"牧师";default->"待选职业";};
            String goal=role.isEmpty()?"选择职业":plugin.dungeonParticipant(p)?"完成当前挑战":"整备 → 探索 → 攻略";
            next.put(p.getUniqueId(),Map.of("level",Integer.toString(combat.level(p)),"xp",state.get("xpToNext").getAsLong()==0?"已满级":"还需 "+state.get("xpToNext").getAsString(),
                    "profession",label,"floor",Integer.toString(combat.floor(p)),"rank",ranks.containsKey(p.getUniqueId())?Integer.toString(ranks.get(p.getUniqueId())):"未上榜","goal",goal,
                    "visible","yes","health",String.format(java.util.Locale.ROOT,"%.0f/%.0f",p.getHealth(),p.getAttribute(org.bukkit.attribute.Attribute.GENERIC_MAX_HEALTH).getValue())));
        }
        cached=Map.copyOf(next);
    }
    void close(){for(String field:FIELDS)TabAPI.getInstance().getPlaceholderManager().unregisterPlaceholder("%qd_"+field+"%");cached=Map.of();}
}
