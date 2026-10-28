package org.qiandengji.vortex;

import java.util.List;
import java.util.Map;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/** Complete the native fortify promise after its own successful cast, cost and cooldown. */
final class FortifyDefence {
    private FortifyDefence() {}
    static void confirmed(Player player,String spell) {
        if (!spell.equals("fortify") || !player.isOnline()) return;
        var existing=player.getPotionEffect(PotionEffectType.RESISTANCE);
        // Never replace a stronger effect or shorten an existing Resistance I.
        if (existing!=null && (existing.getAmplifier()>0 || existing.getDuration()>=160)) return;
        player.addPotionEffect(new PotionEffect(PotionEffectType.RESISTANCE,160,0,false,true,true));
    }
    static String description(String spell) {
        return spell.equals("fortify") ? "；防御：抗性I持续8秒，对受原版抗性影响的伤害减免20%，不覆盖更强抗性" : "";
    }
    static List<Map<String,Object>> effects(String spell) {
        return spell.equals("fortify") ? List.of(Map.of("type","resistance","amplifier",0,"durationTicks",160,"reduction",0.2,"preserveStronger",true)) : List.of();
    }
}
