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

/** Verified YSM 2.6.5 HUD hooks. Preserve interpolation and the camera player's real pose. */
@Mixin(targets="com.elfmcys.yesstevemodel.Oo0oOOOoOO00ooooOo0OOOOo", remap=false)
public abstract class YsmHudTargetMixin {
    @ModifyArg(method="OO0ooo0OooOoO0OoO0ooOO0o(Lnet/minecraft/class_898;Lnet/minecraft/class_746;FLnet/minecraft/class_332;)V",
        at=@At(value="INVOKE", target="Lnet/minecraft/class_898;method_3954(Lnet/minecraft/class_1297;DDDFFLnet/minecraft/class_4587;Lnet/minecraft/class_4597;I)V", remap=false),
        index=0, require=1, remap=false)
    private static class_1297 renderCameraPlayer(class_1297 original) {
        return ClientAppearances.recordHudTarget(original);
    }

    @Redirect(method="OO0ooo0OooOoO0OoO0ooOO0o(Lnet/minecraft/class_332;Lnet/minecraft/class_746;FFFFIF)V",
        at=@At(value="FIELD", target="Lnet/minecraft/class_746;field_6283:F", opcode=Opcodes.GETFIELD, remap=false),
        require=1, remap=false)
    private static float useCameraPlayerYaw(class_746 original) {
        var target = ClientAppearances.hudTarget(original);
        return target instanceof class_742 player ? player.field_6283 : original.field_6283;
    }

    @Redirect(method="OO0ooo0OooOoO0OoO0ooOO0o(Lnet/minecraft/class_332;Lnet/minecraft/class_746;FFFFIF)V",
        at=@At(value="FIELD", target="Lnet/minecraft/class_746;field_6220:F", opcode=Opcodes.GETFIELD, remap=false),
        require=1, remap=false)
    private static float useCameraPlayerPreviousYaw(class_746 original) {
        var target = ClientAppearances.hudTarget(original);
        return target instanceof class_742 player ? player.field_6220 : original.field_6220;
    }
}
