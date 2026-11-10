package org.afuhome.cortieye;

import com.destroystokyo.paper.event.player.PlayerStartSpectatingEntityEvent;
import com.hpfxd.spectatorplus.paper.SpectatorPlugin;
import com.hpfxd.spectatorplus.paper.sync.ClientboundSyncPacket;
import com.hpfxd.spectatorplus.paper.sync.packet.*;
import java.nio.ByteBuffer;
import java.util.*;
import java.util.function.Supplier;
import org.afuhome.eye.EyePairs;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.*;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.messaging.PluginMessageListener;

/** A one-shot baseline after attachment/channel readiness, without changing the camera target. */
final class EyeHudBaseline implements Listener, PluginMessageListener {
    private static final String REQUEST = ServerboundRequestInventoryOpenPacket.ID.asString();
    private static final Set<String> CHANNELS = Set.of(ClientboundHotbarSyncPacket.ID.asString(),
            ClientboundSelectedSlotSyncPacket.ID.asString(), ClientboundFoodSyncPacket.ID.asString(),
            ClientboundExperienceSyncPacket.ID.asString());
    private final CortiEyeMirrorPlugin plugin;
    private final Supplier<List<EyePairs.Pair>> bindings;
    private final Map<UUID, Pending> pending = new HashMap<>();
    private final Map<UUID, Delivery> deliveries = new HashMap<>();
    private boolean stopped;

    private static final class Pending {
        final Player receiver;
        UUID expectedTarget;
        boolean refresh;
        Pending(Player receiver, UUID expectedTarget, boolean refresh) {
            this.receiver = receiver; this.expectedTarget = expectedTarget; this.refresh = refresh;
        }
    }
    private static final class Delivery {
        final Player receiver;
        final UUID target, world;
        final int entityId;
        final Set<String> initialized = new HashSet<>();
        Delivery(Player receiver, Player target) {
            this.receiver = receiver; this.target = target.getUniqueId();
            this.world = target.getWorld().getUID(); this.entityId = target.getEntityId();
        }
        boolean matches(Player receiver, Player target) {
            return this.receiver == receiver && this.target.equals(target.getUniqueId())
                    && world.equals(target.getWorld().getUID()) && entityId == target.getEntityId();
        }
    }

    EyeHudBaseline(CortiEyeMirrorPlugin plugin, Supplier<List<EyePairs.Pair>> bindings) {
        this.plugin = plugin; this.bindings = bindings;
        Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getMessenger().registerIncomingPluginChannel(plugin, REQUEST, this);
    }

