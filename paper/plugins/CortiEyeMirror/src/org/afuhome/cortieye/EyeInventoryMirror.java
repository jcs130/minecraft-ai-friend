package org.afuhome.cortieye;

import com.comphenix.protocol.*;
import com.comphenix.protocol.events.*;
import com.mojang.datafixers.util.Pair;
import java.util.*;
import net.minecraft.network.protocol.game.*;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.MenuType;
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
    private record State(UUID target, int entityId, UUID world, int inventorySignature, int vitalsSignature) {}
    private final ProtocolManager protocol;
    private final CortiEyeMirrorPlugin plugin;
    private final Map<UUID, State> states = new HashMap<>();
    private record Replica(UUID target, int sourceId, Inventory inventory, int stateId, int offersSignature) {}
    private final Map<UUID, Replica> merchants = new HashMap<>();
    private record StashReplica(UUID target, AbstractContainerMenu source, Inventory inventory, int stateId, int contentsSignature) {}
    private final Map<UUID, StashReplica> stashes = new HashMap<>();
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
                if (event.isCancelled() || event.isPlayerTemporary() || event.getPlayer() == null) return;
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
            states.remove(id); merchants.remove(id); stashes.remove(id); Player eye = Bukkit.getPlayer(id);
            if (eye != null) { eye.closeInventory(); snapshot(eye, eye); }
        }
        for (var entry : subjects.entrySet()) {
            Player eye = Bukkit.getPlayer(entry.getKey()), target = entry.getValue();
            var handle = ((CraftPlayer) target).getHandle();
            int inventorySignature = Objects.hash(Arrays.hashCode(target.getInventory().getContents()), target.getInventory().getHeldItemSlot());
            int vitalsSignature = Objects.hash(target.getHealth(), target.getFoodLevel(), target.getSaturation(), target.getExp(),
                    target.getTotalExperience(), target.getLevel());
            State next = new State(target.getUniqueId(), target.getEntityId(), target.getWorld().getUID(), inventorySignature, vitalsSignature);
            State previous = states.put(entry.getKey(), next);
            if (previous != null && (!previous.target.equals(next.target) || !previous.world.equals(next.world)))
                eye.closeInventory();
            mirrorStash(eye, target);
            mirrorMerchant(eye, target);
            if (next.equals(previous)) continue;
            boolean changedSubject = previous == null || !previous.target.equals(next.target) || !previous.world.equals(next.world)
                    || previous.entityId != next.entityId;
            snapshot(eye, target, changedSubject || previous.inventorySignature != next.inventorySignature,
                    changedSubject || previous.vitalsSignature != next.vitalsSignature);
            if (previous == null || !previous.target.equals(next.target) || !previous.world.equals(next.world)) {
                Bukkit.getScheduler().runTask(plugin, () -> {
                    if (!CortiEyeMirrorPlugin.isAttached(target, eye)
                            || target.getOpenInventory().getType() == org.bukkit.event.inventory.InventoryType.CRAFTING
                            || stashes.containsKey(eye.getUniqueId())) return;
                    if (Bukkit.getPluginManager().getPlugin("SpectatorPlus") instanceof com.hpfxd.spectatorplus.paper.SpectatorPlugin spectator)
                        spectator.getSyncController().getScreenSyncHandler().onPlayerOpenInventory(target);
                });
            }
        }
    }
    private void mirrorStash(Player eye, Player target) {
        UUID id = eye.getUniqueId();
        var targetHandle = ((CraftPlayer) target).getHandle();
        AbstractContainerMenu source = targetHandle.containerMenu;
        StashReplica previous = stashes.get(id);
        if (previous == null || !previous.target().equals(target.getUniqueId()) || previous.source() != source) {
            closeStash(eye);
            if (source == targetHandle.inventoryMenu || source.containerId <= 0 || source.slots.size() != 90 || !personalStash(target)) return;
            if (source.getType() != MenuType.GENERIC_9x6) return;
            if (Bukkit.getPluginManager().getPlugin("SpectatorPlus") instanceof com.hpfxd.spectatorplus.paper.SpectatorPlugin spectator
                    && spectator.getSyncController().getScreenSyncHandler().isViewingSyncedScreen(eye)) return;
            Inventory inventory = Bukkit.createInventory(null, 54, target.getOpenInventory().getTitle());
            if (eye.openInventory(inventory) == null || eye.getOpenInventory().getTopInventory() != inventory) return;
            previous = new StashReplica(target.getUniqueId(), source, inventory, -1, 0);
            stashes.put(id, previous);
        }
        if (eye.getOpenInventory().getTopInventory() != previous.inventory()) return;
        var replica = ((CraftPlayer) eye).getHandle().containerMenu;
        var items = source.getItems();
        if (replica.slots.size() != items.size()) return;
        var targetView = target.getOpenInventory();
        int signature = Objects.hash(Arrays.hashCode(targetView.getTopInventory().getContents()),
                Arrays.hashCode(targetView.getBottomInventory().getContents()), targetView.getCursor());
        if (previous.stateId() == source.getStateId() && previous.contentsSignature() == signature) return;
        send(eye, PacketType.Play.Server.WINDOW_ITEMS, new ClientboundContainerSetContentPacket(
                replica.containerId, replica.getStateId(), items, source.getCarried()));
        stashes.put(id, new StashReplica(previous.target(), source, previous.inventory(), source.getStateId(), signature));
    }
    private boolean personalStash(Player target) {
        var agentFriend = Bukkit.getPluginManager().getPlugin("AgentFriend");
        if (agentFriend == null || !agentFriend.isEnabled()) return false;
        try { return (int) agentFriend.getClass().getMethod("nativeViewerStashPage", Player.class).invoke(agentFriend, target) > 0; }
        catch (ReflectiveOperationException unavailable) { return false; }
    }
    private void closeStash(Player eye) {
        var stash = stashes.remove(eye.getUniqueId());
        if (stash != null && eye.getOpenInventory().getTopInventory() == stash.inventory()) eye.closeInventory();
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
            previous = new Replica(target.getUniqueId(), source.containerId, eye.getOpenInventory().getTopInventory(), -1, 0);
            merchants.put(id, previous);
        }
        // Closing the observer's replica manually does not reopen it until the subject opens a new window.
        if (eye.getOpenInventory().getTopInventory() != previous.inventory) return;
        var replica = ((CraftPlayer) eye).getHandle().containerMenu;
        if (replica.getItems().size() != source.getItems().size()) return;
        int offersSignature = inventory.getMerchant().getRecipes().stream().mapToInt(r -> Objects.hash(r.getResult(),
                r.getIngredients(), r.getUses(), r.getMaxUses(), r.getSpecialPrice(), r.getDemand(), r.getPriceMultiplier()))
                .reduce(1, (a, b) -> 31 * a + b);
        if (source instanceof net.minecraft.world.inventory.MerchantMenu menu)
            offersSignature = Objects.hash(offersSignature, menu.getTraderLevel(), menu.getTraderXp(), menu.showProgressBar(), menu.canRestock());
        if (previous.stateId == -1 || offersSignature != previous.offersSignature) {
            if (source instanceof net.minecraft.world.inventory.MerchantMenu menu)
                send(eye, PacketType.Play.Server.OPEN_WINDOW_MERCHANT, new ClientboundMerchantOffersPacket(
                        replica.containerId, menu.getOffers(), menu.getTraderLevel(), menu.getTraderXp(), menu.showProgressBar(), menu.canRestock()));
        }
        if (previous.stateId != source.getStateId())
            send(eye, PacketType.Play.Server.WINDOW_ITEMS, new ClientboundContainerSetContentPacket(
                    replica.containerId, replica.getStateId(), source.getItems(), source.getCarried()));
        merchants.put(id, new Replica(previous.target, previous.sourceId, previous.inventory, source.getStateId(), offersSignature));
    }
    private boolean replica(Player player) {
        Replica replica = merchants.get(player.getUniqueId());
        return replica != null && player.getOpenInventory().getTopInventory() == replica.inventory;
    }
    private boolean readOnlyReplica(Player player) {
        StashReplica replica = stashes.get(player.getUniqueId());
        if (replica == null || player.getOpenInventory().getTopInventory() != replica.inventory()) return replica(player);
        // A rejected click can make vanilla resend the empty server-side placeholder.
        stashes.put(player.getUniqueId(), new StashReplica(replica.target(), replica.source(), replica.inventory(), -1, 0));
        return true;
    }
    @EventHandler(priority = EventPriority.HIGHEST)
    public void click(InventoryClickEvent event) {
        if (event.getWhoClicked() instanceof Player player && readOnlyReplica(player)) event.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.HIGHEST)
    public void drag(InventoryDragEvent event) {
        if (event.getWhoClicked() instanceof Player player && readOnlyReplica(player)) event.setCancelled(true);
    }
    @EventHandler public void quit(PlayerQuitEvent event) {
        merchants.remove(event.getPlayer().getUniqueId()); stashes.remove(event.getPlayer().getUniqueId());
    }
    private void send(Player eye, PacketType type, Object packet) {
        protocol.sendServerPacket(eye, new PacketContainer(type, packet), false);
    }
    private void snapshot(Player eye, Player target) {
        snapshot(eye, target, true, true);
    }
    private void snapshot(Player eye, Player target, boolean inventoryChanged, boolean vitalsChanged) {
        var handle = ((CraftPlayer) target).getHandle();
        if (inventoryChanged) {
        send(eye, PacketType.Play.Server.WINDOW_ITEMS, new ClientboundContainerSetContentPacket(
                0, handle.inventoryMenu.getStateId(), handle.inventoryMenu.getItems(), handle.inventoryMenu.getCarried()));
        send(eye, PacketType.Play.Server.HELD_ITEM_SLOT,
                new ClientboundSetCarriedItemPacket(target.getInventory().getHeldItemSlot()));
        List<Pair<EquipmentSlot, ItemStack>> equipment = new ArrayList<>();
        for (EquipmentSlot slot : EquipmentSlot.values())
            if (slot != EquipmentSlot.BODY) equipment.add(Pair.of(slot, handle.getItemBySlot(slot).copy()));
        send(eye, PacketType.Play.Server.ENTITY_EQUIPMENT,
                new ClientboundSetEquipmentPacket(eye.getEntityId(), equipment));
        }
        if (vitalsChanged) {
            send(eye, PacketType.Play.Server.UPDATE_HEALTH,
                    new ClientboundSetHealthPacket((float) target.getHealth(), target.getFoodLevel(), target.getSaturation()));
            send(eye, PacketType.Play.Server.EXPERIENCE,
                    new ClientboundSetExperiencePacket(target.getExp(), target.getTotalExperience(), target.getLevel()));
        }
    }
    void stop() {
        attached = Set.of();
        for (UUID id : states.keySet()) { Player eye = Bukkit.getPlayer(id); if (eye != null) { closeStash(eye); snapshot(eye, eye); } }
        states.clear();
        merchants.clear();
        stashes.clear();
    }
}
