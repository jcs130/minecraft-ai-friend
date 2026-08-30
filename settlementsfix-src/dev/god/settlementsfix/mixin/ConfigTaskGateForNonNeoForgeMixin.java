package dev.god.settlementsfix.mixin;

import net.neoforged.neoforge.common.extensions.ICommonPacketListener;
import net.neoforged.neoforge.network.event.RegisterConfigurationTasksEvent;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * godfix 网络之门 · 通用配置任务分流（2026-08-30，Curios/Sophisticated 上服触发）。
 *
 * BetterCombatConfigTaskGateMixin 只罩 Better Combat 一个 mod；Curios 9.5.1 /
 * Sophisticated Backpacks+Core 上服后同样在 configuration 阶段注册自定义任务，
 * 非 NeoForge 客户端（mineflayer 女神化身/守卫探针/基岩 Geyser）协商卡死被踢
 * （实测 Goddess 循环 socketClosed，全 bot 掉线）。
 *
 * 本 mixin 不再逐 mod 打补丁，直接 hook NeoForge 事件本身：
 *   RegisterConfigurationTasksEvent.register(...) —— 非 NeoForge 连接一律跳过。
 * 效果 = 对 vanilla/基岩/mineflayer 客户端隐藏【所有 mod】的 CONFIG 任务；
 * NeoForge 真人客户端（isNeoForge=true）零影响，任务照常注册。
 * 以后再装任何双端 mod 都不再需要为此写新 mixin。
 *
 * require=0 + 打点日志：事件类/方法签名变动时静默失效而不是炸服，日志里
 * [CFG-GATE] 消失即为失效信号。
 */
@Mixin(RegisterConfigurationTasksEvent.class)
public class ConfigTaskGateForNonNeoForgeMixin {

    @org.spongepowered.asm.mixin.injection.Inject(
        method = "register",
        at = @At("HEAD"),
        cancellable = true,
        require = 0
    )
    private void settlementsfix$filterTasksForNonNeoForge(CallbackInfo ci) {
        RegisterConfigurationTasksEvent self = (RegisterConfigurationTasksEvent) (Object) this;
        boolean isNeoForge = ((ICommonPacketListener) (Object) self.getListener())
                .getConnectionType().isNeoForge();
        System.out.println("[CFG-GATE] RegisterConfigurationTasksEvent.register hit, isNeoForge="
                + isNeoForge + ", cancel=" + !isNeoForge);
        if (!isNeoForge) {
            ci.cancel();
        }
    }
}
