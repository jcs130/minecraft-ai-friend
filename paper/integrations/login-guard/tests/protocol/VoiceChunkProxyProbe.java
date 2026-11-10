package org.afuhome.auth;

import com.google.inject.Inject;
import com.velocitypowered.api.event.*;
import com.velocitypowered.api.event.connection.PluginMessageEvent;
import com.velocitypowered.api.event.player.ServerPostConnectEvent;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.proxy.*;
import com.velocitypowered.api.proxy.messages.MinecraftChannelIdentifier;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import org.slf4j.Logger;
import xyz.kyngs.librelogin.api.LibreLoginPlugin;
import java.nio.*;
import java.nio.file.*;
import java.util.*;
import java.util.function.Predicate;

/** NEVER deploy: pinned real dispatcher/guard, synthetic auth, no accounts or worlds. */
public final class VoiceChunkProxyProbe {
    final ProxyServer server;final Logger logger;LoginGuard guard;
    @Inject public VoiceChunkProxyProbe(ProxyServer server,Logger logger){this.server=server;this.logger=logger;}
    @Subscribe @SuppressWarnings("unchecked") public void start(ProxyInitializeEvent event)throws Exception {
        if(!Boolean.getBoolean("voice.transport.qa")||!Files.isRegularFile(Path.of("voice-transport-qa.marker"))
                ||!server.getBoundAddress().getAddress().isLoopbackAddress())throw new IllegalStateException("Loopback QA only");
        guard=new LoginGuard(server,logger);
        var libre=(LibreLoginPlugin<Player,RegisteredServer>)AuthObservationTest.stub(LibreLoginPlugin.class,(m,a)->{
            if(m.getName().equals("getAuthorizationProvider"))return AuthObservationTest.stub(m.getReturnType(),(n,b)->switch(n.getName()){
                case "isAuthorized"->!((Player)b[0]).getUsername().equals("qa_denied");
                case "isAwaiting2FA"->false;default->AuthObservationTest.empty(n.getReturnType());
            });return AuthObservationTest.empty(m.getReturnType());
        });
        AuthObservationTest.set(guard,"libre",libre);AuthObservationTest.set(guard,"ready",true);
        // Register the actual production methods and annotations, not a shim whose
        // own @Subscribe would accidentally mask (or reintroduce) the ordering bug.
        var events=server.getEventManager();events.register(this,guard);
        // Pinned Velocity test seam: retain ONLY guard's plugin-message handlers.
        // Never run its production startup/login/disconnect or filesystem routines.
        var remove=events.getClass().getDeclaredMethod("unregisterIf",Predicate.class);remove.setAccessible(true);
        remove.invoke(events,(Predicate<Object>)row->{try{
            var instance=row.getClass().getDeclaredField("instance");instance.setAccessible(true);
            var type=row.getClass().getDeclaredField("eventType");type.setAccessible(true);
            return instance.get(row)==guard&&type.get(row)!=PluginMessageEvent.class;
        }catch(Exception failure){throw new IllegalStateException(failure);}});
        server.getChannelRegistrar().register(MinecraftChannelIdentifier.from("mcagent:voice"));
        logger.info("VOICE_CHUNK_QA_READY actual LoginGuard subscriptions; synthetic authorization");
    }
    @Subscribe @SuppressWarnings("unchecked") public void joined(ServerPostConnectEvent event)throws Exception {
        ((Set<Player>)AuthObservationTest.get(guard,"authenticated")).add(event.getPlayer());
    }
    // A bounded deterministic scheduler perturbation. No bytes/IDs are changed.
    // Baseline worker tasks overtake this one; candidate remains inline/in order.
    @Subscribe(order=PostOrder.LAST,async=false) public void delay(PluginMessageEvent event)throws InterruptedException {
        byte[] bytes=event.getData();
        if(Boolean.getBoolean("voice.chunk.qa.delay-first")&&event.getSource() instanceof Player
                &&event.getIdentifier().getId().equals("mcagent:voice")&&bytes.length>=21&&bytes[0]==2
                &&ByteBuffer.wrap(bytes,17,4).getInt()==0)Thread.sleep(40);
    }
}
