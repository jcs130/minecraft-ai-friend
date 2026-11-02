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
import com.velocitypowered.api.event.player.ServerPostConnectEvent;
import com.velocitypowered.api.event.proxy.*;
import com.velocitypowered.api.plugin.*;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.ServerConnection;
import com.velocitypowered.api.proxy.messages.MinecraftChannelIdentifier;
import com.google.inject.Inject;
import java.time.Duration;

/** Scope optional extension packets to their original connection's declared decoders. */
@Plugin(id="optionalpayloadguard",name="OptionalPayloadGuard",version="0.1.2",dependencies={@Dependency(id="packetevents")})
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
    @Subscribe(order=PostOrder.LAST) public void acknowledgement(PluginMessageEvent event){
        // Observe the original client message without changing its forwarding result.
        // A backend, another connection, a different version or model/action payload
        // cannot seed the handoff. This is never a login or decoder-capability grant.
        if(!YSM.equals(event.getIdentifier())||!event.getResult().isAllowed()
                ||!(event.getSource() instanceof Player player)
                ||!(event.getTarget() instanceof ServerConnection target)||target.getPlayer()!=player)return;
        if(handoff.received(player,event.getData()))schedule(player);
    }
    @Subscribe(order=PostOrder.LAST) public void connected(ServerPostConnectEvent event){schedule(event.getPlayer());}
    @Subscribe public void disconnected(DisconnectEvent event){handoff.left(event.getPlayer());}
    private boolean current(Player player,ServerConnection connection){
        return player.isActive()&&server.getPlayer(player.getUniqueId()).orElse(null)==player
                &&player.getCurrentServer().orElse(null)==connection&&connection.getPlayer()==player
                &&server.getServer("paper").orElse(null)==connection.getServer();
    }
    private void schedule(Player player){
        ServerConnection connection=player.getCurrentServer().orElse(null);
        if(connection==null||!current(player,connection)||!handoff.queue(player,connection))return;
        server.getScheduler().buildTask(this,()->{
            if(!current(player,connection))return;
            byte[] original=handoff.take(player,connection);
            if(original==null)return;
            if(connection.sendPluginMessage(YSM,original))handoff.delivered(player,connection);
            else schedule(player); // At most two attempts on this exact backend connection.
        }).delay(Duration.ofMillis(500)).schedule();
    }
    @Subscribe public void stop(ProxyShutdownEvent event){
        server.getScheduler().tasksByPlugin(this).forEach(task->task.cancel());
        server.getChannelRegistrar().unregister(YSM);
        if(listener!=null)PacketEvents.getAPI().getEventManager().unregisterListener(listener);
        policy.clear();handoff.clear();
    }
}
