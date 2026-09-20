package dev.qiandeng.irons.mixin;

import dev.qiandeng.irons.TownProtection;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.BucketItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.BlockHitResult;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Dispensers call this directly without a player's right-click event. */
@Mixin(value = BucketItem.class, remap = false)
public abstract class TownBucketMixin {
    @Inject(method = "emptyContents(Lnet/minecraft/world/entity/player/Player;Lnet/minecraft/world/level/Level;Lnet/minecraft/core/BlockPos;Lnet/minecraft/world/phys/BlockHitResult;Lnet/minecraft/world/item/ItemStack;)Z",
        at = @At("HEAD"), cancellable = true, require = 1)
    private void qiandeng$guardBucketTarget(Player player, Level level, BlockPos pos, BlockHitResult hit,
                                            ItemStack container, CallbackInfoReturnable<Boolean> cir) {
        if (TownProtection.protects(level, pos)) { TownProtection.refused(); cir.setReturnValue(false); }
    }
}
