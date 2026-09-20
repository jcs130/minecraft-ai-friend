package dev.qiandeng.irons.mixin;

import dev.qiandeng.irons.TownProtection;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.Level;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Deny the direct native remove/destroy paths before drops; do not hook all setBlock state updates. */
@Mixin(value = Level.class, remap = false)
public abstract class TownRemovalMixin {
    @Inject(method = "removeBlock", at = @At("HEAD"), cancellable = true, require = 1)
    private void qiandeng$guardRemoval(BlockPos pos, boolean moving, CallbackInfoReturnable<Boolean> cir) {
        Level level = (Level) (Object) this;
        if (!TownProtection.mayRemove(level, pos, level.getBlockState(pos))) {
            TownProtection.refused(); cir.setReturnValue(false);
        }
    }
    @Inject(method = "destroyBlock(Lnet/minecraft/core/BlockPos;ZLnet/minecraft/world/entity/Entity;I)Z",
            at = @At("HEAD"), cancellable = true, require = 1)
    private void qiandeng$guardDestruction(BlockPos pos, boolean drops, Entity actor, int recursion,
                                         CallbackInfoReturnable<Boolean> cir) {
        Level level = (Level) (Object) this;
        if (!TownProtection.mayRemove(level, pos, level.getBlockState(pos))) {
            TownProtection.refused(); cir.setReturnValue(false);
        }
    }
}
