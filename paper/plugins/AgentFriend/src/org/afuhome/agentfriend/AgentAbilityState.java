package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.nisovin.magicspells.MagicSpells;
import com.nisovin.magicspells.Spell;
import com.nisovin.magicspells.Spellbook;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import org.bukkit.ChatColor;
import org.bukkit.entity.Player;

/** Castable skills and their server-authoritative, per-player cooldowns. */
final class AgentAbilityState {
    static final int MAX_ENTRIES = 48;
    private static final Pattern VALID_ID = Pattern.compile("[a-z0-9_:.-]+");
    private final AgentFriendPlugin plugin;
    private final CombatSpells combat;
    private final ProspectingSpell prospecting;
    private final UtilitySpells utility;

    AgentAbilityState(AgentFriendPlugin plugin, CombatSpells combat,
            ProspectingSpell prospecting, UtilitySpells utility) {
        this.plugin = plugin;
        this.combat = combat;
        this.prospecting = prospecting;
        this.utility = utility;
    }

    JsonArray build(Player player) {
        JsonArray result = new JsonArray();
        add(result, "mycli:starbolt", "星芒箭", plugin.mastery().rank(player, "starbolt"),
                CombatSpells.totalCooldownMs("starbolt"), combat.remainingCooldownMs(player, "starbolt"),
                "minecraft:amethyst_shard");
        add(result, "mycli:frostnova", "霜环", plugin.mastery().rank(player, "frostnova"),
                CombatSpells.totalCooldownMs("frostnova"), combat.remainingCooldownMs(player, "frostnova"),
                "minecraft:snowball");
        add(result, "mycli:flamewave", "焰浪", plugin.mastery().rank(player, "flamewave"),
                CombatSpells.totalCooldownMs("flamewave"), combat.remainingCooldownMs(player, "flamewave"),
                "minecraft:blaze_powder");
        add(result, "mycli:prospect", "探矿术", plugin.mastery().rank(player, "prospect"),
                ProspectingSpell.totalCooldownMs(), prospecting.remainingCooldownMs(player),
                "minecraft:spyglass");
        for (String id : List.of("leap", "flight", "golem", "sense")) {
            String name = switch (id) {
                case "leap" -> "跃空术";
                case "flight" -> "飞行术";
                case "golem" -> "守护傀儡";
                default -> "探敌术";
            };
            String icon = switch (id) {
                case "leap" -> "minecraft:rabbit_foot";
                case "flight" -> "minecraft:feather";
                case "golem" -> "minecraft:iron_ingot";
                default -> "minecraft:ender_eye";
            };
            add(result, "mycli:" + id, name, plugin.mastery().rank(player, id),
                    UtilitySpells.totalCooldownMs(id), utility.remainingCooldownMs(player, id), icon);
        }
        addBuiltin(result, player, "home", "归乡", "minecraft:compass");
        add(result, "mycli:travel", "传送点术", 1, 0L, 0L, "minecraft:lodestone");
        add(result, "mycli:support", "支援传送术", 1, VillageWatchManager.SUPPORT_COOLDOWN_MS,
                plugin.villageWatch().remainingSupportCooldownMs(player), "minecraft:bell");
        addBuiltin(result, player, "fireworks", "烟花术", "minecraft:firework_rocket");
        addBuiltin(result, player, "starlight", "星光术", "minecraft:glowstone_dust");
        addBuiltin(result, player, "heal", "范围治疗", "minecraft:glistering_melon_slice");
        if (plugin.hasLearnedSkill(player, "feather"))
            addBuiltin(result, player, "feather", "羽落", "minecraft:feather");
        if (plugin.hasLearnedSkill(player, "night"))
            addBuiltin(result, player, "night", "夜视", "minecraft:golden_carrot");
        addMagicSpells(result, player);
        if (plugin.professions() != null) for (var skill : plugin.professions().skills()) {
            if (!plugin.professions().denial(player, skill, false).equals("ready")) continue;
            add(result, "mycli:" + skill.id(), skill.title(), plugin.professions().level(player,skill.id()), skill.cooldown(),
                    plugin.professions().remaining(player, skill.id()), skill.icon().getKey().toString());
        }
        filterBasics(result,player);
        return result;
    }
    private void filterBasics(JsonArray result, Player player) {
        if (plugin.professions()==null || !plugin.professions().ledger.ready()) return;
        for (int i=result.size()-1;i>=0;i--) {
            String id=result.get(i).getAsJsonObject().get("id").getAsString(); id=id.substring(id.indexOf(':')+1);
            if (id.startsWith("conjure_")) id="give";
            if (SpellGuide.baseIds().contains(id) && plugin.professions().level(player,id)==0) result.remove(i);
        }
    }

    private void addBuiltin(JsonArray result, Player player, String id, String name, String icon) {
        add(result, "mycli:" + id, name, 1, plugin.totalBuiltinCooldownMs(id),
                plugin.remainingBuiltinCooldownMs(player, id), icon);
    }

    private void addMagicSpells(JsonArray result, Player player) {
        if (!MagicSpells.isLoaded()) return;
        Spellbook book = MagicSpells.getSpellbook(player);
        if (book == null) return;
        List<Spell> spells = new ArrayList<>(book.getSpells());
        spells.sort(Comparator.comparing(spell -> spell.getInternalName().toLowerCase(Locale.ROOT)));
        for (Spell spell : spells) {
            if (result.size() >= MAX_ENTRIES) break;
            if (spell.isHelperSpell()) continue;
            if (spell.getInternalName().equalsIgnoreCase("heal")) continue; // /mycli owns the area version.
            String id = "magicspells:" + spell.getInternalName().toLowerCase(Locale.ROOT);
            if (!VALID_ID.matcher(id).matches()) continue;
            Long total = millis(spell.getCooldown());
            Long remaining = millis(spell.getCooldown(player));
            add(result, id, spell.getName(), 1, total, remaining, null);
        }
    }

    private Long millis(float seconds) {
        if (!Float.isFinite(seconds) || seconds < 0) return null;
        return Math.max(0L, (long) Math.ceil(seconds * 1000.0));
    }

    private void add(JsonArray result, String id, String label, int level,
            Long totalMs, Long remainingMs, String icon) {
        if (result.size() >= MAX_ENTRIES || !VALID_ID.matcher(id).matches()) return;
        JsonObject entry = new JsonObject();
        entry.addProperty("id", id);
        String plain = label == null ? "" : ChatColor.stripColor(label).trim();
        if (plain.isEmpty()) plain = id;
        int end = plain.offsetByCodePoints(0, Math.min(64, plain.codePointCount(0, plain.length())));
        entry.addProperty("name", plain.substring(0, end));
        entry.addProperty("level", Math.max(0, level));
        if (totalMs == null) entry.add("cooldownMs", JsonNull.INSTANCE);
        else entry.addProperty("cooldownMs", Math.max(0L, totalMs));
        if (remainingMs == null) entry.add("cooldownRemainingMs", JsonNull.INSTANCE);
        else entry.addProperty("cooldownRemainingMs", Math.max(0L, remainingMs));
        if (icon != null) entry.addProperty("icon", icon);
        result.add(entry);
    }
}
