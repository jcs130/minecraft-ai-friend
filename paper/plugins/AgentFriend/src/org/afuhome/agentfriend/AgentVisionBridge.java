package org.afuhome.agentfriend;

import java.util.Locale;
import org.bukkit.Bukkit;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;

/** Optional entity-visibility service; identity and paid skill grants stay with AgentFriend. */
public final class AgentVisionBridge {
    private AgentVisionBridge() {}

    public interface Reveals {
        void senseOutline(Player viewer, Entity target, boolean active);
    }

    public static boolean managed(Player player) {
        var plugin = (AgentFriendPlugin) Bukkit.getPluginManager().getPlugin("AgentFriend");
        return plugin != null && plugin.isEnabled() && !plugin.isObserver(player)
                && (plugin.isRegisteredAgent(player)
                    || player.getName().toLowerCase(Locale.ROOT).startsWith("ag_"));
    }

    static void senseOutline(Player viewer, Entity entity, boolean active) {
        Reveals reveals = Bukkit.getServicesManager().load(Reveals.class);
        if (reveals != null) reveals.senseOutline(viewer, entity, active);
    }
}
