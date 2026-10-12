package org.afuhome.agentfriend;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.*;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.player.*;
import org.bukkit.inventory.*;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;

/** Cosmetic vanilla CustomModelData only. Never changes material, count,
 * durability, enchantments, spell imprints, lore or soulbound ownership.
 * Existing items are matched by their real server signature, never name alone.
 * No offline-player/world/container sweep and no recurring per-player timer.
 */
final class ItemAppearances implements Listener {
    private static final NamespacedKey ID = NamespacedKey.fromString("agentfriend:appearance");
    private static ItemAppearances active;
    private final AgentFriendPlugin plugin;
    private final Map<String, Definition> definitions = new LinkedHashMap<>();
    private final Set<UUID> pending = new HashSet<>();
    private record Definition(String id, String name, Material material, int modelData,
                              String kind, String spell, Map<Enchantment,Integer> enchants) {}

    ItemAppearances(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        try {
            File file = new File(plugin.getDataFolder(), "item-appearances.json");
            try (Reader reader = file.exists() ? Files.newBufferedReader(file.toPath(), StandardCharsets.UTF_8)
                    : new InputStreamReader(Objects.requireNonNull(plugin.getResource("item-appearances.json")), StandardCharsets.UTF_8)) {
                JsonObject root = JsonParser.parseReader(reader).getAsJsonObject();
                if (root.has("enabled") && !root.get("enabled").getAsBoolean()) return;
                if (root.get("schemaVersion").getAsInt() != 1) throw new IllegalArgumentException("schemaVersion");
                Set<Integer> numbers = new HashSet<>();
                JsonArray items = root.getAsJsonArray("items");
                if (items.isEmpty() || items.size() > 64) throw new IllegalArgumentException("item budget");
                for (JsonElement element : items) {
                    JsonObject item = element.getAsJsonObject(), match = item.getAsJsonObject("match");
                    String id = item.get("id").getAsString(), kind = match.get("kind").getAsString();
                    int number = item.get("modelData").getAsInt();
                    Material material = Material.matchMaterial(item.get("baseId").getAsString());
                    if (!id.matches("[a-z][a-z0-9_]{1,47}") || definitions.containsKey(id)
                            || number < 700000 || number >= 800000 || !numbers.add(number)
                            || material == null || material.isAir()
                            || !Set.of("imprint", "focus", "dungeon_loot").contains(kind))
                        throw new IllegalArgumentException("item definition");
                    Map<Enchantment,Integer> enchants = new HashMap<>();
                    if (match.has("enchants")) for (var entry : match.getAsJsonObject("enchants").entrySet()) {
                        Enchantment enchant = Enchantment.getByKey(NamespacedKey.minecraft(entry.getKey()));
                        int level = entry.getValue().getAsInt();
                        if (enchant == null || level < 1 || level > enchant.getMaxLevel()) throw new IllegalArgumentException("enchantment");
                        enchants.put(enchant, level);
                    }
                    if (kind.equals("dungeon_loot") && enchants.isEmpty()) throw new IllegalArgumentException("loot signature");
                    definitions.put(id, new Definition(id, match.has("name") ? match.get("name").getAsString() : "",
                            material, number, kind, match.has("spell") ? match.get("spell").getAsString() : "", Map.copyOf(enchants)));
                }
            }
            active = this;
            Bukkit.getPluginManager().registerEvents(this, plugin);
            for (Player player : Bukkit.getOnlinePlayers()) schedule(player, 40);
            plugin.getLogger().info("Item appearances ready: " + definitions.size() + " cosmetic vanilla item models");
        } catch (Exception invalid) {
            definitions.clear();
            plugin.getLogger().severe("特色装备外观配置无效，未修改任何物品；检查 item-appearances.json：" + invalid.getClass().getSimpleName());
        }
    }

    private static String plain(net.kyori.adventure.text.Component text) {
        return ChatColor.stripColor(PlainTextComponentSerializer.plainText().serialize(text));
    }

