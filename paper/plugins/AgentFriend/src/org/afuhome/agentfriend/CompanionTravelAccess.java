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

    public static int trialDeparture(Player partner, Location from, Location to) {
        if (!(Bukkit.getPluginManager().getPlugin("AgentFriend") instanceof AgentFriendPlugin plugin)
                || !plugin.isEnabled() || !plugin.nativeRpgMayAct(partner)) return 0;
        return plugin.dungeon().companionTrialDeparture(partner, from, to);
    }

    public static boolean trialArrival(Player partner, int stage, Location landing) {
        return Bukkit.getPluginManager().getPlugin("AgentFriend") instanceof AgentFriendPlugin plugin
            && plugin.isEnabled() && plugin.nativeRpgMayAct(partner)
            && plugin.dungeon().companionTrialArrival(partner, stage, landing);
    }
}
