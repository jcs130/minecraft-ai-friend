package org.afuhome.agentfriend;

import com.comphenix.protocol.PacketType;
import com.comphenix.protocol.ProtocolLibrary;
import com.comphenix.protocol.events.*;
import com.comphenix.protocol.wrappers.WrappedChatComponent;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import net.kyori.adventure.text.serializer.gson.GsonComponentSerializer;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;

/** Suppress only the pinned ImageFrame automatic-camera progress, never errors/manual uploads. */
final class PhotoCameraMessages {
    private record Lease(long expires, String name, java.util.function.Predicate<String> actualUpload) { }
    private final Map<UUID,Lease> leases = new ConcurrentHashMap<>();
    private final PacketAdapter listener;
    PhotoCameraMessages(AgentFriendPlugin plugin) {
        listener = new PacketAdapter(plugin, ListenerPriority.HIGH, PacketType.Play.Server.SYSTEM_CHAT) {
            @Override public void onPacketSending(PacketEvent event) {
                Lease lease=leases.get(event.getPlayer().getUniqueId());
                if (event.isCancelled() || lease==null || lease.expires < System.currentTimeMillis()) return;
                try {
                    WrappedChatComponent component = event.getPacket().getChatComponents().readSafely(0);
                    if (component == null || component.getJson().length() > 16_384) return;
                    String json = component.getJson();
                    String plain = PlainTextComponentSerializer.plainText().serialize(GsonComponentSerializer.gson().deserialize(json));
                    if (json.contains("imageframe.messages.image_map_processing") || json.contains("imageframe.messages.image_map_created")
                        || plain.equals("正在创建图片，请稍候！") || plain.equals("图片创建完成！")
                        || lease.actualUpload.test(plain)
                        || plain.equals("Creating image, please wait!") || plain.equals("Image created!")
                        || plain.equals("ImageMap is being processed, please wait!") || plain.equals("ImageMap has been created!")
                        || plain.equals("ImageMap " + lease.name + " is being processed")) event.setCancelled(true);
                } catch (RuntimeException ignored) { }
            }
        };
        ProtocolLibrary.getProtocolManager().addPacketListener(listener);
    }
    void begin(UUID owner,String name,java.util.function.Predicate<String> actualUpload) { leases.put(owner, new Lease(System.currentTimeMillis() + 95_000,name,actualUpload)); }
    void end(UUID owner) { leases.remove(owner); }
    void close() { ProtocolLibrary.getProtocolManager().removePacketListener(listener); leases.clear(); }
}
