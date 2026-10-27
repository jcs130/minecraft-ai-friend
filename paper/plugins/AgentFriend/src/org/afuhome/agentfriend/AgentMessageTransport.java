package org.afuhome.agentfriend;

import com.comphenix.protocol.*;
import com.comphenix.protocol.events.*;
import com.comphenix.protocol.wrappers.WrappedChatComponent;
import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import net.kyori.adventure.text.serializer.gson.GsonComponentSerializer;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.*;
import org.bukkit.event.server.PluginDisableEvent;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.messaging.PluginMessageListener;

/** Recipient-local opt-in transport. Client payloads can select presentation
 * only: they never authenticate, invoke commands, or read another player's data.
 * Unmodified Mineflayer retains private MC_* chat receipts. Native whispers and
 * combat/death/join messages are never intercepted. */
final class AgentMessageTransport implements Listener, PluginMessageListener {
    private final AgentFriendPlugin plugin;
    private final Set<UUID> payload = ConcurrentHashMap.newKeySet();
    private final Map<UUID, Long> joined = new ConcurrentHashMap<>(), manual = new ConcurrentHashMap<>();
    private final NamespacedKey summarySeen, agentSession, reconnectReady, cliHint;
    private final Map<UUID,long[]> cliWindows = new HashMap<>();
    private final ActivityBarLimiter activityBars=new ActivityBarLimiter();
    private final PacketAdapter packets;
    AgentMessageTransport(AgentFriendPlugin plugin) {
        this.plugin = plugin; summarySeen = new NamespacedKey(plugin, "entry_summary_seen_v1");
        agentSession = new NamespacedKey(plugin, "automation_session");
        reconnectReady = new NamespacedKey(plugin, "automation_reconnect");
        cliHint = new NamespacedKey(plugin, "cli_activity_hint");
        var messenger = Bukkit.getMessenger();
        messenger.registerOutgoingPluginChannel(plugin, AgentMessagePolicy.CHANNEL);
        messenger.registerIncomingPluginChannel(plugin, AgentMessagePolicy.CHANNEL, this);
        Bukkit.getPluginManager().registerEvents(this, plugin);
        packets = new PacketAdapter(plugin, ListenerPriority.HIGH, PacketType.Play.Server.SYSTEM_CHAT, PacketType.Play.Server.BOSS) {
            @Override public void onPacketSending(PacketEvent event) {
                if (event.isCancelled() || event.isPlayerTemporary() || event.getPlayer() == null) return;
                if(event.getPacketType()==PacketType.Play.Server.BOSS){activityBars.filter(event);return;}
                // Action bars, danger notices and normal native chat remain untouched.
                if (Boolean.TRUE.equals(event.getPacket().getBooleans().readSafely(0))) return;
                WrappedChatComponent component = event.getPacket().getChatComponents().readSafely(0);
                if (component == null) return;
                String text = PlainTextComponentSerializer.plainText().serialize(
                        GsonComponentSerializer.gson().deserialize(component.getJson()));
                Player p = event.getPlayer(); UUID id = p.getUniqueId(); long now = System.currentTimeMillis();
                if (now - joined.getOrDefault(id, 0L) < 10_000 && now > manual.getOrDefault(id, 0L)
                        && AgentMessagePolicy.joinTip(text)) { event.setCancelled(true); return; }
                boolean agent = AgentMessagePolicy.agent(p.getName());
                if (agent && AgentMessagePolicy.launcherWarning(component.getJson())) { event.setCancelled(true); return; }
                JsonObject frame = agent ? AgentMessagePolicy.receipt(text) : null;
                if (frame == null) return;
                byte[] bytes = frame.toString().getBytes(StandardCharsets.UTF_8);
                if (payload.contains(id) && bytes.length <= AgentMessagePolicy.MAX_BYTES) {
                    event.setCancelled(true);
                    // ProtocolLib may call on a Netty thread. Bukkit sends only on the main thread.
                    Runnable send = () -> { if (p.isOnline() && payload.contains(id)) p.sendPluginMessage(plugin, AgentMessagePolicy.CHANNEL, bytes); };
                    if (Bukkit.isPrimaryThread()) send.run(); else Bukkit.getScheduler().runTask(plugin, send);
                } else if (now > manual.getOrDefault(id, 0L)) {
                    String compact = AgentMessagePolicy.compact(text);
                    if (!compact.equals(text)) {
                        PacketContainer copy = event.getPacket().shallowClone();
                        copy.getChatComponents().write(0, WrappedChatComponent.fromText(compact)); event.setPacket(copy);
                    }
                }
            }
        };
        ProtocolLibrary.getProtocolManager().addPacketListener(packets);
    }
    void joined(Player p) {
        clearIdentity(p); // Saved evidence from an old connection is never reused.
        joined.put(p.getUniqueId(), System.currentTimeMillis());
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (!p.isOnline() || plugin.isObserver(p) || plugin.communication().compact(p)
                    || p.getPersistentDataContainer().has(summarySeen, PersistentDataType.BYTE)) return;
            p.sendMessage("§b[提示] 新手说明与玩法按需查看。命令：/mycli --help");
            p.getPersistentDataContainer().set(summarySeen, PersistentDataType.BYTE, (byte) 1);
        }, 50L);
    }
    private void clearIdentity(Player p) {
        var data=p.getPersistentDataContainer();data.remove(agentSession);data.remove(reconnectReady);data.remove(cliHint);
        cliWindows.remove(p.getUniqueId());
    }
    void forget(Player p) { UUID id = p.getUniqueId(); payload.remove(id); joined.remove(id); manual.remove(id); activityBars.forget(id);clearIdentity(p); }
    @Override public void onPluginMessageReceived(String channel, Player p, byte[] data) {
        if (!channel.equals(AgentMessagePolicy.CHANNEL) || !p.getListeningPluginChannels().contains(channel)) return;
        Boolean reconnect=AgentMessagePolicy.identity(data);
        if(reconnect!=null){
            p.getPersistentDataContainer().set(agentSession,PersistentDataType.INTEGER,p.getEntityId());
            p.getPersistentDataContainer().set(reconnectReady,PersistentDataType.BYTE,(byte)(reconnect?1:0));
            p.sendPluginMessage(plugin,channel,("{\"protocol\":1,\"type\":\"identity_ack\",\"reconnect\":"+reconnect+"}").getBytes(StandardCharsets.UTF_8));
            return; // Identity does not silently switch chat receipts to custom payloads.
        }
        if(!AgentMessagePolicy.hello(data))return;
        payload.add(p.getUniqueId());
        p.sendPluginMessage(plugin, channel, "{\"protocol\":1,\"type\":\"hello_ack\",\"transport\":\"payload\"}".getBytes(StandardCharsets.UTF_8));
    }
    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void command(PlayerCommandPreprocessEvent e) {
        String command = e.getMessage().toLowerCase(Locale.ROOT);
        if (command.matches("^/(?:agentfriend:)?mycli(?: .*)?$") || command.startsWith("/photohelp")) {
            long now=System.currentTimeMillis();
            long[] window=cliWindows.computeIfAbsent(e.getPlayer().getUniqueId(),id->new long[]{now,0});
            if(now-window[0]>60000){window[0]=now;window[1]=0;}
            if(++window[1]>=8)e.getPlayer().getPersistentDataContainer().set(cliHint,PersistentDataType.STRING,"frequent_cli");
            // The hint is advisory only, never authentication or restart permission.
            // Preserve full metadata only when the user explicitly asks for JSON.
            if (command.matches(".*(?:^| )--json(?: |$).*")) manual.put(e.getPlayer().getUniqueId(), System.currentTimeMillis() + 3000);
        }
    }
    @EventHandler public void disabled(PluginDisableEvent e) {
        if (e.getPlugin() != plugin) return;
        ProtocolLibrary.getProtocolManager().removePacketListener(packets);
        Bukkit.getMessenger().unregisterIncomingPluginChannel(plugin, AgentMessagePolicy.CHANNEL, this);
        Bukkit.getMessenger().unregisterOutgoingPluginChannel(plugin, AgentMessagePolicy.CHANNEL);
        Bukkit.getOnlinePlayers().forEach(this::clearIdentity);
        HandlerList.unregisterAll(this); payload.clear(); joined.clear(); manual.clear(); activityBars.clear();
    }
}
