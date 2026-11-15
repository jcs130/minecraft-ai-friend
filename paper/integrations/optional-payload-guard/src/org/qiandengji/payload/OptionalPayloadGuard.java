package org.qiandengji.payload;

import com.github.retrooper.packetevents.PacketEvents;
import com.github.retrooper.packetevents.event.*;
import com.github.retrooper.packetevents.protocol.packettype.PacketType;
import com.github.retrooper.packetevents.wrapper.play.client.WrapperPlayClientPluginMessage;
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerPluginMessage;
import com.github.retrooper.packetevents.wrapper.configuration.client.WrapperConfigClientPluginMessage;
import com.github.retrooper.packetevents.wrapper.configuration.server.WrapperConfigServerPluginMessage;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.PostOrder;
import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.api.event.connection.PluginMessageEvent;
import com.velocitypowered.api.event.proxy.*;
import com.velocitypowered.api.plugin.*;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.ServerConnection;
import com.velocitypowered.api.proxy.messages.MinecraftChannelIdentifier;
import com.google.inject.Inject;
import java.time.Duration;

/** Scope optional extension packets to their original connection's declared decoders. */
@Plugin(id="optionalpayloadguard",name="OptionalPayloadGuard",version="0.1.3",dependencies={@Dependency(id="packetevents")})
public final class OptionalPayloadGuard {
    private static final MinecraftChannelIdentifier YSM=MinecraftChannelIdentifier.from(YsmAcknowledgementHandoff.CHANNEL);
    private final ProxyServer server;
    private final OptionalPayloadPolicy policy=new OptionalPayloadPolicy();
    private final YsmAcknowledgementHandoff handoff=new YsmAcknowledgementHandoff();
    private PacketListenerAbstract listener;
    @Inject public OptionalPayloadGuard(ProxyServer server){this.server=server;}
    @Subscribe public void start(ProxyInitializeEvent event){
        server.getChannelRegistrar().register(YSM);
        listener=new PacketListenerAbstract(PacketListenerPriority.HIGHEST){
            @Override public void onPacketReceive(PacketReceiveEvent event){
                if(event.isCancelled()||event.getUser()==null)return;
                if(event.getPacketType()==PacketType.Play.Client.PLUGIN_MESSAGE){
                    var packet=new WrapperPlayClientPluginMessage(event);policy.registration(event.getUser(),packet.getChannelName(),packet.getData());
                }else if(event.getPacketType()==PacketType.Configuration.Client.PLUGIN_MESSAGE){
                    var packet=new WrapperConfigClientPluginMessage(event);policy.registration(event.getUser(),packet.getChannelName(),packet.getData());
                }
            }
            @Override public void onPacketSend(PacketSendEvent event){
                if(event.isCancelled()||event.getUser()==null)return;
                String channel;
                if(event.getPacketType()==PacketType.Play.Server.PLUGIN_MESSAGE)channel=new WrapperPlayServerPluginMessage(event).getChannelName();
                else if(event.getPacketType()==PacketType.Configuration.Server.PLUGIN_MESSAGE)channel=new WrapperConfigServerPluginMessage(event).getChannelName();
                else return;
                if(!policy.allowed(event.getUser(),channel))event.setCancelled(true);
            }
            @Override public void onUserDisconnect(UserDisconnectEvent event){policy.left(event.getUser());}
        };
        PacketEvents.getAPI().getEventManager().registerListener(listener);
    }
    @Subscribe(order=PostOrder.LAST)
    public void ysmMessage(PluginMessageEvent event) {
        if (!YSM.equals(event.getIdentifier()) || !event.getResult().isAllowed()) return;
        if (event.getSource() instanceof Player player && event.getTarget() instanceof ServerConnection backend && backend.getPlayer() == player) {
            if (registered(backend, "auth")) event.setResult(PluginMessageEvent.ForwardResult.handled());
            else if (currentGame(player, backend)) handoff.received(player, backend, event.getData());
        } else if (event.getSource() instanceof ServerConnection backend && event.getTarget() instanceof Player player && backend.getPlayer() == player) {
            // YSM acknowledges only the first greeting on the physical client connection.
            // The authentication lobby leaves that handshake to the game server.
            if (registered(backend, "auth")) event.setResult(PluginMessageEvent.ForwardResult.handled());
            else if (currentGame(player, backend) && handoff.queueForGreeting(player, backend, event.getData())) schedule(player, backend);
        }
    }

    @Subscribe public void disconnected(DisconnectEvent event) { handoff.left(event.getPlayer()); }

    private boolean registered(ServerConnection connection, String backend) {
        return server.getServer(backend).filter(expected -> expected == connection.getServer()).isPresent();
    }

    private boolean currentGame(Player player, ServerConnection connection) {
        return player.isActive() && server.getPlayer(player.getUniqueId()).orElse(null) == player
                && player.getCurrentServer().orElse(null) == connection && registered(connection, "paper");
    }

    private void schedule(Player player, ServerConnection connection) {
        server.getScheduler().buildTask(this, () -> {
            if (!currentGame(player, connection)) return;
            byte[] original = handoff.take(player, connection);
            if (original == null) return;
            try {
                connection.sendPluginMessage(YSM, original);
            } catch (IllegalStateException disconnected) {
                // The connection can close between checking it and submitting the write.
            }
        }).delay(Duration.ofMillis(250)).schedule();
    }
    @Subscribe public void stop(ProxyShutdownEvent event){
        server.getScheduler().tasksByPlugin(this).forEach(task->task.cancel());
        server.getChannelRegistrar().unregister(YSM);
        if(listener!=null)PacketEvents.getAPI().getEventManager().unregisterListener(listener);
        policy.clear();handoff.clear();
    }
}
