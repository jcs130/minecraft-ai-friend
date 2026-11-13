package org.qiandengji.vortex;

import io.vortexcore.integration.protection.ProtectionAction;
import io.vortexcore.VortexCorePlugin;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;
import org.bukkit.Bukkit;
import org.bukkit.Particle;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/** Apply the knight's defensive effects after a successful native Vortex cast. */
final class FortifyDefence {
    private static final int SELF_TICKS = 160;
    private static final int TEAM_TICKS = 100;
    private static final double RANGE = 7;
    private FortifyDefence() {}
    static void confirmed(Player player,String spell) {
        if (!spell.equals("fortify") || !player.isOnline()) return;
        apply(player, SELF_TICKS);
        var vortex = (VortexCorePlugin) Bukkit.getPluginManager().getPlugin("VortexRPG");
        if (vortex == null || !vortex.isEnabled()) return;
        int protectedAllies = 0;
        for (Player ally : allies(player, vortex)) {
            if (!vortex.protectionHookService().allows(player, ally.getLocation(), ProtectionAction.SPELL_TARGET)) continue;
            if (!apply(ally, TEAM_TICKS)) continue;
            ally.getWorld().spawnParticle(Particle.ENCHANT, ally.getLocation().add(0, 1, 0), 10, .25, .35, .25, .03);
            protectedAllies++;
        }
        if (protectedAllies > 0) player.sendMessage("§b【坚守】" + protectedAllies + " 名队友获得抗性 I（5 秒）。");
    }
    private static Method teamTargeter(VortexCorePlugin vortex) {
        if (vortex == null || !vortex.isEnabled()) return null;
        try {
            return Class.forName("io.vortexcore.combat.PartySpellTargets", false, vortex.getClass().getClassLoader())
                    .getMethod("allies", Player.class, double.class);
        } catch (ReflectiveOperationException | LinkageError unavailable) {
            return null;
        }
    }
    private static List<Player> allies(Player player, VortexCorePlugin vortex) {
        Method targeter = teamTargeter(vortex);
        if (targeter == null) return List.of();
        try {
            if (targeter.invoke(null, player, RANGE) instanceof List<?> players)
                return players.stream().filter(Player.class::isInstance).map(Player.class::cast).toList();
        } catch (ReflectiveOperationException | LinkageError unavailable) {
            return List.of();
        }
        return List.of();
    }
    private static boolean hasTeamGuard() {
        return Bukkit.getServer() != null && Bukkit.getPluginManager().getPlugin("VortexRPG") instanceof VortexCorePlugin vortex
                && teamTargeter(vortex) != null;
    }
    private static boolean apply(Player player, int ticks) {
        var existing = player.getPotionEffect(PotionEffectType.RESISTANCE);
        if (existing != null && (existing.getAmplifier() > 0 || existing.getDuration() >= ticks)) return false;
        return player.addPotionEffect(new PotionEffect(PotionEffectType.RESISTANCE, ticks, 0, false, true, true));
    }
    static String description(String spell) {
        if (!spell.equals("fortify")) return "";
        return "；自己获得抗性 I（8 秒）" + (hasTeamGuard() ? "，7 格内可见队友获得抗性 I（5 秒）" : "")
                + "；原版抗性可减免适用伤害 20%";
    }
    static List<Map<String,Object>> effects(String spell) {
        if (!spell.equals("fortify")) return List.of();
        Map<String, Object> self = Map.of("type", "resistance", "target", "self", "amplifier", 0,
                "durationTicks", SELF_TICKS, "reduction", .2, "preserveStronger", true);
        if (!hasTeamGuard()) return List.of(self);
        return List.of(self, Map.of("type", "resistance", "target", "visible_allies", "range", RANGE, "amplifier", 0,
                "durationTicks", TEAM_TICKS, "reduction", .2, "preserveStronger", true));
    }
}
