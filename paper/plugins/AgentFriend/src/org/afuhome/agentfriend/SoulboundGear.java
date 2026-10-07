package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.command.CommandSender;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.ItemFrame;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.inventory.InventoryPickupItemEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;

/** Owner UUID travels with the vanilla ItemStack through Java, Geyser and Mineflayer. */
final class SoulboundGear implements Listener {
    static final UUID MENGMENG = UUID.fromString("00000000-0000-0000-0009-00000d9f9c7b");
    private final NamespacedKey ownerKey;
    private final Map<UUID, Long> noticeAt = new HashMap<>();

    SoulboundGear(JavaPlugin plugin) {
        ownerKey = new NamespacedKey(plugin, "soulbound_owner");
    }

    String owner(ItemStack stack) {
        if (stack == null || stack.getType().isAir() || !stack.hasItemMeta()) return null;
        return stack.getItemMeta().getPersistentDataContainer().get(ownerKey, PersistentDataType.STRING);
    }

    private boolean isOwner(Player player, ItemStack stack) {
        String owner = owner(stack);
        return owner == null || owner.equals(player.getUniqueId().toString());
    }

    private void warn(Player player) {
        long now = System.currentTimeMillis();
        if (now - noticeAt.getOrDefault(player.getUniqueId(), 0L) < 2000L) return;
        noticeAt.put(player.getUniqueId(), now);
        player.sendMessage(ChatColor.LIGHT_PURPLE + "这件专属装备已绑定，会留在主人身上。");
    }

    private boolean bind(Player player, int slot) {
        PlayerInventory inventory = player.getInventory();
        ItemStack stack = inventory.getItem(slot);
        if (stack == null || stack.getType().isAir() || owner(stack) != null || stack.getAmount() != 1) return false;
        ItemMeta meta = stack.getItemMeta();
        if (meta == null) return false;
        meta.getPersistentDataContainer().set(ownerKey, PersistentDataType.STRING, player.getUniqueId().toString());
        List<String> lore = meta.hasLore() ? new ArrayList<>(meta.getLore()) : new ArrayList<>();
        lore.add(ChatColor.LIGHT_PURPLE + "灵魂绑定 · 仅主人可携带");
        meta.setLore(lore);
        stack.setItemMeta(meta);
        inventory.setItem(slot, stack);
        return true;
    }

    /** Exact enchanted knight-kit signature avoids binding ordinary diamond loot. */
    int bindMengmengKit(Player player) {
        if (!MENGMENG.equals(player.getUniqueId())) return 0;
        int bound = 0;
        for (int slot = 0; slot <= 40; slot++) {
            ItemStack stack = player.getInventory().getItem(slot);
            if (stack == null || owner(stack) != null || !knightKit(stack)) continue;
            if (bind(player, slot)) bound++;
        }
        if (bound > 0) player.sendMessage(ChatColor.LIGHT_PURPLE + "女神的骑士装备已绑定 " + bound + " 件；可以正常穿戴和使用，不会误丢。");
        return bound;
    }

    private static boolean has(ItemStack item, String enchantment, int level) {
        Enchantment enchant = Enchantment.getByKey(NamespacedKey.minecraft(enchantment));
        return enchant != null && item.getEnchantmentLevel(enchant) >= level;
    }

    private static boolean knightKit(ItemStack item) {
        Material type = item.getType();
        if (type == Material.DIAMOND_HELMET || type == Material.DIAMOND_CHESTPLATE
                || type == Material.DIAMOND_LEGGINGS || type == Material.DIAMOND_BOOTS)
            return has(item, "protection", 4) && has(item, "unbreaking", 3)
                    && has(item, "mending", 1)
                    && (type != Material.DIAMOND_BOOTS || has(item, "feather_falling", 4));
        if (type == Material.DIAMOND_SWORD)
            return has(item, "sharpness", 5) && has(item, "fire_aspect", 1)
                    && has(item, "unbreaking", 3) && has(item, "mending", 1);
        return type == Material.BOW && has(item, "power", 4)
                && has(item, "infinity", 1) && has(item, "unbreaking", 3);
    }

