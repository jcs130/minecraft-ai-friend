package org.afuhome.agentfriend;

import com.comphenix.protocol.PacketType;
import com.comphenix.protocol.ProtocolLibrary;
import com.comphenix.protocol.events.*;
import com.comphenix.protocol.wrappers.WrappedChatComponent;
import com.google.gson.*;
import java.lang.reflect.RecordComponent;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import org.bukkit.Bukkit;
import org.bukkit.event.*;
import org.bukkit.event.player.*;

/** Strip rank/team decorations from native /msg names, preserving the native
 * chat type, content, recipient, UUID and signed-message fields. No rebroadcast. */
final class PrivateChatNames implements Listener {
    private final Map<UUID, String> names = new ConcurrentHashMap<>();
    private final PacketAdapter packets;
    PrivateChatNames(AgentFriendPlugin plugin) {
        Bukkit.getOnlinePlayers().forEach(p -> names.put(p.getUniqueId(), p.getName()));
        Bukkit.getPluginManager().registerEvents(this, plugin);
        AtomicBoolean warned = new AtomicBoolean();
        // Eye mirroring runs at HIGHEST, after this recipient-local rewrite.
        packets = new PacketAdapter(plugin, ListenerPriority.HIGH,
                PacketType.Play.Server.DISGUISED_CHAT, PacketType.Play.Server.CHAT) {
            @Override public void onPacketSending(PacketEvent event) {
                if (event.isCancelled()) return;
                try {
                    Object original = event.getPacket().getHandle(), result = rewritePacket(original);
                    if (result != original) event.setPacket(PacketContainer.fromPacket(result));
                } catch (ReflectiveOperationException | RuntimeException error) {
                    if (warned.compareAndSet(false, true)) plugin.getLogger().warning(
                            "Private chat name normalization unavailable; original private delivery preserved: " + error.getClass().getSimpleName());
                }
            }
        };
        ProtocolLibrary.getProtocolManager().addPacketListener(packets);
    }
    @EventHandler(priority = EventPriority.MONITOR) public void joined(PlayerJoinEvent e) { names.put(e.getPlayer().getUniqueId(), e.getPlayer().getName()); }
    @EventHandler(priority = EventPriority.MONITOR) public void left(PlayerQuitEvent e) { names.remove(e.getPlayer().getUniqueId()); }
    void stop() { ProtocolLibrary.getProtocolManager().removePacketListener(packets); HandlerList.unregisterAll(this); names.clear(); }

    private Object rewritePacket(Object packet) throws ReflectiveOperationException {
        RecordComponent[] fields = packet.getClass().getRecordComponents();
        if (fields == null) return packet;
        Object[] values = new Object[fields.length]; boolean changed = false;
        for (int i = 0; i < fields.length; i++) {
            Object value = fields[i].getAccessor().invoke(packet);
            if (fields[i].getType().getName().endsWith("ChatType$Bound")) {
                Object normalized = rewriteBound(value); changed |= normalized != value; value = normalized;
            }
            values[i] = value;
        }
        return changed ? copyRecord(packet, fields, values) : packet;
    }
    private Object rewriteBound(Object bound) throws ReflectiveOperationException {
        Object holder = bound.getClass().getMethod("chatType").invoke(bound);
        Optional<?> key = (Optional<?>) holder.getClass().getMethod("unwrapKey").invoke(holder);
        if (key.isEmpty()) return bound;
        Object resource = key.get(); String type = resource.getClass().getMethod("location").invoke(resource).toString();
        if (!Set.of("minecraft:msg_command_incoming", "minecraft:msg_command_outgoing").contains(type)) return bound;
        RecordComponent[] fields = bound.getClass().getRecordComponents();
        Object[] values = new Object[fields.length]; boolean changed = false;
        for (int i = 0; i < fields.length; i++) {
            Object value = fields[i].getAccessor().invoke(bound), result = value;
            if (fields[i].getName().equals("name")) result = normalize(value);
            else if (fields[i].getName().equals("targetName") && value instanceof Optional<?> target && target.isPresent()) {
                Object clean = normalize(target.get()); if (clean != target.get()) result = Optional.of(clean);
            }
            changed |= result != value; values[i] = result;
        }
        return changed ? copyRecord(bound, fields, values) : bound;
    }
    private Object normalize(Object component) {
        JsonElement original = JsonParser.parseString(WrappedChatComponent.fromHandle(component).getJson());
        JsonElement clean = PrivateChatIdentity.normalize(original, names);
        return clean == original ? component : WrappedChatComponent.fromJson(clean.toString()).getHandle();
    }
    private static Object copyRecord(Object source, RecordComponent[] fields, Object[] values) throws ReflectiveOperationException {
        Class<?>[] types = Arrays.stream(fields).map(RecordComponent::getType).toArray(Class<?>[]::new);
        return source.getClass().getDeclaredConstructor(types).newInstance(values);
    }
}
