package org.afuhome.agentfriend;

import dev.aurelium.auraskills.api.AuraSkillsApi;
import java.util.Collection;
import org.bukkit.GameMode;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffectTypeCategory;

/** Called once after an actual room clear for eligible, present participants. */
final class DungeonRecovery {
    static void apply(AgentFriendPlugin plugin, Collection<Player> players, String encounter, int stage) {
        for (Player player : players) {
            if (!player.isOnline() || player.isDead() || plugin.isDowned(player)
                    || plugin.isObserver(player) || player.getGameMode() == GameMode.SPECTATOR) continue;
            var harmful = player.getActivePotionEffects().stream()
                .filter(effect -> effect.getType().getCategory() == PotionEffectTypeCategory.HARMFUL)
                .map(effect -> effect.getType()).toList();
            harmful.forEach(player::removePotionEffect);
            player.setFireTicks(0);
            player.setFreezeTicks(0);
            player.setHealth(player.getMaxHealth());
            boolean manaRestored;
            if (plugin.nativeRpgSelected()) {
                manaRestored = plugin.nativeRpg().refillDungeonMana(player);
            } else {
                var user = AuraSkillsApi.get().getUser(player.getUniqueId());
                manaRestored = user != null && user.isLoaded();
                if (manaRestored) user.setMana(user.getMaxMana());
            }
            player.sendMessage("§a【清场恢复】生命已回满，已清理燃烧、冻结和有害药水效果；"
                + (manaRestored ? "魔力已回满。" : "魔力服务未就绪，请用 /mycli status 核对。"));
            player.sendMessage("MC_DUNGEON_RECOVERY encounter=" + encounter + " stage=" + stage
                + " health=" + player.getHealth() + " manaRestored=" + manaRestored + " harmfulEffects="
                + harmful.stream().filter(type -> !player.hasPotionEffect(type)).count());
        }
    }
}
