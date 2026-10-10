package dev.qiandeng.maw.numenserver;

import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import org.slf4j.LoggerFactory;

@Mod("maw_numen_server")
public final class HeadlessMod {
    private static final org.slf4j.Logger LOG = LoggerFactory.getLogger("maw-numen-server");
    public HeadlessMod() {
        NeoForge.EVENT_BUS.addListener((ServerStartedEvent e) -> {
            try { HeadlessRuntime.start(e.getServer()); }
            catch (Exception failure) { LOG.error("Numen server endpoint not started: {}", failure.getClass().getSimpleName()); }
        });
        NeoForge.EVENT_BUS.addListener((ServerTickEvent.Post e) -> HeadlessRuntime.tick(e.getServer()));
        NeoForge.EVENT_BUS.addListener((ServerStoppingEvent e) -> HeadlessRuntime.stop());
    }
}
