package org.qiandengji.payload;

import com.github.retrooper.packetevents.PacketEvents;
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerPluginMessage;
import com.google.inject.Inject;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.connection.PluginMessageEvent;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.messages.MinecraftChannelIdentifier;
import java.nio.charset.StandardCharsets;

/** Explicit loopback integration fixture, excluded from the production JAR. */
@Plugin(id="optionalpayloadqatest",name="OptionalPayloadQaTest",version="0.0.1")
public final class OptionalPayloadProxyTest {
    private final ProxyServer server;
    @Inject public OptionalPayloadProxyTest(ProxyServer server){this.server=server;}
    @Subscribe public void start(ProxyInitializeEvent event){
        if(server.getBoundAddress().getPort()!=29396||!server.getBoundAddress().getAddress().isLoopbackAddress())throw new IllegalStateException("Own loopback fixture only");
        for(String name:new String[]{"qa:probe","mcagent:state","mcagent:appearance","yes_steve_model:2_4_0"})server.getChannelRegistrar().register(MinecraftChannelIdentifier.from(name));
    }
    @Subscribe public void message(PluginMessageEvent event){
        if(!event.getIdentifier().getId().equals("qa:probe")||!(event.getSource() instanceof Player player))return;
        event.setResult(PluginMessageEvent.ForwardResult.handled());
        if(!player.getUsername().matches("ag_VC[a-z0-9]{3,10}")||event.getData().length!=1)return;
        byte[] marker=("own-probe-"+event.getData()[0]).getBytes(StandardCharsets.UTF_8);
        for(String name:new String[]{"vv:proxy_details","vv:server_details","mcagent:state","mcagent:appearance","yes_steve_model:2_4_0","qa:ack"})
            PacketEvents.getAPI().getPlayerManager().sendPacket(player,new WrapperPlayServerPluginMessage(name,marker));
    }
}
