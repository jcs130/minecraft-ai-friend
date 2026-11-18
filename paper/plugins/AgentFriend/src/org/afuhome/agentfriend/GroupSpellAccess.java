package org.afuhome.agentfriend;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import java.util.UUID;

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

    /** The healing circle may only be placed in the caster's current combat room. */
    public static String circleScene(Player caster, Location ground) {
        if (!(Bukkit.getPluginManager().getPlugin("AgentFriend") instanceof AgentFriendPlugin plugin)
                || !plugin.isEnabled() || !plugin.nativeRpgMayAct(caster)
                || !caster.getWorld().equals(ground.getWorld())) return null;
        if (plugin.dungeon().isParticipant(caster))
            return plugin.dungeon().circleRoom(caster, ground)
                ? plugin.dungeon().challengeContext(caster.getUniqueId()) : null;
        var sites = plugin.siteDungeons();
        if (sites != null && sites.isParticipant(caster)) return sites.circleScene(caster, ground);
        if (plugin.dungeon().activeCircleRoom(ground) || (sites != null && sites.activeCircleSite(ground))) return null;
        return "world:" + caster.getWorld().getUID();
    }

    public static UUID circleRequest(Player caster) {
        return ResidentCli.currentRequest(caster.getUniqueId());
    }

    public static boolean circleReward(Player caster) {
        return Bukkit.getPluginManager().getPlugin("AgentFriend") instanceof AgentFriendPlugin plugin
            && plugin.siteDungeons() != null && plugin.siteDungeons().circleReward(caster.getUniqueId());
    }
    public static boolean weaponSpell(Player caster,String spell){
        return Bukkit.getPluginManager().getPlugin("AgentFriend") instanceof AgentFriendPlugin plugin
            && plugin.weaponSpell(caster,spell);
    }
    public static boolean interruptAltar(Player caster,boolean apply){
        return Bukkit.getPluginManager().getPlugin("AgentFriend") instanceof AgentFriendPlugin plugin
            && plugin.nativeRpgMayAct(caster)&&plugin.siteDungeons()!=null&&plugin.siteDungeons().interruptAltar(caster,apply);
    }
}
