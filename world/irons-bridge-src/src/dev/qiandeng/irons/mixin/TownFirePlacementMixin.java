package dev.qiandeng.irons.mixin;

import dev.qiandeng.irons.TownProtection;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.BaseFireBlock;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(value = BaseFireBlock.class, remap = false)
public abstract class TownFirePlacementMixin {
    @Inject(method = "onPlace", at = @At("HEAD"), cancellable = true, require = 1)
    private void qiandeng$removeNewTownFire(BlockState state, Level level, BlockPos pos,
                                          BlockState oldState, boolean moving, CallbackInfo ci) {
        if (TownProtection.protects(level, pos)) {
            level.removeBlock(pos, false);
            TownProtection.refused();
            ci.cancel();
        }
    }
}
