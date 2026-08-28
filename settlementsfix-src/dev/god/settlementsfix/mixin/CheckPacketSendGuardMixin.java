package dev.god.settlementsfix.mixin;

import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.ServerCommonPacketListener;
import net.minecraft.network.protocol.common.ServerboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.ClientCommonPacketListener;
import net.neoforged.neoforge.network.registration.NetworkRegistry;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * 破基岩/原版之门 · 第二刀 v2(2026-08-28):发送侧放行。
 *
 * checkPacket(Packet, listener) 的实参是包裹类 ClientboundCustomPayloadPacket /
 * ServerboundCustomPayloadPacket(v1.2.1 误判 CustomPacketPayload 本体, 刀落空)。
 * 对包裹类直接放行: 接收端(vanilla/Geyser)对未知通道静默忽略。
 */
@Mixin(NetworkRegistry.class)
public class CheckPacketSendGuardMixin {

    @Inject(
        method = "checkPacket(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/protocol/common/ServerCommonPacketListener;)V",
        at = @At("HEAD"),
        cancellable = true
    )
    private static void settlementsfix$skipServerSendGuard(Packet<?> packet, ServerCommonPacketListener listener, CallbackInfo ci) {
        if (packet instanceof ClientboundCustomPayloadPacket) {
            ci.cancel();
        }
    }

    @Inject(
        method = "checkPacket(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/protocol/common/ClientCommonPacketListener;)V",
        at = @At("HEAD"),
        cancellable = true
    )
    private static void settlementsfix$skipClientSendGuard(Packet<?> packet, ClientCommonPacketListener listener, CallbackInfo ci) {
        if (packet instanceof ServerboundCustomPayloadPacket) {
            ci.cancel();
        }
    }
}
