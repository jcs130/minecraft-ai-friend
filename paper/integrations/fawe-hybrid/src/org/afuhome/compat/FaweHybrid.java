package org.afuhome.compat;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.HashSet;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import org.bukkit.Material;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerItemHeldEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.RegisteredListener;
import org.bukkit.plugin.java.JavaPlugin;

/** Keep FAWE's vanilla-only brush cache away from hybrid-only item types. */
public final class FaweHybrid extends JavaPlugin {
    private record Replacement(HandlerList handlers, RegisteredListener original,
                               RegisteredListener wrapper) { }
    private final List<Replacement> replacements = new ArrayList<>();
    private final Set<Material> supportedMaterials = new HashSet<>();
    private final Set<Material> unsupportedMaterials = new HashSet<>();

    private boolean vanilla(ItemStack item) {
        if (item == null) return true;
        Material type = item.getType();
        if (supportedMaterials.contains(type)) return true;
        if (unsupportedMaterials.contains(type)) return false;
        // Ask the installed adapter's public API once per Material. Hybrid enum
        // injection can outgrow its cached array even for otherwise valid items.
        // Never reinterpret an unsupported item as AIR or hide other failures.
        boolean supported;
        try { supported = !type.isLegacy() && BukkitAdapter.asItemType(type) != null; }
        catch (ArrayIndexOutOfBoundsException hybridOrdinal) { supported = false; }
        (supported ? supportedMaterials : unsupportedMaterials).add(type);
        return supported;
    }

    private boolean supported(Event event) {
        if (event instanceof PlayerItemHeldEvent held) {
            return vanilla(held.getPlayer().getInventory().getItemInMainHand())
                && vanilla(held.getPlayer().getInventory().getItem(held.getNewSlot()));
        }
        if (event instanceof PlayerInteractEvent interact) {
            return vanilla(interact.getPlayer().getInventory().getItemInMainHand());
        }
        return true;
    }

    @Override public void onEnable() {
        Plugin fawe = getServer().getPluginManager().getPlugin("FastAsyncWorldEdit");
        if (fawe == null || !fawe.isEnabled()) {
            getLogger().info("FAWE is absent; no event handlers changed.");
            return;
        }
        for (HandlerList handlers : List.of(PlayerItemHeldEvent.getHandlerList(),
                                            PlayerInteractEvent.getHandlerList())) {
            for (RegisteredListener original : handlers.getRegisteredListeners()) {
                if (original.getPlugin() != fawe || !original.getListener().getClass().getName()
                    .equals("com.fastasyncworldedit.bukkit.listener.BrushListener")) continue;
                RegisteredListener wrapper = new RegisteredListener(original.getListener(),
                    (listener, event) -> { if (supported(event)) original.callEvent(event); },
                    original.getPriority(), fawe, original.isIgnoringCancelled());
                handlers.unregister(original);
                handlers.register(wrapper);
                replacements.add(new Replacement(handlers, original, wrapper));
            }
        }
        getLogger().info("Protected " + replacements.size()
            + " vanilla-only FAWE brush handlers; item use and other listeners remain unchanged.");
        if (replacements.size() != 2) getLogger().warning(
            "Expected two pinned FAWE brush handlers. Revalidate after an FAWE upgrade.");
    }

    @Override public void onDisable() {
        for (Replacement replacement : replacements) {
            boolean present = false;
            for (RegisteredListener listener : replacement.handlers.getRegisteredListeners()) {
                if (listener == replacement.wrapper) present = true;
            }
            if (!present) continue;
            replacement.handlers.unregister(replacement.wrapper);
            if (replacement.original.getPlugin().isEnabled()) {
                replacement.handlers.register(replacement.original);
            }
        }
        replacements.clear();
    }
}