    private boolean matches(Definition definition, ItemStack stack, boolean alreadyMarked) {
        if (stack == null || stack.getType() != definition.material || !stack.hasItemMeta()) return false;
        ItemMeta meta = stack.getItemMeta();
        if (!alreadyMarked && !definition.name.isEmpty()
                && (!meta.hasDisplayName() || !definition.name.equals(plain(meta.displayName())))) return false;
        if (definition.kind.equals("focus")) return stack.getType() == Material.BLAZE_ROD
                && Byte.valueOf((byte)1).equals(meta.getPersistentDataContainer().get(
                        NamespacedKey.fromString("agentfriend:spell_focus"), PersistentDataType.BYTE));
        if (definition.kind.equals("imprint")) return !definition.spell.isBlank()
                && definition.spell.equals(meta.getPersistentDataContainer().get(
                        NamespacedKey.fromString("agentfriend:imprint_spell"), PersistentDataType.STRING));
        return meta.hasLore() && meta.lore().stream().anyMatch(line -> plain(line).equals("千灯纪试炼战利品"))
                && definition.enchants.entrySet().stream().allMatch(e -> meta.getEnchantLevel(e.getKey()) >= e.getValue());
    }

    private Definition find(ItemStack stack) {
        if (stack == null || !stack.hasItemMeta()) return null;
        String marked = stack.getItemMeta().getPersistentDataContainer().get(ID, PersistentDataType.STRING);
        if (marked != null) {
            Definition definition = definitions.get(marked);
            return definition != null && matches(definition, stack, true) ? definition : null;
        }
        for (Definition definition : definitions.values()) if (matches(definition, stack, false)) return definition;
        return null;
    }

    private boolean apply(ItemStack stack) {
        Definition definition = find(stack);
        if (definition == null) return false;
        ItemMeta meta = stack.getItemMeta();
        String marked = meta.getPersistentDataContainer().get(ID, PersistentDataType.STRING);
        // A different plugin's custom model is not ours to replace. Nor do we
        // rewrite an already marked item's numeric ID after catalog changes.
        if (meta.hasCustomModelData()) return false;
        if (marked != null && !marked.equals(definition.id)) return false;
        meta.setCustomModelData(definition.modelData);
        meta.getPersistentDataContainer().set(ID, PersistentDataType.STRING, definition.id);
        stack.setItemMeta(meta);
        return true;
    }

    static ItemStack decorate(ItemStack stack) {
        if (active != null) active.apply(stack);
        return stack;
    }

    static void appendDescription(ItemStack stack, JsonObject out) {
        if (active == null || stack == null || !stack.hasItemMeta()) return;
        Definition definition = active.find(stack);
        ItemMeta meta = stack.getItemMeta();
        if (definition == null || !meta.hasCustomModelData() || meta.getCustomModelData() != definition.modelData
                || !definition.id.equals(meta.getPersistentDataContainer().get(ID, PersistentDataType.STRING))) return;
        JsonObject visual = new JsonObject();
        visual.addProperty("id", "qiandengji:" + definition.id);
        visual.addProperty("customModelData", definition.modelData);
        visual.addProperty("baseId", stack.getType().getKey().toString());
        visual.addProperty("cosmeticOnly", true);
        visual.addProperty("requiresResourcePack", true);
        out.add("appearance", visual);
    }

    private void schedule(Player player, long delay) {
        UUID uuid = player.getUniqueId();
        if (!pending.add(uuid)) return;
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            pending.remove(uuid);
            // Defer changes while trading or clicking a storage window. The
            // close event retries; do not invalidate an in-flight transaction.
            if (!player.isOnline() || plugin.isObserver(player)
                    || player.getOpenInventory().getType() != org.bukkit.event.inventory.InventoryType.CRAFTING) return;
            PlayerInventory inventory = player.getInventory();
            for (int slot = 0; slot < inventory.getSize(); slot++) {
                ItemStack stack = inventory.getItem(slot);
                if (stack != null && apply(stack)) inventory.setItem(slot, stack);
            }
        }, delay);
    }
    @EventHandler(priority = EventPriority.MONITOR) public void onJoin(PlayerJoinEvent event) { schedule(event.getPlayer(), 40); }
    @EventHandler(priority = EventPriority.MONITOR) public void onHeld(PlayerItemHeldEvent event) { schedule(event.getPlayer(), 1); }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true) public void onPickup(EntityPickupItemEvent event) {
        if (event.getEntity() instanceof Player player) schedule(player, 1);
    }
    @EventHandler(priority = EventPriority.MONITOR) public void onClose(InventoryCloseEvent event) {
        if (event.getPlayer() instanceof Player player) schedule(player, 1);
    }
    @EventHandler public void onQuit(PlayerQuitEvent event) { pending.remove(event.getPlayer().getUniqueId()); }
    void stop() { if (active == this) active = null; pending.clear(); }
}
