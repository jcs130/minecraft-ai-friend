package org.qiandeng.camera.mixin;

import net.minecraft.class_374;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Toasts are rendered outside InGameHud and otherwise contaminate photos. */
@Mixin(class_374.class)
public abstract class CameraToastMixin {
    @Inject(method="method_1996",at=@At("HEAD"),cancellable=true,remap=false)
    private void cameraCleanToast(CallbackInfo callback){if(Boolean.getBoolean("qiandeng.camera.enabled"))callback.cancel();}
}
