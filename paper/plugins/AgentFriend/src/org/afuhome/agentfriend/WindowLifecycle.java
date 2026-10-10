package org.afuhome.agentfriend;

import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.*;

/** Walking closes an action player's real container; looking around and spectator following do not. */
final class WindowLifecycle implements Listener {
    private final AgentFriendPlugin plugin;
    private final Map<UUID, Location> anchors = new HashMap<>();
    WindowLifecycle(AgentFriendPlugin plugin) {
        this.plugin = plugin; Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getScheduler().runTaskTimer(plugin, this::checkRange, 5L, 5L);
    }
    private void checkRange() {
        for (UUID id : new ArrayList<>(anchors.keySet())) {
            Player player = Bukkit.getPlayer(id);
            if (player == null || plugin.isObserver(player)) { anchors.remove(id); continue; }
            var inventory = player.getOpenInventory().getTopInventory();
            Location source = inventory.getLocation();
            if (inventory instanceof org.bukkit.inventory.MerchantInventory merchant
                    && merchant.getMerchant() instanceof org.bukkit.entity.Entity entity)
                source = entity.getLocation();
            // Remote personal storage and authored virtual menus have no physical source.
            if (source != null && (!source.getWorld().equals(player.getWorld())
                    || source.distanceSquared(player.getLocation()) > 6.5 * 6.5)) {
                anchors.remove(id); player.closeInventory();
            }
        }
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void open(InventoryOpenEvent event) {
        if (event.getPlayer() instanceof Player player && !plugin.isObserver(player)
                && event.getView().getType() != InventoryType.CRAFTING)
            anchors.put(player.getUniqueId(), player.getLocation().clone());
    }
    @EventHandler(priority = EventPriority.MONITOR)
    public void close(InventoryCloseEvent event) { anchors.remove(event.getPlayer().getUniqueId()); }
    @EventHandler public void quit(PlayerQuitEvent event) { anchors.remove(event.getPlayer().getUniqueId()); }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void teleport(PlayerTeleportEvent event) { move(event); }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void move(PlayerMoveEvent event) {
        Player player = event.getPlayer(); Location anchor = anchors.get(player.getUniqueId()), to = event.getTo();
        if (anchor == null || to == null || plugin.isObserver(player)) return;
        if (player.getOpenInventory().getType() == InventoryType.CRAFTING) { anchors.remove(player.getUniqueId()); return; }
        double dx = to.getX() - anchor.getX(), dz = to.getZ() - anchor.getZ();
        if (!anchor.getWorld().equals(to.getWorld()) || dx * dx + dz * dz > 0.35 * 0.35
                || Math.abs(to.getY() - anchor.getY()) > 0.5) {
            anchors.remove(player.getUniqueId()); player.closeInventory();
        }
    }
}
