package org.qiandeng.camera.mixin;

import net.minecraft.class_329;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(class_329.class)
public abstract class CameraHudMixin {
    @Inject(method="method_1753",at=@At("HEAD"),cancellable=true,remap=false)
    private void cameraCleanFrame(CallbackInfo callback){if(Boolean.getBoolean("qiandeng.camera.enabled"))callback.cancel();}
}
