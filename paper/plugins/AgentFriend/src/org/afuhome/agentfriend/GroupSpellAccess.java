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
        if(source.isEmpty()&&target.isEmpty()&&(ResidentCli.isResident(caster.getUniqueId())||ResidentCli.isResident(ally.getUniqueId())))
            try{sameParty|=Boolean.TRUE.equals(ResidentCli.nativeCall("sameParty",new Class[]{java.util.UUID.class,java.util.UUID.class},caster.getUniqueId(),ally.getUniqueId()));}catch(Exception unavailable){return false;}
        return source.isEmpty() && target.isEmpty() ? sameParty : source.equals(target);
    }

    private static String challenge(AgentFriendPlugin plugin, Player player) {
        var id = player.getUniqueId();
        String trial = plugin.dungeon().challengeContext(id);
        return trial.isEmpty() && plugin.siteDungeons() != null ? plugin.siteDungeons().challengeContext(id) : trial;
    }
}
