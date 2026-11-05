package org.qiandeng.camera.mixin;

import net.minecraft.class_310;
import org.qiandeng.camera.CameraFramePolicy;
import org.qiandeng.camera.CameraPose;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(class_310.class)
public abstract class CameraFrameMixin {
    @Inject(method="method_16009", at=@At("RETURN"), cancellable=true)
    private void qiandengFrameBudget(CallbackInfoReturnable<Integer> callback) {
        callback.setReturnValue(CameraFramePolicy.limit(Boolean.getBoolean("qiandeng.camera.enabled"),
            System.getProperty("qiandeng.camera.expectedGpu", "intel"),
            CameraPose.applicable((class_310)(Object)this) != null, callback.getReturnValue()));
    }
}
