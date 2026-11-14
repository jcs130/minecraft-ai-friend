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
import java.util.*;

/** Test-only physical connections and real SVC; authorization is a synthetic provider. */
public final class SvcProxyProbe {
    final ProxyServer server;final Logger logger;LoginGuard guard;
    @Inject public SvcProxyProbe(ProxyServer server,Logger logger){this.server=server;this.logger=logger;}
    @Subscribe @SuppressWarnings("unchecked") public void start(ProxyInitializeEvent event)throws Exception {
        if(!Boolean.getBoolean("voice.transport.qa")||!Files.isRegularFile(Path.of("voice-transport-qa.marker"))
                ||!server.getBoundAddress().getAddress().isLoopbackAddress())throw new IllegalStateException("Isolated loopback QA only");
        guard=new LoginGuard(server,logger);
        var libre=(LibreLoginPlugin<Player,RegisteredServer>)AuthObservationTest.stub(LibreLoginPlugin.class,(m,a)->{
            if(m.getName().equals("getAuthorizationProvider"))return AuthObservationTest.stub(m.getReturnType(),(n,b)->switch(n.getName()){
                case "isAuthorized"->!((Player)b[0]).getUsername().equals("qa_denied");
                case "isAwaiting2FA"->false;default->AuthObservationTest.empty(n.getReturnType());
            });return AuthObservationTest.empty(m.getReturnType());
        });
        AuthObservationTest.set(guard,"libre",libre);AuthObservationTest.set(guard,"ready",true);
        var p=new Properties();try(var input=Files.newInputStream(Path.of("svc-test.properties"))){p.load(input);}
        try{LoginGuard.class.getDeclaredMethod("configureSvcRoutes",Properties.class).invoke(guard,p);}
        catch(NoSuchMethodException baseline){}
        server.getChannelRegistrar().register(MinecraftChannelIdentifier.from("voicechat:secret"));
        logger.info("SVC_QA_READY synthetic authorization, real Velocity/Paper/SVC");
    }
    @Subscribe @SuppressWarnings("unchecked") public void joined(ServerPostConnectEvent e)throws Exception {
        ((Set<Player>)AuthObservationTest.get(guard,"authenticated")).add(e.getPlayer());
        logger.info("SVC_QA_PEER player={} address={}",e.getPlayer().getUsername(),e.getPlayer().getRemoteAddress());
    }
    @Subscribe(async=false) public void route(PluginMessageEvent e)throws Exception {
        try{LoginGuard.class.getMethod("svcSecret",PluginMessageEvent.class).invoke(guard,e);}
        catch(NoSuchMethodException baseline){}
    }
}
