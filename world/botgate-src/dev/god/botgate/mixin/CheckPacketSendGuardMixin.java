package dev.god.botgate.mixin;

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
 * botgate 网络之门 · 发送侧放行（2026-08-28 原生 · 2026-09-06 提炼）。
 *
 * checkPacket(Packet, listener) 的实参是包裹类 ClientboundCustomPayloadPacket /
 * ServerboundCustomPayloadPacket(v1.2.1 误判 CustomPacketPayload 本体, 刀落空)。
 * 对包裹类直接放行: 接收端(vanilla/Geyser)对未知通道静默忽略。
 *
 * 2026-09-06 实证复发: immersive_aircraft(cobalt 自建网络层, 不走
 * PayloadRegistrar, force-optional 治不到它)在玩家入服 onDatapackSync 时发
 * immersive_aircraft:vehicle_upgrades, NeoForge checkPacket 对非 NeoForge
 * 客户端抛 UnsupportedOperationException: may not be sent → placeNewPlayer
 * 失败 → 踢 "Invalid player data"。本门放行后 vanilla 客户端静默丢弃, 两安。
 */
@Mixin(NetworkRegistry.class)
public class CheckPacketSendGuardMixin {

    @Inject(
        method = "checkPacket(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/protocol/common/ServerCommonPacketListener;)V",
        at = @At("HEAD"),
        cancellable = true
    )
    private static void botgate$skipServerSendGuard(Packet<?> packet, ServerCommonPacketListener listener, CallbackInfo ci) {
        if (packet instanceof ClientboundCustomPayloadPacket) {
            ci.cancel();
        }
    }

    @Inject(
        method = "checkPacket(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/protocol/common/ClientCommonPacketListener;)V",
        at = @At("HEAD"),
        cancellable = true
    )
    private static void botgate$skipClientSendGuard(Packet<?> packet, ClientCommonPacketListener listener, CallbackInfo ci) {
        if (packet instanceof ServerboundCustomPayloadPacket) {
            ci.cancel();
        }
    }
}
