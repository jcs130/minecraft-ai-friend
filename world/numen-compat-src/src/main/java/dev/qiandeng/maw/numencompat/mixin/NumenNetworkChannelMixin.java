package dev.qiandeng.maw.numencompat.mixin;

import com.dwinovo.numen.platform.NeoForgeNetworkChannel;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Only Numen's registrations change; other mods keep their own negotiation rules. */
@Mixin(value = NeoForgeNetworkChannel.class, remap = false)
public abstract class NumenNetworkChannelMixin {
    @Redirect(method = "flushPending", at = @At(value = "INVOKE", target =
            "Lnet/neoforged/neoforge/network/event/RegisterPayloadHandlersEvent;registrar(Ljava/lang/String;)Lnet/neoforged/neoforge/network/registration/PayloadRegistrar;"), require = 1)
    private PayloadRegistrar maw$optional(RegisterPayloadHandlersEvent event, String version) {
        return event.registrar(version).optional();
    }

    @Inject(method = "sendToPlayer", at = @At("HEAD"), cancellable = true, require = 1)
    private void maw$sendOnlyToCapableClient(ServerPlayer player, CustomPacketPayload payload, CallbackInfo ci) {
        // Includes fragments: absent clients must never receive a Numen-only packet.
        if (player.connection == null || !player.connection.hasChannel(payload.type())) ci.cancel();
    }
}
