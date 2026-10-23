package org.agentmc.bridge.mixin;
import org.agentmc.bridge.ClientBridge;
import net.minecraft.class_312;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** The agent uses game APIs; it must never capture or reposition the OS cursor. */
@Mixin(class_312.class)
public abstract class BackgroundMouseMixin {
    @Inject(method = "method_1612", at = @At("HEAD"), cancellable = true, remap = false)
    private void agentNoCursorCapture(CallbackInfo callback) { if (ClientBridge.running) callback.cancel(); }
}
