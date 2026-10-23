package org.agentmc.bridge.mixin;

import net.minecraft.*;
import org.agentmc.bridge.ClientBridge;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Observe vanilla's applied responses; never modify packet contents or inventory. */
@Mixin(class_634.class)
public class InventoryPacketsMixin {
    @Inject(method="method_11109", at=@At("TAIL"))
    private void agentmc$slot(class_2653 packet, CallbackInfo ci) {
        ClientBridge.inventorySlot((class_634)(Object)this, packet.method_11452(), packet.method_11450());
    }
    @Inject(method="method_11153", at=@At("TAIL"))
    private void agentmc$inventory(class_2649 packet, CallbackInfo ci) {
        ClientBridge.inventoryFull((class_634)(Object)this, packet.method_11440());
    }
    @Inject(method="method_11135", at=@At("TAIL"))
    private void agentmc$selection(class_2735 packet, CallbackInfo ci) {
        ClientBridge.inventorySelection((class_634)(Object)this, packet.method_11803());
    }
}
