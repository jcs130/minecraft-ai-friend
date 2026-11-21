package org.afuhome.agentfriend;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.entity.Villager;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;

/** A private vanilla menu and an occasional local greeting for the trial desk. */
final class TrialPlatformDesk implements Listener {
    private static final int SHOP = 10;
    private static final int RECYCLE = 11;
    private static final int PROGRESS = 13;
    private static final int STASH = 15;
    private static final int BARTER = 16;
    private static final int TRIAL = 22;
    private static final long GREETING_COOLDOWN = TimeUnit.MINUTES.toNanos(20);
    private final AgentFriendPlugin plugin;
    private final DungeonManager dungeon;
    private final LinkedHashMap<UUID, Long> greeted = new LinkedHashMap<>();

    TrialPlatformDesk(AgentFriendPlugin plugin, DungeonManager dungeon) {
        this.plugin = plugin;
        this.dungeon = dungeon;
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }

    void greetNearby(Villager manager) {
        for (var entity : manager.getNearbyEntities(6, 3, 6)) {
            if (!(entity instanceof Player player) || !eligible(player) || !dungeon.canGreetAtPlatform(player)
                    || !dungeon.nearPlatformDesk(player)) continue;
            long now = System.nanoTime();
            Long previous = greeted.get(player.getUniqueId());
            if (previous != null && now - previous < GREETING_COOLDOWN) continue;
            if (greeted.size() >= 1024) greeted.pollFirstEntry();
            greeted.put(player.getUniqueId(), now);
            player.sendMessage(ChatColor.GOLD + "试炼管理员：" + ChatColor.WHITE
                    + "你好，「" + player.getName() + "」。需要补给、整理装备或核对试炼进度，可以来找我。");
        }
    }

    void open(Player player) {
        if (!eligible(player)) return;
        var holder = new Menu(player.getUniqueId());
        var inventory = Bukkit.createInventory(holder, 27, "试炼管理员");
        holder.inventory = inventory;
        inventory.setItem(SHOP, icon(Material.GOLD_INGOT, "购买补给", "打开金币商城"));
        inventory.setItem(RECYCLE, icon(Material.HOPPER, "装备回收", "选择装备，查看报价后确认"));
        inventory.setItem(PROGRESS, icon(Material.BOOK, "我的试炼进度", dungeon.playerTrialProgress(player)));
        inventory.setItem(STASH, icon(Material.CHEST, "我的试炼奖励箱", "查看自己的战利品和保管物资"));
        inventory.setItem(BARTER, icon(Material.EMERALD, "以物易物", "使用村民原版交易"));
        inventory.setItem(TRIAL, icon(Material.BLAZE_POWDER, "准备挑战", "在集结平台打开难度与入场菜单"));
        player.openInventory(inventory);
    }

    private boolean eligible(Player player) {
        return player.isOnline() && !player.isDead() && !plugin.isObserver(player)
                && player.getGameMode() != GameMode.SPECTATOR;
    }

    private static ItemStack icon(Material type, String title, String caption) {
        var item = new ItemStack(type);
        var meta = item.getItemMeta();
        meta.setDisplayName(ChatColor.GOLD + title);
        meta.setLore(List.of(ChatColor.GRAY + caption));
        item.setItemMeta(meta);
        return item;
    }

    @EventHandler public void onClick(InventoryClickEvent event) {
        if (!(event.getView().getTopInventory().getHolder() instanceof Menu menu)) return;
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player) || !menu.player.equals(player.getUniqueId())
                || event.getClickedInventory() != menu.inventory || !event.getClick().isLeftClick() && !event.getClick().isRightClick()
                || event.isShiftClick()) return;
        int slot = event.getRawSlot();
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (!eligible(player) || player.getOpenInventory().getTopInventory() != menu.inventory
                    || !dungeon.nearPlatformDesk(player)) return;
            switch (slot) {
                case SHOP -> dungeon.openPlatformShop(player);
                case RECYCLE -> dungeon.openPlatformRecycle(player);
                case PROGRESS -> player.sendMessage(ChatColor.GOLD + "试炼管理员：" + ChatColor.WHITE + dungeon.playerTrialProgress(player));
                case STASH -> dungeon.openStash(player);
                case BARTER -> dungeon.openLegacyMerchant(player);
                case TRIAL -> {
                    if (dungeon.canGreetAtPlatform(player)) plugin.openDungeonDifficultyMenu(player);
                    else player.sendMessage(ChatColor.YELLOW + "请先和队友在试炼塔入口的集结平台会合。");
                }
                default -> { }
            }
        });
    }

    @EventHandler public void onDrag(InventoryDragEvent event) {
        if (event.getView().getTopInventory().getHolder() instanceof Menu) event.setCancelled(true);
    }

    private static final class Menu implements InventoryHolder {
        private final UUID player;
        private Inventory inventory;
        private Menu(UUID player) { this.player = player; }
        @Override public Inventory getInventory() { return inventory; }
    }
}
