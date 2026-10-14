package org.agentmc.bridge.mixin;
import net.minecraft.*;
import org.agentmc.bridge.VisualExport;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
@Mixin(class_638.class)
public class VisualBlockMixin {
    @Inject(method="method_41928",at=@At("TAIL"))
    private void agentmc$block(class_2338 pos,class_2680 state,int flags,CallbackInfo ci) {
        VisualExport.changed((class_638)(Object)this,pos.method_10263()>>4,pos.method_10260()>>4);
    }
}
