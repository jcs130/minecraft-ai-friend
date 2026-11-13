package io.vortexcore.combat;

import io.vortexcore.VortexCorePlugin;
import io.vortexcore.magic.SpellContext;
import io.vortexcore.magic.SpellTarget;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.entity.Player;

/** Shared acquisition for the existing native group spells and the knight's guard. */
public final class PartySpellTargets {
    private PartySpellTargets() { }

    public static Collection<SpellTarget> acquire(SpellContext context, double range) {
        if (!(context.triggerSource() instanceof Player caster)) return List.of();
        List<SpellTarget> targets = new ArrayList<>();
        targets.add(new SpellTarget(SpellTarget.TargetKind.SELF, caster.getUniqueId(), caster.getLocation()));
        for (Player ally : allies(caster, range))
            targets.add(new SpellTarget(SpellTarget.TargetKind.ENTITY, ally.getUniqueId(), ally.getLocation()));
        return targets;
    }

    public static List<Player> allies(Player caster, double range) {
        var location = caster.getLocation();
        var vortex = (VortexCorePlugin) Bukkit.getPluginManager().getPlugin("VortexRPG");
        if (vortex == null || !vortex.isEnabled()) return List.of();
        var members = vortex.expeditionPartyManager().membersOf(caster.getUniqueId());
        var agentFriend = Bukkit.getPluginManager().getPlugin("AgentFriend");
        Method activity = null;
        if (agentFriend != null && agentFriend.isEnabled()) {
            try {
                Class<?> access = Class.forName("org.afuhome.agentfriend.GroupSpellAccess", true, agentFriend.getClass().getClassLoader());
                activity = access.getMethod("canAssist", Player.class, Player.class, boolean.class);
            } catch (ReflectiveOperationException | LinkageError unavailable) {
                return List.of();
            }
        }
        List<Player> players = new ArrayList<>();
        for (var entity : caster.getNearbyEntities(range, range, range)) {
            if (!(entity instanceof Player ally) || ally.equals(caster) || !ally.isOnline() || ally.isDead()
                    || ally.getGameMode() == GameMode.SPECTATOR || ally.getGameMode() == GameMode.CREATIVE
                    || location.distanceSquared(ally.getLocation()) > range * range || !caster.hasLineOfSight(ally)) continue;
            boolean sameParty = members.contains(ally.getUniqueId());
            if (activity == null ? sameParty : canAssist(activity, caster, ally, sameParty)) players.add(ally);
        }
        return players;
    }

    private static boolean canAssist(Method activity, Player caster, Player ally, boolean sameParty) {
        try {
            return Boolean.TRUE.equals(activity.invoke(null, caster, ally, sameParty));
        } catch (ReflectiveOperationException | LinkageError unavailable) {
            return false;
        }
    }
}