    /** Console-only; preview a precise player inventory slot before applying. */
    void adminBind(CommandSender sender, Player player, String rawSlot, boolean apply) {
        int slot;
        try { slot = Integer.parseInt(rawSlot); }
        catch (NumberFormatException invalid) { sender.sendMessage("槽位必须是 0–40。"); return; }
        if (slot < 0 || slot > 40) { sender.sendMessage("槽位必须是 0–40。"); return; }
        ItemStack item = player.getInventory().getItem(slot);
        if (item == null || item.getType().isAir()) { sender.sendMessage("该槽位为空。"); return; }
        String existing = owner(item);
        sender.sendMessage("bindgear player=" + player.getName() + " uuid=" + player.getUniqueId()
                + " slot=" + slot + " item=" + item.getType() + " amount=" + item.getAmount()
                + " name=" + (item.hasItemMeta() && item.getItemMeta().hasDisplayName()
                    ? ChatColor.stripColor(item.getItemMeta().getDisplayName()) : "(原版)")
                + " owner=" + (existing == null ? "none" : existing));
        if (!apply) { sender.sendMessage("核对物品后执行 /mycli admin bindgear " + player.getName() + " " + slot + " apply"); return; }
        if (existing != null) { sender.sendMessage("已有绑定；未修改。"); return; }
        if (item.getAmount() != 1) { sender.sendMessage("仅单件装备可绑定；未修改。"); return; }
        if (!bind(player, slot)) { sender.sendMessage("绑定失败；未修改。"); return; }
        sender.sendMessage("已绑定到 " + player.getUniqueId() + "；槽位 " + slot);
        player.sendMessage(ChatColor.LIGHT_PURPLE + "一件专属装备已绑定：" + item.getType().name() + "。可正常使用，无法丢弃或放入公共箱。");
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onDrop(PlayerDropItemEvent event) {
        if (owner(event.getItemDrop().getItemStack()) == null) return;
        event.setCancelled(true);
        warn(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onPickup(EntityPickupItemEvent event) {
        if (!(event.getEntity() instanceof Player player) || isOwner(player, event.getItem().getItemStack())) return;
        event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onHopperPickup(InventoryPickupItemEvent event) {
        if (owner(event.getItem().getItemStack()) != null) event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onFrameOrStand(PlayerInteractEntityEvent event) {
        if (!(event.getRightClicked() instanceof ItemFrame)
                && !(event.getRightClicked() instanceof ArmorStand)) return;
        ItemStack hand = event.getHand() == org.bukkit.inventory.EquipmentSlot.HAND
                ? event.getPlayer().getInventory().getItemInMainHand()
                : event.getPlayer().getInventory().getItemInOffHand();
        if (owner(hand) == null) return;
        event.setCancelled(true);
        warn(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onInventoryClick(InventoryClickEvent event) {
        if (!(event.getWhoClicked() instanceof Player player)) return;
        boolean external = event.getView().getTopInventory().getType() != InventoryType.CRAFTING
                && event.getView().getTopInventory().getType() != InventoryType.CREATIVE;
        ItemStack clicked = event.getCurrentItem();
        ItemStack cursor = event.getCursor();
        ClickType click = event.getClick();
        boolean drop = click == ClickType.DROP || click == ClickType.CONTROL_DROP;
        boolean deny = drop && owner(clicked) != null;
        if (event.getRawSlot() < 0 && owner(cursor) != null) deny = true;
        if (!isOwner(player, clicked) || !isOwner(player, cursor)) deny = true;
        if (external) {
            boolean top = event.getRawSlot() >= 0
                    && event.getRawSlot() < event.getView().getTopInventory().getSize();
            if (top && owner(cursor) != null) deny = true;
            if (!top && click.isShiftClick() && owner(clicked) != null) deny = true;
            if (top && event.getHotbarButton() >= 0
                    && owner(player.getInventory().getItem(event.getHotbarButton())) != null) deny = true;
            if (top && click == ClickType.SWAP_OFFHAND
                    && owner(player.getInventory().getItemInOffHand()) != null) deny = true;
        }
        if (!deny) return;
        event.setCancelled(true);
        warn(player);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onInventoryDrag(InventoryDragEvent event) {
        if (!(event.getWhoClicked() instanceof Player player) || owner(event.getOldCursor()) == null) return;
        boolean external = event.getView().getTopInventory().getType() != InventoryType.CRAFTING
                && event.getView().getTopInventory().getType() != InventoryType.CREATIVE;
        boolean top = external && event.getRawSlots().stream().anyMatch(
                slot -> slot < event.getView().getTopInventory().getSize());
        if (!top && isOwner(player, event.getOldCursor())) return;
        event.setCancelled(true);
        warn(player);
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onDeath(PlayerDeathEvent event) {
        if (event.getKeepInventory()) return;
        UUID player = event.getEntity().getUniqueId();
        event.getDrops().removeIf(item -> {
            if (!player.toString().equals(owner(item))) return false;
            event.getItemsToKeep().add(item);
            return true;
        });
    }
}
