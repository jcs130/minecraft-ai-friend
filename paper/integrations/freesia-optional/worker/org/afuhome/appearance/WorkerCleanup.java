package org.afuhome.appearance;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import meow.kikir.freesia.worker.ServerLoader;

/** Release the original Worker's non-daemon controller event loops after normal stop. */
public final class WorkerCleanup implements ModInitializer {
    @Override public void onInitialize() {
        // If the initial control connection failed before isRunning became true,
        // start one asynchronous attempt when the Minecraft server is ready.
        ServerLifecycleEvents.SERVER_STARTED.register(server->{
            if(ServerLoader.clientInstance!=null)ServerLoader.clientInstance.connect();
        });
        ServerLifecycleEvents.SERVER_STOPPED.register(server->{
            if(ServerLoader.clientInstance!=null)ServerLoader.clientInstance.close();
        });
    }
}
