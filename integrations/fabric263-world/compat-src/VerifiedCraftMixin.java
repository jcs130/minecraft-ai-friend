package dev.myagentworld.fabric263;

import com.llamalad7.mixinextras.injector.wrapmethod.WrapMethod;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ResultSlot;
import net.minecraft.world.item.ItemStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Interoperability fix for the reviewed JustQuests 0.4.5/MC 26.3 pair.
 * ResultSlot.checkTakeAchievements receives the real crafted stack and actual
 * removeCount. Preserve that one-use evidence for the later onTake call, whose
 * argument can be empty after quick-move. The existing quest hook remains the
 * sole counter; no progress or reward is written by this component.
 * No inventory changes, permissions, rewards or quest predicates are replaced.
 */
@Mixin(ResultSlot.class)
public abstract class VerifiedCraftMixin {
    @Shadow private int removeCount;
    @Unique private ItemStack maw$verifiedCraft = ItemStack.EMPTY;

    @Inject(method = "checkTakeAchievements", at = @At("HEAD"), require = 1)
    private void maw$captureVerifiedCraft(ItemStack stack, CallbackInfo ci) {
        if (removeCount > 0 && !stack.isEmpty()) maw$verifiedCraft = stack.copyWithCount(removeCount);
    }

    @WrapMethod(method = "onTake")
    private void maw$preserveCraftEvidence(Player player, ItemStack stack, Operation<Void> original) {
        ItemStack proof = maw$verifiedCraft;
        maw$verifiedCraft = ItemStack.EMPTY;
        try {
            ItemStack input = player instanceof ServerPlayer && stack.isEmpty() && !proof.isEmpty() ? proof : stack;
            original.call(player, input);
        } finally {
            maw$verifiedCraft = ItemStack.EMPTY;
        }
    }
}
