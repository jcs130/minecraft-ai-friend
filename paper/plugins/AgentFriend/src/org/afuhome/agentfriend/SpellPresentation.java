package org.afuhome.agentfriend;

import org.bukkit.ChatColor;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.UUID;

/** Short, bounded vanilla-packet choreography after a spell actually takes effect. */
final class SpellPresentation {
    private final JavaPlugin plugin;

    SpellPresentation(JavaPlugin plugin) { this.plugin = plugin; }

    private record Cue(String incantation, String name, ChatColor color,
                       Particle aura, Particle accent, Sound sound, float pitch) { }

    void show(Player player, String spell) {
        if (player == null || !player.isOnline()) return;
        String id = spell.startsWith("conjure_") ? "conjure" : spell;
        Cue cue = cue(id);
        if (cue == null) return;
        // Titles are mirrored by CortiEyeMirror to an attached real spectator client.
        // Keep the existing chat response as the readable result for Mineflayer agents.
        player.sendTitle(cue.color() + cue.incantation(),
                ChatColor.GRAY + "✦ " + cue.name() + " ✦", 3, 36, 8);
        player.getWorld().playSound(player.getLocation(), cue.sound(), 0.7f, cue.pitch());
    }

    private static Cue cue(String spell) {
        return switch (spell) {
            case "home" -> new Cue("空间之力，护你归途", "归乡术", ChatColor.GOLD,
                    Particle.PORTAL, Particle.END_ROD, Sound.ENTITY_ENDERMAN_TELEPORT, 1.1f);
            case "travel" -> new Cue("星路为门，抵达彼方", "传送术", ChatColor.LIGHT_PURPLE,
                    Particle.PORTAL, Particle.END_ROD, Sound.ENTITY_ENDERMAN_TELEPORT, 1.05f);
            case "storage" -> new Cue("隔空取物，星囊启封", "远程储物术", ChatColor.LIGHT_PURPLE,
                    Particle.END_ROD, Particle.PORTAL, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 1.1f);
            case "blink" -> new Cue("折叠一步，越过星隙", "闪现术", ChatColor.LIGHT_PURPLE,
                    Particle.PORTAL, Particle.END_ROD, Sound.ENTITY_ENDERMAN_TELEPORT, 1.2f);
            case "selfheal" -> new Cue("柔和的光，抚平伤痛", "圣愈术", ChatColor.GREEN,
                    Particle.HEART, Particle.END_ROD, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 1.45f);
            case "heal" -> new Cue("愿温柔之光护你", "治疗术", ChatColor.GREEN,
                    Particle.HEART, Particle.END_ROD, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 1.35f);
            case "food" -> new Cue("麦香成宴，饥饿退散", "饱食术", ChatColor.YELLOW,
                    Particle.END_ROD, Particle.CLOUD, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 1.0f);
            case "conjure" -> new Cue("以星为墨，造物成形", "造物术", ChatColor.LIGHT_PURPLE,
                    Particle.END_ROD, Particle.PORTAL, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 0.9f);
            case "fireworks" -> new Cue("点燃星火，照亮夜空", "烟花术", ChatColor.GOLD,
                    Particle.END_ROD, Particle.FLAME, Sound.ENTITY_FIREWORK_ROCKET_BLAST, 0.8f);
            case "starlight" -> new Cue("星尘听令，照耀此地", "星尘术", ChatColor.YELLOW,
                    Particle.END_ROD, Particle.ELECTRIC_SPARK, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 1.6f);
            case "starbolt" -> new Cue("星芒破空，追逐邪影", "星芒箭", ChatColor.LIGHT_PURPLE,
                    Particle.ELECTRIC_SPARK, Particle.END_ROD, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 1.5f);
            case "frostnova" -> new Cue("寒霜成环，万物凝息", "霜环术", ChatColor.AQUA,
                    Particle.SNOWFLAKE, Particle.CLOUD, Sound.BLOCK_GLASS_BREAK, 1.1f);
            case "flamewave" -> new Cue("烈焰成浪，驱逐黑暗", "焰浪术", ChatColor.GOLD,
                    Particle.FLAME, Particle.END_ROD, Sound.ITEM_FIRECHARGE_USE, 1.25f);
            case "prospect" -> new Cue("大地低语，矿脉显形", "探矿术", ChatColor.LIGHT_PURPLE,
                    Particle.END_ROD, Particle.CRIT, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 0.8f);
            case "leap" -> new Cue("风托我身，跃向云端", "跃空术", ChatColor.AQUA,
                    Particle.CLOUD, Particle.END_ROD, Sound.ENTITY_BREEZE_JUMP, 1.15f);
            case "flight" -> new Cue("借风为翼，自由翱翔", "飞行术", ChatColor.LIGHT_PURPLE,
                    Particle.CLOUD, Particle.END_ROD, Sound.ENTITY_BREEZE_JUMP, 0.95f);
            case "golem" -> new Cue("钢铁应召，守护同行", "守护傀儡", ChatColor.GOLD,
                    Particle.END_ROD, Particle.CRIT, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 0.7f);
            case "sense" -> new Cue("聆听黑暗，现出踪影", "探敌术", ChatColor.AQUA,
                    Particle.END_ROD, Particle.ELECTRIC_SPARK, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 1.05f);
            case "feather" -> new Cue("轻羽相随，落地无声", "羽落术", ChatColor.WHITE,
                    Particle.CLOUD, Particle.END_ROD, Sound.ENTITY_BREEZE_JUMP, 1.35f);
            case "night" -> new Cue("点亮双眸，看破黑夜", "夜视术", ChatColor.AQUA,
                    Particle.END_ROD, Particle.ELECTRIC_SPARK, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 0.95f);
            default -> null;
        };
    }
}
