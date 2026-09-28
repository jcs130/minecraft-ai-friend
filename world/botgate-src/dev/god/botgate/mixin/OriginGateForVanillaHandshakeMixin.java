package dev.god.botgate.mixin;

import net.minecraft.network.Connection;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.login.ServerboundHelloPacket;
import net.minecraft.server.network.ServerLoginPacketListenerImpl;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * botgate 网络之门 · 原生协议只准从门进（2026-09-27 造物主令）。
 *
 * mineflayer/Geyser 直连未翻译的 25565 会读错乱世界（红床读成活塞、obsidian 读成火），
 * 一律须走神社之门（内门 25701 / 外门 25702，号翻译+自答协商）。
 *
 * 判定时机 = handleHello（客户端第一个包）：
 *   - 真 NeoForge 客户端（mod 协商）零影响：isNeoForge 直放，判定与 CFG-GATE 同源；
 *   - 原版协议：只放行 Docker 网段(172.16/12)与回环——那是 gate/gate-public/ViaProxy
 *     容器的源地址；LAN/公网来源的原版握手 = 绕门裸连，踢并指路。
 * require=0 + 拿不到证据一律放行：静默失效不炸服，[ORIGIN-GATE] 日志消失=失效信号。
 */
@Mixin(ServerLoginPacketListenerImpl.class)
public class OriginGateForVanillaHandshakeMixin {

    @Shadow @Final private Connection connection;

    @Inject(method = "handleHello", at = @At("HEAD"), cancellable = true, require = 0)
    private void botgate$requireVanillaComeThroughGate(ServerboundHelloPacket packet, CallbackInfo ci) {
        ServerLoginPacketListenerImpl self = (ServerLoginPacketListenerImpl) (Object) this;
        boolean neoforge;
        try {
            neoforge = ((net.neoforged.neoforge.common.extensions.ICommonPacketListener) (Object) self)
                    .getConnectionType().isNeoForge();
        } catch (Throwable degraded) {
            return;
        }
        if (neoforge) return;
        String ip;
        try {
            ip = String.valueOf(this.connection.getRemoteAddress());
        } catch (Throwable degraded) {
            return;
        }
        if (ip == null) return;
        boolean gateSide = ip.contains("/172.") || ip.startsWith("172.")
                || ip.contains("/127.") || ip.contains("127.0.0.1") || ip.startsWith("local");
        System.out.println("[ORIGIN-GATE] vanilla hello name=" + packet.name() + " from=" + ip + " gateSide=" + gateSide);
        if (gateSide) return;
        ci.cancel();
        try {
            self.disconnect(Component.literal(
                    "\u00a7c\u8bf7\u52ff\u76f4\u8fde 25565\uff08\u65e0\u7248\u672c\u7ffb\u8bd1\uff0c\u4f1a\u8bfb\u5230\u9519\u4e71\u4e16\u754c\uff09\u3002\n"
                  + "\u00a77mineflayer/Agent/\u5916\u90e8\u5ba2\u6237\u7aef\u8bf7\u8d70\u795e\u793e\u5916\u95e8 \u00a7f25702\u00a77\uff08\u540d\u5b57\u9700 ag_ \u524d\u7f00\uff09\uff0c\u672c\u673a Agent \u8d70\u5185\u95e8 25701\u3002"));
        } catch (Throwable ignore) {
        }
    }
}
