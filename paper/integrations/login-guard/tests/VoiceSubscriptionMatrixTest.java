package org.afuhome.auth;

import com.velocitypowered.api.plugin.*;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.proxy.event.VelocityEventManager;
import java.net.URLClassLoader;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;

/** Actual three-plugin subscription matrix, without starting plugins or a server. */
public final class VoiceSubscriptionMatrixTest {
    public static void main(String[] args)throws Exception {
        if(args.length!=2)throw new IllegalArgumentException("payload-guard.jar via-version.jar");
        try(var loader=new URLClassLoader(new java.net.URL[]{Path.of(args[0]).toUri().toURL(),Path.of(args[1]).toUri().toURL()},VoiceSubscriptionMatrixTest.class.getClassLoader())){
            for(boolean reply:new boolean[]{false,true}){
                var fixture=new VoiceTransportTest.Fixture();var workers=new VoiceOrderingTest.Workers();
                var description=(PluginDescription)AuthObservationTest.stub(PluginDescription.class,(m,a)->switch(m.getName()){
                    case "getId"->"voice-matrix-qa";case "getName"->Optional.of("Voice matrix QA");default->AuthObservationTest.empty(m.getReturnType());
                });
                var plugin=(PluginContainer)AuthObservationTest.stub(PluginContainer.class,(m,a)->switch(m.getName()){
                    case "getDescription"->description;case "getExecutorService"->workers;case "getInstance"->Optional.of(fixture.guard);default->AuthObservationTest.empty(m.getReturnType());
                });
                var manager=(PluginManager)AuthObservationTest.stub(PluginManager.class,(m,a)->Optional.of(plugin));
                var events=new VelocityEventManager(manager);events.registerInternally(plugin,fixture.guard);
                Object server=AuthObservationTest.get(fixture.guard,"server");
                Object payload=loader.loadClass("org.qiandengji.payload.OptionalPayloadGuard").getConstructor(ProxyServer.class).newInstance(server);
                Object via=loader.loadClass("com.viaversion.viaversion.velocity.listeners.ConnectionDetailsListener").getConstructor().newInstance();
                events.registerInternally(plugin,payload);events.registerInternally(plugin,via);
                var registry=VelocityEventManager.class.getDeclaredField("handlersByType");registry.setAccessible(true);
                var rows=((com.google.common.collect.Multimap<?,?>)registry.get(events)).values();
                int count=0;for(Object row:rows){var et=row.getClass().getDeclaredField("eventType");et.setAccessible(true);if(et.get(row)==com.velocitypowered.api.event.connection.PluginMessageEvent.class)count++;}
                if(count!=6)throw new AssertionError("Expected all six actual payload subscriptions, got "+count);
                var observed=new ArrayList<Integer>();var futures=new ArrayList<CompletableFuture<?>>();
                for(int n=0;n<3;n++)futures.add(events.fire(fixture.event(reply,new byte[]{2,(byte)n})).thenAccept(e->{if(e.getResult().isAllowed())observed.add((int)e.getData()[1]);}));
                workers.reverse();CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new)).join();
                if(!observed.equals(List.of(0,1,2)))throw new AssertionError((reply?"S2C":"C2S")+" matrix reordered: "+observed);
            }
        }
        System.out.println("PASS actual LoginGuard + OptionalPayloadGuard + ViaVersion subscription matrix, C2S/S2C");
    }
}
