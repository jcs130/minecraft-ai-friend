package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.EnumMap;
import java.util.LinkedHashSet;
import java.util.Set;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;

/** A read-only summary of the owner's occupied slots, across all personal chest pages. */
final class PersonalStashOverview {
    static final String COMMAND = "/mycli arena stash summary";
    static final String QUERY = COMMAND + " --json";
    static final String REWARDS = "/mycli arena rewards list";
    private static final NamespacedKey SPELL_FOCUS = new NamespacedKey("agentfriend", "spell_focus");

    private enum Category {
        WEAPONS("weapons"), ARMOR("armor"), CONSUMABLES("consumables"), OTHER("other");

        final String key;

        Category(String key) {
            this.key = key;
        }
    }

    private static final class Count {
        long items;
        int slots;
        final Set<Integer> pages = new LinkedHashSet<>();
    }

    private final EnumMap<Category, Count> counts = new EnumMap<>(Category.class);
    private final int pendingRewardEntries;
    private long totalItems;
    private int occupiedSlots;
    private int firstOccupiedPage;

    static boolean matchesCommand(String[] args) {
        int start = args.length > 0 && args[0].equals("--json") ? 1 : 0;
        return args.length >= start + 3
                && (args[start].equalsIgnoreCase("arena") || args[start].equals("试炼"))
                && (args[start + 1].equalsIgnoreCase("stash") || args[start + 1].equals("储物"))
                && args[start + 2].equalsIgnoreCase("summary");
    }

    PersonalStashOverview(PagedPersonalStash.Snapshot snapshot, int pendingRewardEntries) {
        this.pendingRewardEntries = pendingRewardEntries;
        for (Category category : Category.values()) counts.put(category, new Count());
        ItemStack[] items = snapshot.items();
        for (int slot = 0; slot < items.length; slot++) {
            ItemStack item = items[slot];
            if (item == null || item.getType().isAir() || item.getAmount() <= 0) continue;
            int page = slot / PagedPersonalStash.PAGE_SIZE + 1;
            if (firstOccupiedPage == 0) firstOccupiedPage = page;
            Count count = counts.get(category(item));
            count.items += item.getAmount();
            count.slots++;
            count.pages.add(page);
            totalItems += item.getAmount();
            occupiedSlots++;
        }
    }

    private static Category category(ItemStack item) {
        Material material = item.getType();
        String name = material.name();
        if (DungeonLoadoutRules.melee(name) || material == Material.BOW || material == Material.CROSSBOW)
            return Category.WEAPONS;
        if (name.endsWith("_HELMET") || name.endsWith("_CHESTPLATE") || name.endsWith("_LEGGINGS")
                || name.endsWith("_BOOTS") || material == Material.SHIELD || material == Material.ELYTRA)
            return Category.ARMOR;
        return switch (material) {
            case BLAZE_ROD, BOOK, BONE, CLOCK -> {
                if (!item.hasItemMeta()) yield Category.OTHER;
                var data = item.getItemMeta().getPersistentDataContainer();
                yield InventoryTidy.vortexCombatFocus(material, data)
                        || material == Material.BLAZE_ROD && data.has(SPELL_FOCUS, PersistentDataType.BYTE)
                        ? Category.WEAPONS : Category.OTHER;
            }
            case POTION, SPLASH_POTION, LINGERING_POTION, ARROW, TIPPED_ARROW, SPECTRAL_ARROW,
                FIREWORK_ROCKET, EXPERIENCE_BOTTLE, ENDER_PEARL, WIND_CHARGE, MILK_BUCKET,
                TOTEM_OF_UNDYING -> Category.CONSUMABLES;
            default -> material.isEdible() ? Category.CONSUMABLES : Category.OTHER;
        };
    }

    int freeSlots() {
        return PagedPersonalStash.CAPACITY - occupiedSlots;
    }

    String nextCommand() {
        if (pendingRewardEntries > 0) return REWARDS;
        return occupiedSlots > 0 ? "/mycli arena stash list " + firstOccupiedPage : "/mycli arena stash inventory";
    }

    String text() {
        return "个人箱 " + occupiedSlots + "/" + PagedPersonalStash.CAPACITY + " 格，余 " + freeSlots()
                + " 格。箱内 " + totalItems + " 件（武器及法器 " + counts.get(Category.WEAPONS).items
                + "、防具 " + counts.get(Category.ARMOR).items + "、消耗品 " + counts.get(Category.CONSUMABLES).items
                + "、其他 " + counts.get(Category.OTHER).items + "）。"
                + (pendingRewardEntries > 0 ? "另有 " + pendingRewardEntries + " 项待入箱。" : "");
    }

    JsonObject json() {
        JsonObject out = new JsonObject();
        out.addProperty("schemaVersion", 1);
        out.addProperty("scope", "personal_stash");
        out.addProperty("pageCount", PagedPersonalStash.PAGES);
        out.addProperty("pageSize", PagedPersonalStash.PAGE_SIZE);
        out.addProperty("capacity", PagedPersonalStash.CAPACITY);
        out.addProperty("occupiedSlots", occupiedSlots);
        out.addProperty("freeSlots", freeSlots());
        out.addProperty("totalItems", totalItems);
        out.addProperty("pendingRewardEntries", pendingRewardEntries);
        out.addProperty("nextCommand", nextCommand());
        JsonObject categories = new JsonObject();
        for (var entry : counts.entrySet()) {
            Count count = entry.getValue();
            JsonObject row = new JsonObject();
            row.addProperty("items", count.items);
            row.addProperty("occupiedSlots", count.slots);
            JsonArray pages = new JsonArray();
            count.pages.forEach(pages::add);
            row.add("pages", pages);
            categories.add(entry.getKey().key, row);
        }
        out.add("categories", categories);
        return out;
    }
}
