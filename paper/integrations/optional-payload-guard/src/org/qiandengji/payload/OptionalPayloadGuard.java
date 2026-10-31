package org.qiandengji.payload;

import com.github.retrooper.packetevents.PacketEvents;
import com.github.retrooper.packetevents.event.*;
import com.github.retrooper.packetevents.protocol.packettype.PacketType;
import com.github.retrooper.packetevents.wrapper.play.client.WrapperPlayClientPluginMessage;
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerPluginMessage;
import com.github.retrooper.packetevents.wrapper.configuration.client.WrapperConfigClientPluginMessage;
import com.github.retrooper.packetevents.wrapper.configuration.server.WrapperConfigServerPluginMessage;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.proxy.*;
import com.velocitypowered.api.plugin.*;

/** Scope optional extension packets to their original connection's declared decoders. */
@Plugin(id="optionalpayloadguard",name="OptionalPayloadGuard",version="0.1.0",dependencies={@Dependency(id="packetevents")})
public final class OptionalPayloadGuard {
    private final OptionalPayloadPolicy policy=new OptionalPayloadPolicy();
    private PacketListenerAbstract listener;
    @Subscribe public void start(ProxyInitializeEvent event){
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
    @Subscribe public void stop(ProxyShutdownEvent event){if(listener!=null)PacketEvents.getAPI().getEventManager().unregisterListener(listener);policy.clear();}
}
