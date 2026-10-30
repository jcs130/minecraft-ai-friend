package dev.qiandeng.accounts.mixin;
import dev.qiandeng.accounts.SharedAccounts;
import net.minecraft.network.Connection;
import net.minecraft.network.protocol.game.ServerboundCustomPayloadPacket;
import net.minecraftforge.network.ICustomPacket;
import net.minecraftforge.network.NetworkHooks;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
/** Observe the existing vanilla opt-in before Forge dispatch; do not alter it. */
@Mixin(value=NetworkHooks.class,remap=false)
public abstract class AccountRegistration {
    @Inject(method="onCustomPayload",at=@At("HEAD"),remap=false)
    private static void accountRegistration(ICustomPacket<?> packet,Connection connection,CallbackInfoReturnable<Boolean> ci){
        if(packet instanceof ServerboundCustomPayloadPacket custom)SharedAccounts.registration(connection,custom);
    }
}
