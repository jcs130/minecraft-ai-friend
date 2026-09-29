package org.afuhome.agentfriend;

import com.destroystokyo.paper.profile.PlayerProfile;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.inventory.meta.SkullMeta;

/** Keeps Minepacks' named head shortcut usable after its display name changes. */
final class BackpackShortcutMigration {
    private static final String OLD_NAME = "§eBackpack";
    private static final String NAME = "§e大背包";
    private static final String TEXTURE = "eyJ0ZXh0dXJlcyI6eyJTS0lOIjp7InVybCI6Imh0dHA6Ly90ZXh0dXJlcy5taW5lY3JhZnQubmV0L3RleHR1cmUvOGRjYzZlYjQwZjNiYWRhNDFlNDMzOTg4OGQ2ZDIwNzQzNzU5OGJkYmQxNzVjMmU3MzExOTFkNWE5YTQyZDNjOCJ9fX0=";

    private BackpackShortcutMigration() { }

    static int migrate(Player player) {
        PlayerInventory inventory = player.getInventory();
        ItemStack[] items = inventory.getContents();
        int retained = -1;
        for (int slot = 0; slot < items.length; slot++) {
            if (isShortcut(items[slot], OLD_NAME)) { retained = slot; break; }
        }
        if (retained == -1) {
            for (int slot = 0; slot < items.length; slot++) {
                if (isShortcut(items[slot], NAME)) { retained = slot; break; }
            }
        }
        if (retained == -1) return 0;

        int changed = 0;
        for (int slot = 0; slot < items.length; slot++) {
            ItemStack item = items[slot];
            if (slot == retained) {
                if (isShortcut(item, OLD_NAME)) {
                    ItemMeta meta = item.getItemMeta();
                    meta.setDisplayName(NAME);
                    item.setItemMeta(meta);
                    inventory.setItem(slot, item);
                    changed++;
                }
            } else if (isShortcut(item, OLD_NAME) || isShortcut(item, NAME)) {
                inventory.setItem(slot, null);
                changed++;
            }
        }
        return changed;
    }

    private static boolean isShortcut(ItemStack item, String name) {
        if (item == null || item.getType() != Material.PLAYER_HEAD) return false;
        if (!(item.getItemMeta() instanceof SkullMeta meta) || !name.equals(meta.getDisplayName())) return false;
        PlayerProfile profile = meta.getPlayerProfile();
        return profile != null && profile.getProperties().stream().anyMatch(
                property -> property.getName().equals("textures") && TEXTURE.equals(property.getValue()));
    }
}
