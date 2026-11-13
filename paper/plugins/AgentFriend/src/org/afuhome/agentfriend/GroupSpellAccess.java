package org.afuhome.agentfriend;

import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** Checks automatic encounter membership without creating another party roster. */
public final class GroupSpellAccess {
    private GroupSpellAccess() { }

    public static boolean canAssist(Player caster, Player ally, boolean sameParty) {
        if (!(Bukkit.getPluginManager().getPlugin("AgentFriend") instanceof AgentFriendPlugin plugin)
                || !plugin.isEnabled() || !plugin.nativeRpgMayAct(caster) || !plugin.nativeRpgMayAct(ally)) return false;
        String source = challenge(plugin, caster);
        String target = challenge(plugin, ally);
        return source.isEmpty() && target.isEmpty() ? sameParty : source.equals(target);
    }

    private static String challenge(AgentFriendPlugin plugin, Player player) {
        var id = player.getUniqueId();
        String trial = plugin.dungeon().challengeContext(id);
        return trial.isEmpty() && plugin.siteDungeons() != null ? plugin.siteDungeons().challengeContext(id) : trial;
    }
}
