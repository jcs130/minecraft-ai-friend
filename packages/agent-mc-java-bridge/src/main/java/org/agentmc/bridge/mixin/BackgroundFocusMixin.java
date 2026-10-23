package org.agentmc.bridge.mixin;
import org.agentmc.bridge.ClientBridge;
import net.minecraft.class_310;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(class_310.class)
public abstract class BackgroundFocusMixin {
    @Inject(method = "method_1569", at = @At("HEAD"), cancellable = true, remap = false)
    private void agentKeepTicking(CallbackInfoReturnable<Boolean> callback) {
        if (ClientBridge.hasController()) callback.setReturnValue(true);
    }
}
