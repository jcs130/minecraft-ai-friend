package local.hosting.mixin;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
@Mixin(targets="net.bettercombat.neoforge.PlatformImpl",remap=false)
public abstract class OptionalCombatSendMixin {
    @Inject(method="networkS2C_CanSend",at=@At("HEAD"),cancellable=true,require=1)
    private static void hosted$canSend(ServerPlayer player,ResourceLocation id,CallbackInfoReturnable<Boolean> ci){ci.setReturnValue(player.connection.hasChannel(id));}
    @Inject(method="networkS2C_Send",at=@At("HEAD"),cancellable=true,require=1)
    private static void hosted$send(ServerPlayer player,CustomPacketPayload payload,CallbackInfo ci){if(!player.connection.hasChannel(payload.type().id()))ci.cancel();}
}
