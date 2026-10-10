package org.afuhome.cortieye;

import com.comphenix.protocol.*;
import com.comphenix.protocol.events.*;
import com.mojang.datafixers.util.Pair;
import java.util.*;
import net.minecraft.network.protocol.game.*;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;
import org.afuhome.eye.EyePairs;
import org.bukkit.Bukkit;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.*;

/** Native client-only inventory snapshots also work without the SpectatorPlus client mod. */
final class EyeInventoryMirror implements Listener {
    private record State(UUID target, int entityId, UUID world, int signature) {}
    private final ProtocolManager protocol;
    private final CortiEyeMirrorPlugin plugin;
    private final Map<UUID, State> states = new HashMap<>();
    private record Replica(UUID target, int sourceId, Inventory inventory) {}
    private final Map<UUID, Replica> merchants = new HashMap<>();
    private final Set<UUID> openingMerchants = new HashSet<>();
    private volatile Set<UUID> attached = Set.of();
    EyeInventoryMirror(CortiEyeMirrorPlugin plugin, ProtocolManager protocol) {
        this.plugin = plugin;
        this.protocol = protocol;
        Bukkit.getPluginManager().registerEvents(this, plugin);
        protocol.addPacketListener(new PacketAdapter(plugin, ListenerPriority.HIGHEST,
                PacketType.Play.Server.WINDOW_ITEMS, PacketType.Play.Server.SET_SLOT,
                PacketType.Play.Server.UPDATE_HEALTH, PacketType.Play.Server.EXPERIENCE,
                PacketType.Play.Server.HELD_ITEM_SLOT, PacketType.Play.Server.OPEN_WINDOW_MERCHANT) {
            @Override public void onPacketSending(PacketEvent event) {
                if (event.getPacketType() == PacketType.Play.Server.OPEN_WINDOW_MERCHANT) {
                    if (openingMerchants.contains(event.getPlayer().getUniqueId()) || replica(event.getPlayer())) event.setCancelled(true);
                    return;
                }
                if (!attached.contains(event.getPlayer().getUniqueId())) return;
                if (event.getPacketType() == PacketType.Play.Server.WINDOW_ITEMS
                        || event.getPacketType() == PacketType.Play.Server.SET_SLOT) {
                    if (event.getPacket().getIntegers().read(0) != 0) return;
                }
                // Our snapshots use sendServerPacket(..., false); never feed them back through this filter.
                event.setCancelled(true);
            }
        });
    }
    void tick(List<EyePairs.Pair> pairs) {
        Map<UUID, Player> subjects = new HashMap<>();
        for (var pair : pairs) {
            Player eye = Bukkit.getPlayerExact(pair.eye()), target = Bukkit.getPlayerExact(pair.agent());
            if (CortiEyeMirrorPlugin.isAttached(target, eye)) subjects.put(eye.getUniqueId(), target);
        }
        attached = Set.copyOf(subjects.keySet());
        for (UUID id : new ArrayList<>(states.keySet())) if (!subjects.containsKey(id)) {
            states.remove(id); merchants.remove(id); Player eye = Bukkit.getPlayer(id);
            if (eye != null) { eye.closeInventory(); snapshot(eye, eye); }
        }
        for (var entry : subjects.entrySet()) {
            Player eye = Bukkit.getPlayer(entry.getKey()), target = entry.getValue();
            var handle = ((CraftPlayer) target).getHandle();
            int signature = Objects.hash(Arrays.hashCode(target.getInventory().getContents()),
                    target.getHealth(), target.getFoodLevel(), target.getSaturation(), target.getExp(),
                    target.getTotalExperience(), target.getLevel(), target.getInventory().getHeldItemSlot());
            State next = new State(target.getUniqueId(), target.getEntityId(), target.getWorld().getUID(), signature);
            State previous = states.put(entry.getKey(), next);
            if (previous != null && (!previous.target.equals(next.target) || !previous.world.equals(next.world)))
                eye.closeInventory();
            mirrorMerchant(eye, target);
            if (next.equals(previous)) continue;
            snapshot(eye, target);
            if (previous == null || !previous.target.equals(next.target) || !previous.world.equals(next.world)) {
                Bukkit.getScheduler().runTask(plugin, () -> {
                    if (!CortiEyeMirrorPlugin.isAttached(target, eye)
                            || target.getOpenInventory().getType() == org.bukkit.event.inventory.InventoryType.CRAFTING) return;
                    if (Bukkit.getPluginManager().getPlugin("SpectatorPlus") instanceof com.hpfxd.spectatorplus.paper.SpectatorPlugin spectator)
                        spectator.getSyncController().getScreenSyncHandler().onPlayerOpenInventory(target);
                });
            }
        }
    }
    private void mirrorMerchant(Player eye, Player target) {
        UUID id = eye.getUniqueId(); Replica previous = merchants.get(id);
        var source = ((CraftPlayer) target).getHandle().containerMenu;
        if (!(target.getOpenInventory().getTopInventory() instanceof MerchantInventory inventory)) {
            merchants.remove(id);
            if (previous != null && eye.getOpenInventory().getTopInventory() == previous.inventory) eye.closeInventory();
            return;
        }
        if (previous == null || !previous.target.equals(target.getUniqueId()) || previous.sourceId != source.containerId) {
            Merchant merchant = Bukkit.createMerchant(target.getOpenInventory().getTitle());
            openingMerchants.add(id);
            try { eye.openMerchant(merchant, true); } finally { openingMerchants.remove(id); }
            previous = new Replica(target.getUniqueId(), source.containerId, eye.getOpenInventory().getTopInventory());
            merchants.put(id, previous);
        }
        // Closing the observer's replica manually does not reopen it until the subject opens a new window.
        if (eye.getOpenInventory().getTopInventory() != previous.inventory) return;
        var replica = ((CraftPlayer) eye).getHandle().containerMenu;
        if (replica.getItems().size() != source.getItems().size()) return;
        if (source instanceof net.minecraft.world.inventory.MerchantMenu menu)
            send(eye, PacketType.Play.Server.OPEN_WINDOW_MERCHANT, new ClientboundMerchantOffersPacket(
                    replica.containerId, menu.getOffers(), menu.getTraderLevel(), menu.getTraderXp(), menu.showProgressBar(), menu.canRestock()));
        send(eye, PacketType.Play.Server.WINDOW_ITEMS, new ClientboundContainerSetContentPacket(
                replica.containerId, replica.getStateId(), source.getItems(), source.getCarried()));
    }
    private boolean replica(Player player) {
        Replica replica = merchants.get(player.getUniqueId());
        return replica != null && player.getOpenInventory().getTopInventory() == replica.inventory;
    }
    @EventHandler(priority = EventPriority.HIGHEST)
    public void click(InventoryClickEvent event) {
        if (event.getWhoClicked() instanceof Player player && replica(player)) event.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.HIGHEST)
    public void drag(InventoryDragEvent event) {
        if (event.getWhoClicked() instanceof Player player && replica(player)) event.setCancelled(true);
    }
    @EventHandler public void quit(PlayerQuitEvent event) { merchants.remove(event.getPlayer().getUniqueId()); }
    private void send(Player eye, PacketType type, Object packet) {
        protocol.sendServerPacket(eye, new PacketContainer(type, packet), false);
    }
    private void snapshot(Player eye, Player target) {
        var handle = ((CraftPlayer) target).getHandle();
        send(eye, PacketType.Play.Server.WINDOW_ITEMS, new ClientboundContainerSetContentPacket(
                0, handle.inventoryMenu.getStateId(), handle.inventoryMenu.getItems(), handle.inventoryMenu.getCarried()));
        send(eye, PacketType.Play.Server.HELD_ITEM_SLOT,
                new ClientboundSetCarriedItemPacket(target.getInventory().getHeldItemSlot()));
        send(eye, PacketType.Play.Server.UPDATE_HEALTH,
                new ClientboundSetHealthPacket((float) target.getHealth(), target.getFoodLevel(), target.getSaturation()));
        send(eye, PacketType.Play.Server.EXPERIENCE,
                new ClientboundSetExperiencePacket(target.getExp(), target.getTotalExperience(), target.getLevel()));
        List<Pair<EquipmentSlot, ItemStack>> equipment = new ArrayList<>();
        for (EquipmentSlot slot : EquipmentSlot.values())
            if (slot != EquipmentSlot.BODY) equipment.add(Pair.of(slot, handle.getItemBySlot(slot).copy()));
        send(eye, PacketType.Play.Server.ENTITY_EQUIPMENT,
                new ClientboundSetEquipmentPacket(eye.getEntityId(), equipment));
    }
    void stop() {
        attached = Set.of();
        for (UUID id : states.keySet()) { Player eye = Bukkit.getPlayer(id); if (eye != null) snapshot(eye, eye); }
        states.clear();
        merchants.clear();
    }
}
