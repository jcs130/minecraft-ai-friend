package dev.qiandeng.chanting.client.mixin;

import dev.qiandeng.chanting.client.ChantingClient;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Append our hold to SVC/Controlify state; never overwrite a physical PTT key. */
@Mixin(targets = "de.maxhenkel.voicechat.voice.client.PTTKeyHandler", remap = false)
public abstract class StaffPttMixin {
    @Inject(method = { "isPTTDown()Z", "isAnyDown()Z" }, at = @At("RETURN"),
            cancellable = true, remap = false)
    private void qiandeng$appendStaffHold(CallbackInfoReturnable<Boolean> callback) {
        if (!callback.getReturnValueZ() && ChantingClient.isHoldingStaff()) {
            callback.setReturnValue(true);
        }
    }
}
