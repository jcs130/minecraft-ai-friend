package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

/** Projects native villager commissions on the guild board. All changes run in VillagerQuests. */
final class VillageGuildCommissions {
    private static final String PLUGIN = "qiandeng-villager-quests";
    private static final String PREFIX = "MC_VILLAGE_GUILD";

    private VillageGuildCommissions() { }

    private static JsonObject request(Player player, String action, String id) {
        var plugin = Bukkit.getPluginManager().getPlugin(PLUGIN);
        if (plugin != null && plugin.isEnabled()) {
            try {
                var method = plugin.getClass().getMethod("guildCommissions", Player.class, String.class, String.class);
                Object raw = method.invoke(plugin, player, action, id);
                if (raw instanceof String text && text.length() <= 48_000) {
                    JsonObject result = JsonParser.parseString(text).getAsJsonObject();
                    if (result.get("schemaVersion").getAsInt() == 1 && result.get("status").isJsonPrimitive()) return result;
                }
            } catch (ReflectiveOperationException | RuntimeException e) {
                // A missing or older optional plugin leaves native guild orders available.
            }
        }
        return problem("unavailable");
    }

    private static JsonObject problem(String status) {
        var result = new JsonObject();
        result.addProperty("schemaVersion", 1);
        result.addProperty("status", status);
        result.addProperty("observedAt", System.currentTimeMillis());
        return result;
    }

    private static String status(JsonObject result) { return result.get("status").getAsString(); }

    static boolean id(String text) { return text != null && text.matches("vq_[a-f0-9]{16}"); }

    static void command(Player player, String[] args) {
        String action = args.length > 2 ? args[2].toLowerCase(Locale.ROOT) : "list";
        String quest = args.length > 3 ? args[3].toLowerCase(Locale.ROOT) : null;
        boolean valid = switch (action) {
            case "info", "accept" -> id(quest);
            case "deliver" -> quest == null || id(quest);
            case "list" -> quest == null || quest.matches("[1-9][0-9]{0,3}");
            case "status" -> quest == null;
            default -> false;
        };
        if (!valid || args.length > 4) {
            player.sendMessage("§e/mycli guild village list [页码]|info <编号>|accept <编号>|status|deliver [编号]");
            emit(player, action, problem("invalid_arguments"));
            return;
        }
        emit(player, action, request(player, action, quest));
    }

    static void accept(Player player, String id) { emit(player, "accept", request(player, "accept", id)); }

    static void open(Player player) {
        if ("unavailable".equals(status(request(player, "menu", null)))) player.sendMessage("§7村民委托暂不可用。");
    }

    static ItemStack tab(Player player) {
        JsonObject result = request(player, "list", null);
        if (!"observed".equals(status(result)) || !(result.get("cards") instanceof JsonArray cards)) return null;
        List<String> lore = new ArrayList<>();
        if (cards.isEmpty()) lore.add("§7暂无可接委托");
        cards.asList().stream().limit(4).map(e -> e.getAsJsonObject()).forEach(card ->
                lore.add("§7" + card.get("issuer").getAsString() + " · " + card.get("title").getAsString()));
        lore.add("§a点击查看详情与接取");
        var item = new ItemStack(Material.PAPER);
        var meta = item.getItemMeta();
        meta.setDisplayName("§6各村委托");
        meta.setLore(lore);
        item.setItemMeta(meta);
        return item;
    }

    static void list(Player player) {
        JsonObject result = request(player, "list", null);
        if (!"observed".equals(status(result)) || !(result.get("cards") instanceof JsonArray cards)) return;
        if (cards.isEmpty()) return;
        player.sendMessage("§6【公会 · 各村委托】");
        cards.asList().stream().limit(6).map(e -> e.getAsJsonObject()).forEach(card ->
            player.sendMessage("§e" + card.get("id").getAsString() + " §f" + card.get("issuer").getAsString() + " · "
                    + card.get("title").getAsString() + " · " + card.get("objective").getAsString()));
        player.sendMessage("§7/mycli guild village list [页码] 查看各村委托；guild village info <编号> 查看详情。");
    }

    private static void emit(Player player, String action, JsonObject result) {
        result.addProperty("action", action);
        result.addProperty("source", "villager_quests");
        if ("unavailable".equals(status(result))) player.sendMessage("§7村民委托暂不可用。");
        player.sendMessage(PREFIX + " " + result);
    }
}
