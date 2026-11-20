package org.qiandengji.villagerquests;

import java.util.HashMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.qiandengji.villagerquests.core.Board;
import org.qiandengji.villagerquests.core.Reward;

/**
 * Hands out a table reward on the main thread. Emeralds are items (overflow drops at the feet). Vortex XP and fame
 * have no public Java API in this repo, so they go through admin-written console command templates in config
 * ({@code rewards.commands}); placeholders are only numbers, the quest id and a validated player name/UUID.
 */
final class Rewards {
    private static final Pattern SAFE_NAME = Pattern.compile("^[A-Za-z0-9_]{1,16}$");
    private final VillagerQuestsPlugin plugin;
    private List<String> commands = List.of();
    private boolean emeraldItems = true;

    Rewards(VillagerQuestsPlugin plugin) { this.plugin = plugin; }

    void configure(ConfigurationSection s) {
        commands = s == null ? List.of() : s.getStringList("commands");
        emeraldItems = s == null || s.getBoolean("emeraldItems", true);
    }

    void give(Player p, Board.Grant g) {
        Reward r = g.reward();
        List<String> paid = new ArrayList<>();
        if (emeraldItems && r.emeralds() > 0) {
            Map<Integer, ItemStack> overflow = p.getInventory().addItem(new ItemStack(Material.EMERALD, r.emeralds()));
            overflow.values().forEach(item -> p.getWorld().dropItemNaturally(p.getLocation(), item, drop -> drop.setOwner(p.getUniqueId())));
            paid.add(r.emeralds() + " 绿宝石" + (overflow.isEmpty() ? "" : "（背包装不下的部分在脚边）"));
        }
        String name = p.getName();
        if (SAFE_NAME.matcher(name).matches()) {
            Map<String, Integer> values = new HashMap<>(Map.of("emeralds", r.emeralds(), "vortexXp", r.vortexXp(), "fame", r.fame()));
            for (String template : commands) {
                boolean skip = false;
                for (var e : values.entrySet()) if (template.contains("{" + e.getKey() + "}") && e.getValue() <= 0) skip = true;
                if (skip) continue;
                String cmd = template.replace("{player}", name).replace("{uuid}", p.getUniqueId().toString()).replace("{questId}", g.questId());
                for (var e : values.entrySet()) cmd = cmd.replace("{" + e.getKey() + "}", String.valueOf(e.getValue()));
                if (cmd.startsWith("/")) cmd = cmd.substring(1);
                if (Bukkit.dispatchCommand(Bukkit.getConsoleSender(), cmd)) {
                    if (template.contains("{vortexXp}")) paid.add(r.vortexXp() + " 职业经验指令已受理");
                    if (template.contains("{fame}")) paid.add("声望 +" + r.fame() + " 指令已受理");
                    if (!emeraldItems && template.contains("{emeralds}")) paid.add(r.emeralds() + " 绿宝石指令已受理");
                }
            }
        } else {
            plugin.getLogger().warning("reward commands skipped for unusual player name (quest " + g.questId() + ")");
        }
        if (!paid.isEmpty()) plugin.tell(p, "委托报酬：" + String.join("，", paid) + "。");
        plugin.getLogger().info("reward " + g.key() + " handled for " + p.getUniqueId() + ": " + paid);
    }
}
