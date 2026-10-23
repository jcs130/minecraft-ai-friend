package org.agentmc.bridge.mixin;
import net.minecraft.*;
import org.agentmc.bridge.ClientBridge;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Preserve actual damage source identity for the existing shared damage-evidence kernel. */
@Mixin(class_634.class)
public class ReflexPacketsMixin {
    @Inject(method="method_49034",at=@At("TAIL"))
    private void agentmc$damage(class_8143 packet,CallbackInfo ci){ClientBridge.reflexDamage((class_634)(Object)this,packet);}
}
