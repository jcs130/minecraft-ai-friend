package org.afuhome.compat;

import com.sk89q.worldedit.world.item.ItemType;
import org.bukkit.Material;

/** Namespaced item identity for genuine hybrid registry entries, never AIR. */
public final class HybridItemTypes {
    private HybridItemTypes() { }

    /** Null means the original vanilla adapter must handle this material. */
    public static ItemType resolve(Material material) {
        if (material == null || material.isLegacy() || !material.isItem()
                || material.getKey().getNamespace().equals("minecraft")) return null;
        String key = material.getKey().toString();
        // A hybrid Material can be injected after FAWE takes its vanilla snapshot.
        // Register through FAWE's own API so internal IDs remain unique as well.
        synchronized (ItemType.REGISTRY) {
            ItemType existing = ItemType.REGISTRY.get(key);
            return existing != null ? existing : ItemType.REGISTRY.register(key, new ItemType(key));
        }
    }
}
