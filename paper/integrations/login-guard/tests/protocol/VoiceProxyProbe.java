package org.afuhome.auth;

import com.google.inject.Inject;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.connection.PluginMessageEvent;
import com.velocitypowered.api.event.player.ServerPostConnectEvent;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.proxy.*;
import com.velocitypowered.api.proxy.messages.MinecraftChannelIdentifier;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import org.slf4j.Logger;
import xyz.kyngs.librelogin.api.LibreLoginPlugin;
import java.nio.file.*;
import java.util.Set;

/** NEVER ship: real TCP connections/events, synthetic authorization, no account database. */
public final class VoiceProxyProbe {
    final ProxyServer server;final Logger logger;LoginGuard guard;
    @Inject public VoiceProxyProbe(ProxyServer server,Logger logger){this.server=server;this.logger=logger;}
    @Subscribe @SuppressWarnings("unchecked") public void start(ProxyInitializeEvent event)throws Exception {
        if(!Boolean.getBoolean("voice.transport.qa") || !Files.isRegularFile(Path.of("voice-transport-qa.marker"))
                || !server.getBoundAddress().getAddress().isLoopbackAddress())
            throw new IllegalStateException("Isolated loopback QA only; never install in production");
        guard=new LoginGuard(server,logger);
        var libre=(LibreLoginPlugin<Player,RegisteredServer>)AuthObservationTest.stub(LibreLoginPlugin.class,(m,a)->{
            if(m.getName().equals("getAuthorizationProvider"))return AuthObservationTest.stub(m.getReturnType(),(n,b)->switch(n.getName()){
                case "isAuthorized"->!((Player)b[0]).getUsername().equals("qa_denied");
                case "isAwaiting2FA"->false;default->AuthObservationTest.empty(n.getReturnType());
            });
            return AuthObservationTest.empty(m.getReturnType());
        });
        AuthObservationTest.set(guard,"libre",libre);AuthObservationTest.set(guard,"ready",true);
        server.getChannelRegistrar().register(MinecraftChannelIdentifier.from("mcagent:voice"));
        logger.info("VOICE_QA_READY synthetic authorization; real Velocity transport");
    }
    @Subscribe @SuppressWarnings("unchecked") public void joined(ServerPostConnectEvent event)throws Exception {
        ((Set<Player>)AuthObservationTest.get(guard,"authenticated")).add(event.getPlayer());
    }
    @Subscribe public void route(PluginMessageEvent event){
        if(guard==null){event.setResult(PluginMessageEvent.ForwardResult.handled());return;}
        guard.voiceTransport(event);
        if(event.getIdentifier().getId().equals("mcagent:voice"))
            logger.info("VOICE_QA_GATE direction={} allowed={} source={} target={}",
                event.getSource() instanceof Player?"C2S":"S2C",event.getResult().isAllowed(),
                event.getSource().getClass().getSimpleName(),event.getTarget().getClass().getSimpleName());
    }
}
