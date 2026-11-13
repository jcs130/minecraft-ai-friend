package org.afuhome.agentfriend;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/** Companion reunions use the same activity boundaries as the player's named travel. */
public final class CompanionTravelAccess {
    private CompanionTravelAccess() { }

    public static boolean mayRejoin(Player partner, Location landing) {
        return Bukkit.getPluginManager().getPlugin("AgentFriend") instanceof AgentFriendPlugin plugin
            && plugin.isEnabled() && plugin.nativeRpgMayAct(partner) && !plugin.namedTravelBlocked(partner)
            && !plugin.namedTravelActivityArea(partner.getLocation()) && !plugin.namedTravelActivityArea(landing);
    }

    static void followTrialTransfer(Player partner, Location from, int stage) {
        var maids=Bukkit.getPluginManager().getPlugin("QiandengjiMaidBridge");
        if (maids == null || !maids.isEnabled()) return;
        try {
            maids.getClass().getMethod("followTrialTransfer", Player.class, Location.class, int.class)
                .invoke(maids, partner, from, stage);
        } catch (NoSuchMethodException unsupported) {
            // The companion bridge is optional and can be rolled back independently.
        } catch (ReflectiveOperationException | LinkageError failure) {
            maids.getLogger().warning("Trial companion transfer unavailable: "+failure.getClass().getSimpleName());
        }
    }

    public static boolean trialArrival(Player partner, int stage, Location landing) {
        return Bukkit.getPluginManager().getPlugin("AgentFriend") instanceof AgentFriendPlugin plugin
            && plugin.isEnabled() && plugin.nativeRpgMayAct(partner)
            && plugin.dungeon().companionTrialArrival(partner, stage, landing);
    }
}
