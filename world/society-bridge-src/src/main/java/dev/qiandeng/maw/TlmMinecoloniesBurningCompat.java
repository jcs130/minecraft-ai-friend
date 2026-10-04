package dev.qiandeng.maw;

import com.github.tartaricacid.touhoulittlemaid.api.mixin.IBlockBurningCacheMixin;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.block.Block;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.event.lifecycle.FMLCommonSetupEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Avoid TLM 1.5.3's reflective scan of MineColonies block methods on a server.
 * Reflection resolves unrelated client-only method parameter classes such as
 * BlockHutTownHall.getRequirements(ClientLevel, BlockPos, LocalPlayer).
 *
 * Use TLM's own public opt-out before pathfinding starts. Only its extra cache
 * is bypassed; NodeEvaluator still computes the original burning predicate.
 * Neither the predicate nor the logging configuration is changed.
 */
final class TlmMinecoloniesBurningCompat {
    private static final Logger LOGGER = LoggerFactory.getLogger(TlmMinecoloniesBurningCompat.class);

    private TlmMinecoloniesBurningCompat() {}

    static void register(IEventBus modBus) {
        modBus.addListener((FMLCommonSetupEvent event) -> event.enqueueWork(TlmMinecoloniesBurningCompat::configure));
    }

    private static void configure() {
        int optedOut = 0;
        int missingApi = 0;
        int preexistingCache = 0;
        for (Block block : BuiltInRegistries.BLOCK) {
            if (!BuiltInRegistries.BLOCK.getKey(block).getNamespace().equals("minecolonies")) continue;
            // Avoid all Class.getDeclaredMethod(s) calls here: those calls are
            // exactly what pulls ClientLevel into the dedicated-server loader.
            if (block instanceof IBlockBurningCacheMixin cache) {
                if (cache.touhou_little_maid$isBurning() != null) preexistingCache++;
                cache.touhou_little_maid$setCannotCache(true);
                optedOut++;
            } else {
                missingApi++;
                LOGGER.warn("TLM burning compatibility API missing for {}", BuiltInRegistries.BLOCK.getKey(block));
            }
        }
        LOGGER.info("TLM/MineColonies burning compatibility: {} blocks opted out of reflective caching; "
                + "{} missing API; {} preexisting values left unchanged", optedOut, missingApi, preexistingCache);
        if (preexistingCache > 0) {
            LOGGER.warn("Some MineColonies burning results were already cached before common setup; "
                    + "this compatibility layer preserves those results and does not claim to invalidate them");
        }
    }
}
