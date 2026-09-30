package org.afuhome.agentfriend;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.ChatColor;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

/** Per-player, bounded practice of server-authoritative spells. */
final class SpellMastery {
    static final Map<String, String> NAMES = Map.of(
            "starbolt", "星芒箭", "frostnova", "霜环", "flamewave", "焰浪",
            "leap", "跃空术", "flight", "飞行术", "golem", "守护傀儡",
            "sense", "探敌术", "prospect", "探矿术");
    private static final int RANK_TWO = 8;
    private static final int RANK_THREE = 24;
    private final AgentFriendPlugin plugin;
    private final File file;
    private final Map<UUID, Map<String, Integer>> uses = new LinkedHashMap<>();
    private final BukkitTask saveTask;
    private boolean dirty;

    SpellMastery(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        this.file = new File(plugin.getDataFolder(), "spell-mastery.yml");
        if (file.isFile()) {
            YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
            ConfigurationSection players = yaml.getConfigurationSection("players");
            if (players != null) for (String rawUuid : players.getKeys(false)) {
                try {
                    UUID uuid = UUID.fromString(rawUuid);
                    ConfigurationSection spells = players.getConfigurationSection(rawUuid);
                    if (spells == null) continue;
                    Map<String, Integer> playerUses = new LinkedHashMap<>();
                    for (String spell : NAMES.keySet()) {
                        int value = spells.getInt(spell, 0);
                        if (value > 0) playerUses.put(spell, Math.min(RANK_THREE, value));
                    }
                    if (!playerUses.isEmpty()) uses.put(uuid, playerUses);
                } catch (IllegalArgumentException ignored) {
                    plugin.getLogger().warning("Invalid UUID in spell mastery data; entry skipped.");
                }
            }
        }
        saveTask = plugin.getServer().getScheduler().runTaskTimer(plugin, this::save, 1200L, 1200L);
    }

    int uses(Player player, String spell) {
        return uses.getOrDefault(player.getUniqueId(), Map.of()).getOrDefault(spell, 0);
    }

    int rank(Player player, String spell) {
        int count = uses(player, spell);
        return count >= RANK_THREE ? 3 : count >= RANK_TWO ? 2 : 1;
    }

    int nextRequired(Player player, String spell) {
        return switch (rank(player, spell)) { case 1 -> RANK_TWO; case 2 -> RANK_THREE; default -> RANK_THREE; };
    }

    String category(String spell) {
        return switch (spell) {
            case "starbolt", "frostnova", "flamewave" -> "combat";
            case "prospect" -> "gathering";
            default -> "exploration";
        };
    }

    void successfulCast(Player player, String spell) {
        if (!NAMES.containsKey(spell)) return;
        int before = rank(player, spell);
        int count = uses(player, spell);
        if (count >= RANK_THREE) return;
        uses.computeIfAbsent(player.getUniqueId(), ignored -> new LinkedHashMap<>())
                .put(spell, count + 1);
        dirty = true;
        int after = rank(player, spell);
        if (after == before) return;
        player.sendTitle("§d✦ 技能精进", "§f" + NAMES.get(spell) + " §e" + after + "/3", 10, 50, 15);
        player.sendMessage(ChatColor.LIGHT_PURPLE + "技能精进：" + NAMES.get(spell)
                + " 已到 " + after + "/3；/mycli mastery 查看成长。");
        player.playSound(player.getLocation(), Sound.ENTITY_PLAYER_LEVELUP, 0.7f, 1.4f);
        player.spawnParticle(Particle.END_ROD, player.getLocation().add(0, 1.2, 0),
                18, 0.4, 0.6, 0.4, 0.02);
    }

    void report(Player player) {
        player.sendMessage(ChatColor.GOLD + "【技能熟练度】成功施放才累计；8 次升 2 级、24 次升 3 级，上限 3 级。");
        for (String[] group : new String[][] {
                {"战斗", "starbolt", "frostnova", "flamewave"},
                {"探索", "leap", "flight", "golem", "sense"},
                {"采集", "prospect"}}) {
            player.sendMessage(ChatColor.AQUA + "【" + group[0] + "】");
            for (int i = 1; i < group.length; i++) {
                String id = group[i];
                int count = uses(player, id);
                player.sendMessage("MC_MASTERY id=" + id + " level=" + rank(player, id)
                        + " uses=" + count + " requiredUses=" + nextRequired(player, id)
                        + " category=" + category(id) + " name=" + NAMES.get(id));
            }
        }
        player.sendMessage(ChatColor.GRAY + "角色属性来自 AuraSkills；公会声望独立。其他生活/女神技能沿用现有等级和学习规则。");
    }

    void save() {
        if (!dirty) return;
        YamlConfiguration yaml = new YamlConfiguration();
        yaml.set("schema-version", 1);
        uses.forEach((uuid, spells) -> spells.forEach((spell, count) ->
                yaml.set("players." + uuid + "." + spell, count)));
        Path target = file.toPath();
        Path temporary = target.resolveSibling(file.getName() + ".tmp");
        try {
            Files.createDirectories(target.getParent());
            Files.writeString(temporary, yaml.saveToString(), StandardCharsets.UTF_8);
            try {
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING,
                        StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
            }
            dirty = false;
        } catch (IOException error) {
            plugin.getLogger().severe("Could not save spell mastery: " + error);
        }
    }

    void shutdown() {
        saveTask.cancel();
        save();
    }
}
