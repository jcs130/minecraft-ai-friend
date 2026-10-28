package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerItemHeldEvent;
import org.bukkit.event.player.PlayerAttemptPickupItemEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.inventory.ItemStack;

/** Read the action player's actual inventory; successful player gifts get private receipts only. */
final class InventoryFeedback implements Listener {
    private final AgentFriendPlugin plugin;
    private final ItemIdentity identity;
    private final Map<UUID, Long> refreshed = new HashMap<>();
    private final Map<UUID, List<Gift>> pending = new HashMap<>();
    private final Map<UUID, Set<String>> explained = new HashMap<>();
    private final Set<UUID> scheduled = new HashSet<>();
    private final Map<UUID, Long> fullHints = new HashMap<>();
    private record Gift(UUID giver, ItemStack item, int amount, int beforeCount, EntityPickupItemEvent event) {}
    InventoryFeedback(AgentFriendPlugin plugin) {
        this.plugin = plugin; identity = new ItemIdentity(plugin);
        Bukkit.getPluginManager().registerEvents(this, plugin);
        for (Player player : Bukkit.getOnlinePlayers()) scheduleNotice(player, 80L);
    }
    void command(Player p, String[] args) {
        if (plugin.isObserver(p)) { p.sendMessage("§e【随身背包】这是观战账号；请在附身角色自己的连接上查询。观战画面展示该角色的物品，不是观战账号的存档。"); return; }
        String action = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "status";
        if (action.equals("item") || action.equals("物品")) { inspect(p, args); return; }
        if (!Set.of("status", "refresh", "状态", "刷新").contains(action)) {
            p.sendMessage("§e用 /mycli inventory 查服务器随身背包；refresh 同步显示；item <0–35|hand> 查物品真实名称和用法。54格大背包需另行打开；个人奖励箱用 /mycli arena stash。"); return;
        }
        if (action.equals("refresh") || action.equals("刷新")) {
            long now = System.currentTimeMillis();
            if (now - refreshed.getOrDefault(p.getUniqueId(), 0L) < 2000) { p.sendMessage("§e刚刚已同步，请等2秒再查；若仍不一致，把物品名称和槽位告知服主。"); return; }
            refreshed.put(p.getUniqueId(), now); p.updateInventory();
        }
        List<JsonObject> rows = new ArrayList<>(); int empty = 0;
        ItemStack[] items = p.getInventory().getStorageContents();
        for (int slot = 0; slot < items.length; slot++) {
            ItemStack item = items[slot]; if (item == null || item.getType().isAir()) { empty++; continue; }
            JsonObject row = new JsonObject(); row.addProperty("slot", slot); row.addProperty("windowSlot", slot < 9 ? 36 + slot : slot);
            row.addProperty("location", slot < 9 ? "快捷栏第" + (slot + 1) + "格" : "随身背包第" + (slot - 8) + "格");
            row.addProperty("id", item.getType().getKey().toString()); row.addProperty("amount", item.getAmount());
            identity.describe(item).append(row, false); ItemAppearances.appendDescription(item, row); rows.add(row);
        }
        p.sendMessage("§b【服务器随身背包】" + rows.size() + "格有物品，" + empty + "格空位；含快捷栏，不含54格大背包、任务物品袋和个人奖励箱。显示不一致用 /mycli inventory refresh；收到装备也请查看快捷栏。");
        if(empty==0)storageHint(p,false);
        // Prismarine-chat messagestr is limited to 4096 characters. Send complete
        // bounded pages, retaining schemaVersion/id/amount/slot fields for clients.
        List<List<JsonObject>> pages = new ArrayList<>(); List<JsonObject> batch = new ArrayList<>(); int chars = 0;
        for (JsonObject row : rows) {
            int length = row.toString().length() + 1;
            if (!batch.isEmpty() && (batch.size() >= 8 || chars + length > 2800)) { pages.add(List.copyOf(batch)); batch.clear(); chars = 0; }
            batch.add(row); chars += length;
        }
        if (!batch.isEmpty() || pages.isEmpty()) pages.add(List.copyOf(batch));
        for (int page = 0; page < pages.size(); page++) {
            JsonObject out = new JsonObject(); out.addProperty("schemaVersion", 1); out.addProperty("playerUuid", p.getUniqueId().toString());
            out.addProperty("owner", p.getName()); out.addProperty("scope", "player_inventory"); out.addProperty("language", "zh-CN");
            out.addProperty("page", page + 1); out.addProperty("pages", pages.size()); out.addProperty("totalItems", rows.size());
            out.addProperty("freeStorageSlots", empty); out.addProperty("namePolicy", "name_is_display_baseId_is_material");
            JsonArray itemsOnPage = new JsonArray(); pages.get(page).forEach(itemsOnPage::add); out.add("items", itemsOnPage);
            p.sendMessage("MC_INVENTORY " + out);
        }
        showKnown(p, false);
    }
    private void inspect(Player p, String[] args) {
        int slot;
        try { slot = args.length == 3 && args[2].equalsIgnoreCase("hand") ? p.getInventory().getHeldItemSlot()
                : args.length == 3 ? Integer.parseInt(args[2]) : -1; } catch (NumberFormatException invalid) { slot = -1; }
        if (slot < 0 || slot > 35) { p.sendMessage("§e用 /mycli inventory item <0–35|hand> 查本人随身物品；先 inventory 查槽位，快捷栏为0–8。"); return; }
        ItemStack item = p.getInventory().getItem(slot);
        JsonObject out = new JsonObject(); out.addProperty("schemaVersion", 1); out.addProperty("slot", slot);
        out.addProperty("owner", p.getName());
        if (item == null || item.getType().isAir()) {
            out.addProperty("status", "empty"); p.sendMessage("§e这个随身槽位为空；/mycli inventory 查有物品的槽位。");
        } else {
            var description = identity.describe(item);
            out.addProperty("status", "ok"); out.addProperty("id", description.baseId()); out.addProperty("amount", item.getAmount()); description.append(out, true);
            ItemAppearances.appendDescription(item, out);
            p.sendMessage("§b【物品说明】槽位" + slot + "：" + description.name() + " ×" + item.getAmount()
                    + (description.serverItem() ? "；" + description.usage() : description.lore().isEmpty() ? "" : "；" + String.join("；", description.lore())));
            p.sendMessage("§7物品名称为「" + description.name() + "」；基础材质ID " + description.baseId() + " 用于协议识别。识别特色道具请读名称、说明和服务器标识。");
        }
        p.sendMessage("MC_ITEM " + out);
    }
    private void scheduleNotice(Player p, long delay) {
        UUID id = p.getUniqueId(); if (!scheduled.add(id)) return;
        Bukkit.getScheduler().runTaskLater(plugin, () -> { scheduled.remove(id); if (p.isOnline() && !plugin.isObserver(p)) showKnown(p, true); }, delay);
    }
    private void showKnown(Player p, boolean onlyNew) {
        Set<String> seen = explained.computeIfAbsent(p.getUniqueId(), ignored -> new HashSet<>());
        Set<String> shown = new HashSet<>(); List<String> lines = new ArrayList<>();
        for (int slot = 0; slot < 36; slot++) {
            ItemStack item = p.getInventory().getItem(slot); if (item == null || item.getType().isAir()) continue;
            var description = identity.describe(item);
            if (!description.serverItem() || !shown.add(description.customId()) || onlyNew && seen.contains(description.customId())) continue;
            seen.add(description.customId()); lines.add("槽位" + slot + "「" + description.name() + "」：" + description.usage());
        }
        if (!lines.isEmpty()) p.sendMessage("§b【特色道具】§f" + String.join("\n", lines));
    }
    @EventHandler public void join(PlayerJoinEvent event) { scheduleNotice(event.getPlayer(), 80L); }
    @EventHandler(ignoreCancelled = true) public void held(PlayerItemHeldEvent event) { scheduleNotice(event.getPlayer(), 1L); }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true) public void click(InventoryClickEvent event) {
        if (event.getWhoClicked() instanceof Player p) scheduleNotice(p, 1L);
    }
    @EventHandler public void close(InventoryCloseEvent event) {
        if (event.getPlayer() instanceof Player p) scheduleNotice(p, 1L);
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void blockedPickup(PlayerAttemptPickupItemEvent event) {
        Player p=event.getPlayer();
        if(plugin.isObserver(p)||event.getRemaining()<1)return;
        // No world scan or forced inventory refresh; do not cancel natural pickup.
        ItemStack item=event.getItem().getItemStack();
        if(item==null||item.getType().isAir())return;
        storageHint(p,true);
    }
    private void storageHint(Player p,boolean cooldown){
        long now=System.currentTimeMillis();
        if(cooldown&&now-fullHints.getOrDefault(p.getUniqueId(),0L)<60000)return;
        fullHints.put(p.getUniqueId(),now);
        p.sendMessage("§e【inventory_full】"+(cooldown?"物品未全部装入背包。":"随身没有空槽，同类物品仍可合并。")+"先 /mycli inventory 查槽位，再 /mycli arena stash putslot <槽> <数量> 远程存箱（成功2魔力，不必先开界面）；stash list核对。多余装备：/mycli arena recycle list。");
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void pickup(EntityPickupItemEvent event) {
        if (!(event.getEntity() instanceof Player p) || plugin.isObserver(p)) return;
        scheduleNotice(p, 1L);
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
                String detail = identity.describe(gift.item).name() + " ×" + gift.amount;
                receiver.sendMessage("§a【收到物品】已拾取 " + from + " 丢出的" + detail + "。请查看随身背包和快捷栏；/mycli inventory 可查服务器记录。");
                if (source != null) source.sendMessage("§a【交物确认】" + receiver.getName() + " 已拾取你丢出的" + detail + "。");
            }
        });
    }
    private static int count(Player player, ItemStack sample) {
        return Arrays.stream(player.getInventory().getContents()).filter(Objects::nonNull)
                .filter(sample::isSimilar).mapToInt(ItemStack::getAmount).sum();
    }
    @EventHandler public void quit(PlayerQuitEvent event) {
        UUID id = event.getPlayer().getUniqueId(); refreshed.remove(id); explained.remove(id); scheduled.remove(id); fullHints.remove(id);
    }
}
