package org.qiandeng.camera.mixin;

import net.minecraft.*;
import org.qiandeng.camera.CameraPose;
import org.spongepowered.asm.mixin.*;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(class_4184.class)
public abstract class CameraPoseMixin {
    @Shadow private class_1297 field_18711;
    @Shadow private boolean field_18719;
    @Shadow protected abstract void method_19327(double x,double y,double z);
    @Shadow protected abstract void method_19325(float yaw,float pitch);
    @Inject(method="method_19321",at=@At("TAIL"),remap=false)
    private void qiandengRenderLease(CallbackInfo callback){
        if(!Boolean.getBoolean("qiandeng.camera.enabled"))return;
        var client=class_310.method_1551();var pose=CameraPose.applicable(client);if(pose==null)return;
        field_18711=client.field_1687.method_8469(pose.entityId());field_18719=!pose.mode().equals("first");
        method_19327(pose.x(),pose.y(),pose.z());method_19325(pose.yaw(),pose.pitch());
        org.qiandeng.camera.NativeCameraClient.frameApplied(pose.job());
    }
}
