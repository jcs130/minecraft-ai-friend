package dev.qiandeng.irons.mixin;

import dev.qiandeng.irons.TownProtection;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.level.LevelAccessor;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.material.FlowingFluid;
import net.minecraft.world.level.material.FluidState;
import net.minecraft.world.level.material.LavaFluid;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

// Lava has a water-to-stone override before its call to super.spreadTo.
@Mixin(value = {FlowingFluid.class, LavaFluid.class}, remap = false)
public abstract class TownFluidMixin {
    @Inject(method = "spreadTo", at = @At("HEAD"), cancellable = true, require = 1)
    private void qiandeng$protectFluidTarget(LevelAccessor level, BlockPos pos, BlockState state,
                                           Direction direction, FluidState fluid, CallbackInfo ci) {
        if (TownProtection.protects(level, pos)) { TownProtection.refused(); ci.cancel(); }
    }
}
