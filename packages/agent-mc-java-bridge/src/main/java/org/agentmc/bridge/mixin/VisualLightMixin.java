package org.agentmc.bridge.mixin;
import net.minecraft.*;
import org.agentmc.bridge.VisualExport;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
@Mixin(class_631.class)
public class VisualLightMixin {
    @Inject(method="method_12247",at=@At("TAIL"))
    private void agentmc$light(class_1944 type,class_4076 pos,CallbackInfo ci) { VisualExport.lightChanged(pos.method_18674(),pos.method_18687()); }
}