    void subjectChanged(Player receiver, Player target) {
        queue(receiver, target.getUniqueId(), false);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void attached(PlayerStartSpectatingEntityEvent event) {
        if (event.getNewSpectatorTarget() instanceof Player target) {
            // Our hard dependency's 1.2.1 MONITOR handlers have already sent each ready,
            // permitted channel for this event. Remember those to avoid a second baseline.
            Delivery delivery = new Delivery(event.getPlayer(), target);
            Set<String> ready = event.getPlayer().getListeningPluginChannels();
            for (String channel : CHANNELS)
                if (ready.contains(channel) && event.getPlayer().hasPermission(permission(channel)))
                    delivery.initialized.add(channel);
            deliveries.put(event.getPlayer().getUniqueId(), delivery);
            queue(event.getPlayer(), target.getUniqueId(), false);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void registered(PlayerRegisterChannelEvent event) {
        if (CHANNELS.contains(event.getChannel())) queue(event.getPlayer(), null, false);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void unregistered(PlayerUnregisterChannelEvent event) {
        Delivery delivery = deliveries.get(event.getPlayer().getUniqueId());
        if (delivery != null && delivery.receiver == event.getPlayer())
            delivery.initialized.remove(event.getChannel());
    }

    @Override public void onPluginMessageReceived(String channel, Player receiver, byte[] message) {
        if (!REQUEST.equals(channel) || message.length != 16
                || !receiver.hasPermission("spectatorplus.sync.inventory")) return;
        ByteBuffer input = ByteBuffer.wrap(message);
        UUID requested = new UUID(input.getLong(), input.getLong());
        if (!(receiver.getSpectatorTarget() instanceof Player target)
                || !requested.equals(target.getUniqueId())) return;
        queue(receiver, requested, true);
    }

    private void queue(Player receiver, UUID expectedTarget, boolean refresh) {
        if (stopped || !receiver.isOnline()) return;
        UUID id = receiver.getUniqueId();
        Pending previous = pending.get(id);
        if (previous != null && previous.receiver == receiver && (expectedTarget == null
                || previous.expectedTarget == null || previous.expectedTarget.equals(expectedTarget))) {
            if (expectedTarget != null) previous.expectedTarget = expectedTarget;
            previous.refresh |= refresh;
            return;
        }
        Pending request = new Pending(receiver, expectedTarget, refresh);
        pending.put(id, request);
        // The spectating event precedes setCamera's assignment; REGISTER may contain several channels.
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (pending.remove(id, request)) flush(request);
        });
    }

    private boolean authorized(Player receiver, Player target) {
        return receiver.isOnline() && target.isOnline()
                && Bukkit.getPlayer(receiver.getUniqueId()) == receiver
                && Bukkit.getPlayer(target.getUniqueId()) == target
                && CortiEyeMirrorPlugin.isAttached(target, receiver)
                && bindings.get().stream().anyMatch(pair -> pair.eye().equalsIgnoreCase(receiver.getName())
                        && pair.agent().equalsIgnoreCase(target.getName()));
    }

    private void flush(Pending request) {
        Player receiver = request.receiver;
        if (stopped || !(receiver.getSpectatorTarget() instanceof Player target)
                || request.expectedTarget != null && !request.expectedTarget.equals(target.getUniqueId())
                || !authorized(receiver, target)) {
            deliveries.remove(receiver.getUniqueId());
            return;
        }
        if (!(Bukkit.getPluginManager().getPlugin("SpectatorPlus") instanceof SpectatorPlugin spectator)
                || !spectator.isEnabled()) return;
        Delivery delivery = deliveries.get(receiver.getUniqueId());
        if (delivery == null || !delivery.matches(receiver, target)) {
            delivery = new Delivery(receiver, target);
            deliveries.put(receiver.getUniqueId(), delivery);
        }
        Set<String> ready = receiver.getListeningPluginChannels();
        if (needed(delivery, ready, ClientboundHotbarSyncPacket.ID.asString(),
                receiver.hasPermission("spectatorplus.sync.hotbar"), request.refresh)) {
            ItemStack[] slots = new ItemStack[ClientboundHotbarSyncPacket.ITEMS_LENGTH];
            for (int i = 0; i < slots.length; i++) {
                ItemStack item = target.getInventory().getItem(i);
                slots[i] = item == null ? ItemStack.empty() : item.clone();
            }
            send(spectator, receiver, delivery, new ClientboundHotbarSyncPacket(target.getUniqueId(), slots));
        }
        if (needed(delivery, ready, ClientboundSelectedSlotSyncPacket.ID.asString(),
                receiver.hasPermission("spectatorplus.sync.hotbar"), request.refresh))
            send(spectator, receiver, delivery, new ClientboundSelectedSlotSyncPacket(
                    target.getUniqueId(), target.getInventory().getHeldItemSlot()));
        if (needed(delivery, ready, ClientboundFoodSyncPacket.ID.asString(),
                receiver.hasPermission("spectatorplus.sync.food"), request.refresh))
            send(spectator, receiver, delivery, new ClientboundFoodSyncPacket(
                    target.getUniqueId(), target.getFoodLevel(), target.getSaturation()));
        if (needed(delivery, ready, ClientboundExperienceSyncPacket.ID.asString(),
                receiver.hasPermission("spectatorplus.sync.experience"), request.refresh))
            send(spectator, receiver, delivery, new ClientboundExperienceSyncPacket(target.getUniqueId(),
                    target.getExp(), target.getExperiencePointsNeededForNextLevel(), target.getLevel()));
    }

    private static boolean needed(Delivery delivery, Set<String> ready, String channel, boolean allowed, boolean refresh) {
        return allowed && ready.contains(channel) && (refresh || !delivery.initialized.contains(channel));
    }
    private static String permission(String channel) {
        return channel.equals(ClientboundFoodSyncPacket.ID.asString()) ? "spectatorplus.sync.food"
                : channel.equals(ClientboundExperienceSyncPacket.ID.asString()) ? "spectatorplus.sync.experience"
                : "spectatorplus.sync.hotbar";
    }
    private static void send(SpectatorPlugin spectator, Player receiver, Delivery delivery, ClientboundSyncPacket packet) {
        spectator.getSyncController().sendPacket(receiver, packet);
        delivery.initialized.add(packet.channel().asString());
    }

    @EventHandler public void quit(PlayerQuitEvent event) {
        Player receiver = event.getPlayer();
        Pending request = pending.get(receiver.getUniqueId());
        if (request != null && request.receiver == receiver) pending.remove(receiver.getUniqueId());
        Delivery delivery = deliveries.get(receiver.getUniqueId());
        if (delivery != null && delivery.receiver == receiver) deliveries.remove(receiver.getUniqueId());
    }

    void stop() {
        stopped = true; pending.clear(); deliveries.clear();
        HandlerList.unregisterAll(this);
        Bukkit.getMessenger().unregisterIncomingPluginChannel(plugin, REQUEST, this);
    }
}
