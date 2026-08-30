package dev.god.settlementsfix.mixin;

import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.ClientboundUpdateRecipesPacket;
import net.neoforged.neoforge.common.extensions.ICommonPacketListener;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * godfix 网络之门 · 配方包分流（2026-08-30，Curios/Sophisticated 上服触发）。
 *
 * 症状：两 mod 注册新配方后，declare_recipes（ClientboundUpdateRecipesPacket）
 * 里出现 mod 配方的 ingredient/NBT 结构，mineflayer 的 protodef 解析流错位
 * （"array size is abnormally large, not reading: 2003398244"），bot error
 * → Goddess/探针 PLAY 期断连循环（服务器侧 Timed out）。modded 真人客户端
 * 能正确解析不受影响；伤的只是原版协议客户端（mineflayer）与基岩。
 *
 * 处置：对非 NeoForge 连接不下发配方包——bot 不需要配方书（合成走 RCON/
 * 守卫桥），Geyser 自带配方表；NeoForge 真人照常收到全部配方。
 * require=0：send 签名变动时静默失效（日志 [RECIPE-GATE] 消失即信号），
 * 不炸服。
 */
@Mixin(targets = "net.minecraft.server.network.ServerCommonPacketListenerImpl")
public class RecipePacketGateForNonNeoForgeMixin {

    @Inject(
        method = "send(Lnet/minecraft/network/protocol/Packet;)V",
        at = @At("HEAD"),
        cancellable = true,
        require = 0
    )
    private void settlementsfix$skipRecipesForNonNeoForge(Packet<?> packet, CallbackInfo ci) {
        if (!(packet instanceof ClientboundUpdateRecipesPacket)) return;
        boolean isNeoForge = ((ICommonPacketListener) (Object) this)
                .getConnectionType().isNeoForge();
        System.out.println("[RECIPE-GATE] ClientboundUpdateRecipesPacket send hit, isNeoForge="
                + isNeoForge + ", cancel=" + !isNeoForge);
        if (!isNeoForge) {
            ci.cancel();
        }
    }
}
