package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.bukkit.WorldGuardPlugin;
import com.sk89q.worldguard.protection.flags.Flags;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

import java.util.UUID;

/** Ordinary compass landing policy for a registered maid's own entity and identity. */
public final class MaidRendezvousAccess {
    private MaidRendezvousAccess() { }

    public static String prepare(UUID actorId, UUID targetId) {
        JsonObject plan = new JsonObject();
        LivingEntity target = CharacterLocationAccess.target(actorId, targetId);
        if (!(Bukkit.getEntity(actorId) instanceof LivingEntity actor) || target == null || target.isDead())
            return denied(plan, "team_target_unavailable");
        Player resident = ResidentCli.find(actorId);
        if (resident != null && !plugin().professions().basicAllowed(resident, "travel")
                || resident == null && !plugin().nativeRpg().selected()) return denied(plan, "skill_unavailable");
        if (target instanceof Player player && plugin().pvpParticipant(player)) return denied(plan, "team_pvp_escrow");
        Location from = actor.getLocation();
        String reason = problem(actor, from, target.getLocation());
        if (!reason.isEmpty()) return denied(plan, reason);
        Location landing = AgentFriendPlugin.safeTeammateLanding(target, at -> problem(actor, from, at).isEmpty());
        if (landing == null) return denied(plan, "team_no_safe_ground");
        plan.addProperty("ok", true);
        plan.addProperty("world", landing.getWorld().getUID().toString());
        plan.addProperty("x", landing.getX());
        plan.addProperty("y", landing.getY());
        plan.addProperty("z", landing.getZ());
        plan.addProperty("manaCost", TravelMagic.DISTANT_MANA);
        plan.addProperty("cooldownMillis", AgentFriendPlugin.TEAM_TELEPORT_COOLDOWN_MS);
        return plan.toString();
    }

    public static boolean accepts(UUID actorId, UUID targetId, Location from, Location expected) {
        var target = CharacterLocationAccess.target(actorId, targetId);
        if (!(Bukkit.getEntity(actorId) instanceof LivingEntity actor) || target == null || target.isDead()) return false;
        if (target instanceof Player p && plugin().pvpParticipant(p)) return false;
        Location actual = actor.getLocation();
        return actual.getWorld() == expected.getWorld() && actual.distanceSquared(expected) <= 1
                && target.getWorld() == actual.getWorld() && target.getLocation().distanceSquared(actual) <= 16
                && AgentFriendPlugin.safeLanding(actual.getBlock()) && TeamTravelSafety.insideBorder(actual)
                && problem(actor, from, actual).isEmpty();
    }

    private static AgentFriendPlugin plugin() {
        return (AgentFriendPlugin) Bukkit.getPluginManager().getPlugin("AgentFriend");
    }

    private static String denied(JsonObject plan, String reason) {
        plan.addProperty("ok", false);
        plan.addProperty("reason", reason);
        return plan.toString();
    }

    private static String problem(LivingEntity actor, Location from, Location to) {
        var server = plugin();
        Player resident = ResidentCli.find(actor.getUniqueId());
        Player owner = actor instanceof org.bukkit.entity.Tameable tame && tame.getOwner() instanceof Player p ? p : null;
        for (var at : new Location[]{from, to}) {
            if (server.namedTravelActivityArea(at, "arena")
                    && !(resident != null && CompanionTravelAccess.companionCombatPosition(resident, at))
                    && !(owner != null && CompanionTravelAccess.companionCombatPosition(owner, at))) return "team_activity_admission";
        }
        try {
            var query = WorldGuard.getInstance().getPlatform().getRegionContainer().createQuery();
            var principal = WorldGuardPlugin.inst().wrapOfflinePlayer(Bukkit.getOfflinePlayer(actor.getUniqueId()));
            if (!query.testState(BukkitAdapter.adapt(from), principal, Flags.EXIT)) return "protected_exit";
            if (!query.testState(BukkitAdapter.adapt(to), principal, Flags.ENTRY)) return "protected_entry";
            return "";
        } catch (RuntimeException | LinkageError unavailable) {
            return "protection_unavailable";
        }
    }
}
