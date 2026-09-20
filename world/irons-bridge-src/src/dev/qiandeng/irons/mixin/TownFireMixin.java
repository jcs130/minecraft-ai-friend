package dev.qiandeng.irons.mixin;

import dev.qiandeng.irons.TownProtection;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.FireBlock;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** The actual NeoForge 21.1.248 fire method includes the side argument. */
@Mixin(value = FireBlock.class, remap = false)
public abstract class TownFireMixin {
    @Inject(method = "tick", at = @At("HEAD"), cancellable = true, require = 1)
    private void qiandeng$stopTownFire(BlockState state, ServerLevel level, BlockPos pos,
                                     RandomSource random, CallbackInfo ci) {
        if (TownProtection.protects(level, pos)) {
            level.removeBlock(pos, false);
            TownProtection.refused();
            ci.cancel();
        }
    }
    @Inject(method = "checkBurnOut", at = @At("HEAD"), cancellable = true, require = 1)
    private void qiandeng$protectBurnTarget(Level level, BlockPos pos, int chance, RandomSource random,
                                          int age, Direction face, CallbackInfo ci) {
        // Check the victim, not the flame origin: outside fires cannot burn the boundary.
        if (TownProtection.protects(level, pos)) { TownProtection.refused(); ci.cancel(); }
    }
}
