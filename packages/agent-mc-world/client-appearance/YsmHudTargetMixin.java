package org.agentmc.appearance.mixin;

import org.agentmc.appearance.ClientAppearances;

import net.minecraft.class_1297;
import net.minecraft.class_742;
import net.minecraft.class_746;
import org.objectweb.asm.Opcodes;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;
import org.spongepowered.asm.mixin.injection.Redirect;

/** YSM 2.4.1's extra-player HUD otherwise renders the flying observer account.
 * Change only its draw subject and the transform's matching yaw; retain the original renderer.
 */
@Mixin(targets="com.elfmcys.yesstevemodel.o0oooO00oO00O0O0OoOOOOoo", remap=false)
public abstract class YsmHudTargetMixin {
    @ModifyArg(method="OOo0OOooo00OoO0oooooOOo0(Lnet/minecraft/class_898;Lnet/minecraft/class_746;Lnet/minecraft/class_332;)V",
        at=@At(value="INVOKE", target="Lnet/minecraft/class_898;method_3954(Lnet/minecraft/class_1297;DDDFFLnet/minecraft/class_4587;Lnet/minecraft/class_4597;I)V", remap=false),
        index=0, require=1, remap=false)
    private static class_1297 renderCameraPlayer(class_1297 original) {
        return ClientAppearances.recordHudTarget(original);
    }

    @Redirect(method="OOo0OOooo00OoO0oooooOOo0(Lnet/minecraft/class_332;Lnet/minecraft/class_746;FFFFI)V",
        at=@At(value="FIELD", target="Lnet/minecraft/class_746;field_6283:F", opcode=Opcodes.GETFIELD, remap=false),
        require=1, remap=false)
    private static float useCameraPlayerYaw(class_746 original) {
        var target = ClientAppearances.hudTarget(original);
        return target instanceof class_742 player ? player.field_6283 : original.field_6283;
    }
}
