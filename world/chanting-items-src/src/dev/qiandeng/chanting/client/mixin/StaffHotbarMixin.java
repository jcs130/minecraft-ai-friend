package dev.qiandeng.chanting.client.mixin;

import dev.qiandeng.chanting.client.ChantingClient;
import net.minecraft.world.entity.player.Inventory;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** Controlify 3.0.1 has exactly two hotbar swap calls; leave every other action alone. */
@Pseudo
@Mixin(targets = "dev.isxander.controlify.ingame.InGameInputHandler", remap = false)
public abstract class StaffHotbarMixin {
    @Redirect(method = "handleKeybinds()V", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/world/entity/player/Inventory;swapPaint(D)V"), require = 2)
    private void qiandeng$keepStaffInHand(Inventory inventory, double direction) {
        if (!ChantingClient.suppressControllerHotbar()) inventory.swapPaint(direction);
    }
}
