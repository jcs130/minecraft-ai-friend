package org.afuhome.agentfriend;

import com.comphenix.protocol.PacketType;
import com.comphenix.protocol.ProtocolLibrary;
import com.comphenix.protocol.events.ListenerPriority;
import com.comphenix.protocol.events.PacketAdapter;
import com.comphenix.protocol.events.PacketEvent;
import com.comphenix.protocol.wrappers.WrappedChatComponent;
import java.lang.reflect.Method;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.text.serializer.gson.GsonComponentSerializer;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.plugin.Plugin;

/** Observe NPCSpeak's actual delivery, without changing its backend, commands or JAR. */
final class NpcBubbleBridge {
    private static final Set<String> DELIVERIES = Set.of("sendResponse", "sendGreeting");
    private final AgentFriendPlugin plugin;
    private final TextBubbleManager bubbles;
    private PacketAdapter listener;
    private long failures;
    NpcBubbleBridge(AgentFriendPlugin plugin, TextBubbleManager bubbles) {
        this.plugin = plugin; this.bubbles = bubbles;
        Plugin dependency = Bukkit.getPluginManager().getPlugin("NPCSpeak");
        if (dependency == null || !dependency.isEnabled()) return;
        try {
            // This integration is intentionally pinned to the installed, inspected formatter contract.
            if (!dependency.getDescription().getVersion().equals("1.0")) throw new IllegalStateException("unsupported NPCSpeak version");
            ClassLoader loader = dependency.getClass().getClassLoader();
            Class<?> formatter = Class.forName("com.l299l.npcspeak.npc.NpcFormatter", false, loader);
            Class<?> conversation = Class.forName("com.l299l.npcspeak.conversation.ConversationManager", false, loader);
            Object manager = dependency.getClass().getMethod("getNpcManager").invoke(dependency);
            Method getNpc = manager.getClass().getMethod("getById", String.class);
            Class<?> data = Class.forName("com.l299l.npcspeak.npc.NpcData", false, loader);
            Method name = data.getMethod("getDisplayName"), uuid = data.getMethod("getEntityUUID");
            StackWalker walker = StackWalker.getInstance(StackWalker.Option.RETAIN_CLASS_REFERENCE);
            listener = new PacketAdapter(plugin, ListenerPriority.MONITOR, PacketType.Play.Server.SYSTEM_CHAT) {
                @Override public void onPacketSending(PacketEvent event) {
                    if (event.isCancelled() || !Bukkit.isPrimaryThread() || !dependency.isEnabled() || !bubbles.wantsNpcs()) return;
                    // Verify the real plugin delivery call site. Matching a chat prefix alone is insufficient.
                    boolean actualDelivery = walker.walk(frames -> {
                        var stack = frames.limit(64).toList();
                        return stack.stream().anyMatch(f -> f.getDeclaringClass() == formatter
                                && DELIVERIES.contains(f.getMethodName()))
                                && stack.stream().anyMatch(f -> f.getDeclaringClass() == conversation);
                    });
                    if (!actualDelivery) return;
                    try {
                        if (Boolean.TRUE.equals(event.getPacket().getBooleans().readSafely(0))) return;
                        WrappedChatComponent wrapped = event.getPacket().getChatComponents().readSafely(0);
                        if (wrapped == null || wrapped.getJson().length() > 16_384) return;
                        String plain = PlainTextComponentSerializer.plainText().serialize(
                                GsonComponentSerializer.gson().deserialize(wrapped.getJson()));
                        Object matched = null; String body = null; String id = null;
                        for (String candidate : bubbles.npcSpeakers()) {
                            if (!bubbles.npcEnabled(candidate)) continue;
                            Object npc = getNpc.invoke(manager, candidate); if (npc == null) continue;
                            String prefix = "[" + name.invoke(npc) + "]";
                            if (!plain.startsWith(prefix)) continue;
                            if (matched != null) return; // Ambiguous display names fail closed.
                            matched = npc; body = plain.substring(prefix.length()); id = candidate;
                        }
                        if (matched == null) return;
                        UUID entityId = (UUID) uuid.invoke(matched);
                        Entity entity = entityId == null ? null : Bukkit.getEntity(entityId);
                        if (entity instanceof LivingEntity living) bubbles.npc(id, living, event.getPlayer(), body);
                    } catch (ReflectiveOperationException | RuntimeException e) {
                        if (++failures <= 3) plugin.getLogger().warning("NPC bubble delivery skipped: " + e.getClass().getSimpleName());
                    }
                }
            };
            ProtocolLibrary.getProtocolManager().addPacketListener(listener);
        } catch (ReflectiveOperationException | RuntimeException e) {
            listener = null;
            plugin.getLogger().warning("NPCSpeak bubbles unavailable: " + e.getClass().getSimpleName());
        }
    }
    boolean ready() { return listener != null; }
    void stop() { if (listener != null) ProtocolLibrary.getProtocolManager().removePacketListener(listener); listener = null; }
}
