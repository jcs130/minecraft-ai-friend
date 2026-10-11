package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.ItemStack;

/** Read the action player's actual inventory; successful player gifts get private receipts only. */
final class InventoryFeedback implements Listener {
    private final AgentFriendPlugin plugin;
    private final Map<UUID, Long> refreshed = new HashMap<>();
    private final Map<UUID, List<Gift>> pending = new HashMap<>();
    private record Gift(UUID giver, ItemStack item, int amount, int beforeCount, EntityPickupItemEvent event) {}
    InventoryFeedback(AgentFriendPlugin plugin) {
        this.plugin = plugin; Bukkit.getPluginManager().registerEvents(this, plugin);
    }
    void command(Player p, String[] args) {
        if (plugin.isObserver(p)) { p.sendMessage("§e【随身背包】这是观战账号；请在附身角色自己的连接上查询。观战画面展示该角色的物品，不是观战账号的存档。"); return; }
        String action = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "status";
        if (!Set.of("status", "refresh", "状态", "刷新").contains(action)) {
            p.sendMessage("§e用 /mycli inventory 查服务器随身背包；/mycli inventory refresh 重新同步显示。54格大背包需另行打开；个人奖励箱用 /mycli arena stash。"); return;
        }
        if (action.equals("refresh") || action.equals("刷新")) {
            long now = System.currentTimeMillis();
            if (now - refreshed.getOrDefault(p.getUniqueId(), 0L) < 2000) { p.sendMessage("§e刚刚已同步，请等2秒再查；若仍不一致，把物品名称和槽位告知服主。"); return; }
            refreshed.put(p.getUniqueId(), now); p.updateInventory();
        }
        JsonObject out = new JsonObject(); out.addProperty("schemaVersion", 1); out.addProperty("playerUuid", p.getUniqueId().toString());
        out.addProperty("owner", p.getName()); out.addProperty("scope", "player_inventory"); out.addProperty("language", "zh-CN");
        JsonArray rows = new JsonArray(); int empty = 0;
        ItemStack[] items = p.getInventory().getStorageContents();
        for (int slot = 0; slot < items.length; slot++) {
            ItemStack item = items[slot]; if (item == null || item.getType().isAir()) { empty++; continue; }
            JsonObject row = new JsonObject(); row.addProperty("slot", slot); row.addProperty("windowSlot", slot < 9 ? 36 + slot : slot);
            row.addProperty("location", slot < 9 ? "快捷栏第" + (slot + 1) + "格" : "随身背包第" + (slot - 8) + "格");
            row.addProperty("id", item.getType().getKey().toString()); row.addProperty("amount", item.getAmount()); row.addProperty("name", name(item)); rows.add(row);
        }
        out.add("items", rows); out.addProperty("freeStorageSlots", empty);
        p.sendMessage("§b【服务器随身背包】" + rows.size() + "格有物品，" + empty + "格空位；含快捷栏，不含54格大背包、任务物品袋和个人奖励箱。显示不一致用 /mycli inventory refresh；收到装备也请查看快捷栏。");
        p.sendMessage("MC_INVENTORY " + out);
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void pickup(EntityPickupItemEvent event) {
        if (!(event.getEntity() instanceof Player p) || plugin.isObserver(p)) return;
        UUID giver = event.getItem().getThrower();
        if (giver == null || giver.equals(p.getUniqueId())) return;
        // Paper 1.20.6 sets the event stack to the amount that fits; remaining is already excluded.
        int amount = event.getItem().getItemStack().getAmount();
        if (amount <= 0) return;
        UUID id = p.getUniqueId(); boolean first = !pending.containsKey(id);
        List<Gift> gifts = pending.computeIfAbsent(id, ignored -> new ArrayList<>());
        ItemStack sample = event.getItem().getItemStack().clone();
        if (gifts.size() < 64) gifts.add(new Gift(giver, sample, amount, count(p, sample), event));
        if (first) Bukkit.getScheduler().runTask(plugin, () -> {
            List<Gift> received = pending.remove(id); Player receiver = Bukkit.getPlayer(id);
            if (received == null || receiver == null || !receiver.isOnline()) return;
            List<Gift> accepted = received.stream().filter(g -> !g.event.isCancelled()
                    && count(receiver, g.item) >= g.beforeCount + g.amount).toList();
            if (accepted.isEmpty()) return;
            // The pickup has committed by the next tick. This only resends native inventory packets.
            receiver.updateInventory();
            for (Gift gift : accepted) {
                Player source = Bukkit.getPlayer(gift.giver); String from = source == null ? "一位玩家" : source.getName();
                String detail = name(gift.item) + " ×" + gift.amount;
                receiver.sendMessage("§a【收到物品】已拾取 " + from + " 丢出的" + detail + "。请查看随身背包和快捷栏；/mycli inventory 可查服务器记录。");
                if (source != null) source.sendMessage("§a【交物确认】" + receiver.getName() + " 已拾取你丢出的" + detail + "。");
            }
        });
    }
    private static int count(Player player, ItemStack sample) {
        return Arrays.stream(player.getInventory().getContents()).filter(Objects::nonNull)
                .filter(sample::isSimilar).mapToInt(ItemStack::getAmount).sum();
    }
    @EventHandler public void quit(PlayerQuitEvent event) { refreshed.remove(event.getPlayer().getUniqueId()); }
    private static String name(ItemStack item) {
        if (item.hasItemMeta() && item.getItemMeta().hasDisplayName()) return ChatColor.stripColor(item.getItemMeta().getDisplayName());
        return switch (item.getType()) {
            case DIAMOND_CHESTPLATE -> "钻石胸甲"; case DIAMOND_LEGGINGS -> "钻石护腿";
            case DIAMOND_BOOTS -> "钻石靴子"; case DIAMOND_HELMET -> "钻石头盔";
            case IRON_PICKAXE -> "铁镐"; case IRON_SWORD -> "铁剑"; case ENCHANTED_BOOK -> "附魔书";
            case BREAD -> "面包"; case COOKED_BEEF -> "牛排"; case WHEAT -> "小麦";
            default -> "物品（" + item.getType().getKey() + "）";
        };
    }
}
