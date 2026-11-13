package org.agentmc.appearance.mixin;
import org.agentmc.appearance.ClientAppearances;
import net.minecraft.world.entity.Entity;import net.minecraft.client.player.LocalPlayer;import net.minecraft.client.player.AbstractClientPlayer;
import org.objectweb.asm.Opcodes;import org.spongepowered.asm.mixin.Mixin;import org.spongepowered.asm.mixin.injection.*;

/** Pinned official NeoForge YSM draw subject and both interpolation yaw samples. */
@Mixin(targets="com.elfmcys.yesstevemodel.Oo0OOO00o00oOOo0O0o000O0",remap=false)
public abstract class YsmHudTargetMixin {
 @ModifyArg(method="oOo0OO0O0o000OO0O000oo0o(Lnet/minecraft/client/renderer/entity/EntityRenderDispatcher;Lnet/minecraft/client/player/LocalPlayer;FLnet/minecraft/client/gui/GuiGraphics;)V",at=@At(value="INVOKE",target="Lnet/minecraft/client/renderer/entity/EntityRenderDispatcher;render(Lnet/minecraft/world/entity/Entity;DDDFFLcom/mojang/blaze3d/vertex/PoseStack;Lnet/minecraft/client/renderer/MultiBufferSource;I)V",remap=false),index=0,require=1,remap=false)
 private static Entity subject(Entity original){return ClientAppearances.recordHudTarget(original);}
 @Redirect(method="oOo0OO0O0o000OO0O000oo0o(Lnet/minecraft/client/gui/GuiGraphics;Lnet/minecraft/client/player/LocalPlayer;FFFFIF)V",at=@At(value="FIELD",target="Lnet/minecraft/client/player/LocalPlayer;yBodyRot:F",opcode=Opcodes.GETFIELD,remap=false),require=1,remap=false)
 private static float yaw(LocalPlayer original){var target=ClientAppearances.hudTarget(original);return target instanceof AbstractClientPlayer player?player.yBodyRot:original.yBodyRot;}
 @Redirect(method="oOo0OO0O0o000OO0O000oo0o(Lnet/minecraft/client/gui/GuiGraphics;Lnet/minecraft/client/player/LocalPlayer;FFFFIF)V",at=@At(value="FIELD",target="Lnet/minecraft/client/player/LocalPlayer;yBodyRotO:F",opcode=Opcodes.GETFIELD,remap=false),require=1,remap=false)
 private static float previousYaw(LocalPlayer original){var target=ClientAppearances.hudTarget(original);return target instanceof AbstractClientPlayer player?player.yBodyRotO:original.yBodyRotO;}
}
