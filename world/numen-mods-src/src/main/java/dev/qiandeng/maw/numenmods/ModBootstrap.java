package dev.qiandeng.maw.numenmods;

import com.dwinovo.numen.api.NumenPlugins;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.fml.common.Mod;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModList;

/** No client packets, login handlers, command authority or world generation. */
@Mod(value="maw_numen_mods",dist=Dist.DEDICATED_SERVER)
public final class ModBootstrap {
    public ModBootstrap(IEventBus bus) {
        if(ModList.get().isLoaded("minecolonies")&&ModList.get().isLoaded("touhou_little_maid"))TlmMinecoloniesBurningCompat.register(bus);
        NumenPlugins.register("maw",api->api.api("mods",
            "Actual installed mod capabilities and native workflows. Dedicated actions are discovered with the host's mod_operations tool.",CatalogLua.class));
    }
}
