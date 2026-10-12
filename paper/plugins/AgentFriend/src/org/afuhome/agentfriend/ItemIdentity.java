package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;

/** Presentation only: a vanilla material ID is not the identity of a named server item.
 * Never rewrites stacks, registry IDs, names, textures, PDC or Minepacks comparisons.
 */
final class ItemIdentity {
    private final YamlConfiguration labels;
    ItemIdentity(AgentFriendPlugin plugin) {
        File file = new File(plugin.getDataFolder(), "trade-directory.yml");
        labels = file.exists() ? YamlConfiguration.loadConfiguration(file)
                : YamlConfiguration.loadConfiguration(new InputStreamReader(
                        java.util.Objects.requireNonNull(plugin.getResource("trade-directory.yml")), StandardCharsets.UTF_8));
    }

    record Description(String baseId, String name, String customName, String customId, String usage, List<String> lore) {
        boolean serverItem() { return customId != null; }
        String kind() { return serverItem() ? "server_item" : customName != null ? "named_item" : "vanilla"; }
        void append(JsonObject out, boolean details) {
            out.addProperty("baseId", baseId); out.addProperty("name", name); out.addProperty("kind", kind());
            if (customName != null) out.addProperty("customName", customName);
            if (customId != null) { out.addProperty("customId", customId); out.addProperty("usage", usage); }
            if (details) {
                var lines = new com.google.gson.JsonArray(); lore.forEach(lines::add); out.add("lore", lines);
            }
        }
    }

    Description describe(ItemStack item) {
        ItemMeta meta = item.getItemMeta();
        String baseId = item.getType().getKey().toString();
        String custom = meta.hasDisplayName() ? plain(PlainTextComponentSerializer.plainText().serialize(meta.displayName()), 120)
                : meta.hasItemName() ? plain(meta.getItemName(), 120) : null;
        String name = custom == null || custom.isBlank()
                ? labels.getString("items." + item.getType().getKey().getKey(), "物品（" + baseId + "）") : custom;
        String id = null, usage = "";
        // Require the real texture + shortcut name, not the player_head material or an anvil name alone.
        if (BackpackShortcutMigration.isShortcut(item)) {
            id = "minepacks:backpack_shortcut"; name = "大背包";
            usage = "右键打开54格普通储物，或 /minepacks:backpack open；关闭界面保存。任务物品袋用 /questbag，个人奖励箱用 /mycli arena stash。";
        } else if (item.getType() == Material.COMPASS && marker(meta, "skill_compass")) {
            id = "agentfriend:skill_compass"; usage = "手持右键打开技能罗盘，或 /mycli menu；查询免费，施法按原魔力和冷却规则。";
        } else if (item.getType() == Material.WRITTEN_BOOK && marker(meta, "status_book")) {
            id = "agentfriend:status_book"; usage = "手持使用并翻页查看角色、职业、技能点与任务状态；/mycli status 查询实时状态。";
        } else if (SkillTome.isTome(item)) {
            id = "agentfriend:skill_tome"; usage = "手持使用，或 /mycli skillbook list 查准确槽位再 skillbook use <槽位>；成功研习消耗一本，满级不消耗。";
        } else if (item.getType() == Material.BLAZE_ROD && marker(meta, "spell_focus")) {
            id = "agentfriend:spell_focus"; usage = "手持使用施放所选法术；潜行使用切换技能，消耗和冷却按原技能规则。";
        }
        List<String> lore = meta.hasLore() ? meta.lore().stream().limit(6)
                .map(line -> plain(PlainTextComponentSerializer.plainText().serialize(line), 160)).toList() : List.of();
        return new Description(baseId, plain(name, 120), custom, id, usage, lore);
    }
    private static boolean marker(ItemMeta meta, String key) {
        return meta.getPersistentDataContainer().has(NamespacedKey.fromString("agentfriend:" + key), PersistentDataType.BYTE);
    }
    private static String plain(String value, int limit) {
        String text = ChatColor.stripColor(value).replaceAll("[\\p{Cntrl}]", " ");
        return text.substring(0, Math.min(limit, text.length()));
    }
}
