package local.qdj.maids.brain;

import com.mojang.logging.LogUtils;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import org.slf4j.Logger;

@Mod("tlm_maid_agents")
public final class MaidAgentsMod {
    private static final Logger LOGGER = LogUtils.getLogger();
    private static volatile MaidAgentsServer running;

    public MaidAgentsMod() {
        MaidBrainControl.reserveSitePrefix(MaidAgentsConfig.SITE_PREFIX);
        NeoForge.EVENT_BUS.addListener(MaidAgentsMod::serverStarted);
        NeoForge.EVENT_BUS.addListener(MaidAgentsMod::serverStopping);
        NeoForge.EVENT_BUS.addListener(MaidAgentsMod::commands);
    }

    private static void serverStarted(ServerStartedEvent event) {
        try {
            var config = MaidAgentsConfig.read(FMLPaths.CONFIGDIR.get().resolve("tlm-maid-agents.json"));
            running = new MaidAgentsServer(event.getServer(), config);
            LOGGER.info("TLM Maid Agents registered {} fixed entity bindings", running.size());
        } catch (Exception failure) {
            LOGGER.error("TLM Maid Agents configuration rejected. Check config/tlm-maid-agents.json and native site IDs. Cause type: {}",
                    failure.getClass().getSimpleName());
        }
    }

    private static void serverStopping(ServerStoppingEvent event) {
        MaidAgentsServer previous = running;
        running = null;
        if (previous != null) previous.close();
    }

    private static void commands(RegisterCommandsEvent event) {
        MaidAgentCommands.register(event.getDispatcher(), () -> running);
    }
}
