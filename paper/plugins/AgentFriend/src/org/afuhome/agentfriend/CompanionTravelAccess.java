package org.afuhome.agentfriend;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;

/** Read-only game checks used by the native companion bridge. */
public final class CompanionTravelAccess {
    private CompanionTravelAccess() { }
    public static Location companionRescueTarget(Player partner, org.bukkit.entity.LivingEntity companion) {
        if(!Bukkit.isPrimaryThread()||!(Bukkit.getPluginManager().getPlugin("AgentFriend") instanceof AgentFriendPlugin plugin)
                ||!plugin.isEnabled()||plugin.trialRescue()==null)return null;
        return plugin.trialRescue().companionTarget(partner,companion);
    }

    /** NPC accepted the authenticated participant's invitation. Active rooms are allowed. */
    public static boolean mayInviteResident(Player partner, Location landing) {
        return Bukkit.isPrimaryThread() && partner.isOnline() && !partner.isDead() && landing.getWorld()!=null
            && Bukkit.getPluginManager().getPlugin("AgentFriend") instanceof AgentFriendPlugin plugin
            && plugin.isEnabled() && plugin.nativeRpgMayAct(partner);
    }

    /** A registered NPC may lead another NPC; never borrow its creator's privileges. */
    public static boolean mayInviteResidentEntity(Entity partner, Location landing) {
        if(partner instanceof Player player)return mayInviteResident(player,landing);
        if(!Bukkit.isPrimaryThread()||!partner.isValid()||partner.isDead()||!ResidentCli.isResident(partner.getUniqueId()))return false;
        Player actor=ResidentCli.find(partner.getUniqueId());
        return actor!=null&&mayInviteResident(actor,landing);
    }

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

    public static boolean mayGuardDungeonTarget(Player partner, Entity companion, Entity target) {
        if (!(Bukkit.getPluginManager().getPlugin("AgentFriend") instanceof AgentFriendPlugin plugin)
                || !plugin.isEnabled() || !plugin.nativeRpgMayAct(partner)) return false;
        return plugin.dungeon().companionCombatTarget(partner, companion, target)
            || plugin.siteDungeons() != null && plugin.siteDungeons().companionCombatTarget(partner, companion, target);
    }

    public static boolean companionCombatPosition(Player partner, Location position) {
        if (!(Bukkit.getPluginManager().getPlugin("AgentFriend") instanceof AgentFriendPlugin plugin)
                || !plugin.isEnabled() || !plugin.nativeRpgMayAct(partner)) return false;
        return plugin.dungeon().companionCombatPosition(partner, position)
            || plugin.siteDungeons() != null && plugin.siteDungeons().companionCombatPosition(partner, position);
    }
}
