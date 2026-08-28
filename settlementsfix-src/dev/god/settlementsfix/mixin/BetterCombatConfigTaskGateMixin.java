package dev.god.settlementsfix.mixin;

import net.neoforged.neoforge.common.extensions.ICommonPacketListener;
import net.neoforged.neoforge.network.event.RegisterConfigurationTasksEvent;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * godfix 网络之门 · BC 配置任务分流（2026-08-29）。
 *
 * Better Combat 2.4.0 在 configuration 阶段向每个客户端注册两个自定义任务
 * (bettercombat:config / bettercombat:weapon_registry)。NeoForge 客户端能应答；
 * 原版协议客户端（mineflayer 门神/守卫/基岩 Geyser）不认识任务协议，协商即卡死。
 * 上次 BC 上服把 Goddess/桐人/鸣人/Taro 全部踢下线，只得回滚。
 *
 * 本 mixin 在 BC 注册 configuration task 时按连接类型分流：
 *   - NeoForge 客户端（真人 modded）：照常注册，武器注册表/配置同步功能完整；
 *   - 非 NeoForge（vanilla/基岩）：跳过注册 —— 协商畅通，代价仅是这些客户端
 *     本来也用不到的 BC 客户端表现层。
 *
 * payload 侧（config_sync/ack/weapon_registry 三通道）已由
 * PayloadRegistrarForceOptionalMixin 全局强制 optional，与本 mixin 合璧。
 *
 * Better Combat 不在 mods 目录时本 mixin 静默失效（require=0），不炸服。
 */
@Mixin(targets = "net.bettercombat.neoforge.network.NetworkEvents")
public class BetterCombatConfigTaskGateMixin {

    @Inject(
        method = "register(Lnet/neoforged/neoforge/network/event/RegisterConfigurationTasksEvent;)V",
        at = @At("HEAD"),
        cancellable = true,
        require = 0
    )
    private static void settlementsfix$skipConfigTasksForNonNeoForge(
            RegisterConfigurationTasksEvent event, CallbackInfo ci) {
        boolean isNeoForge = ((ICommonPacketListener) (Object) event.getListener())
                .getConnectionType().isNeoForge();
        System.out.println("[BC-GATE] register(RegisterConfigurationTasksEvent) hit, isNeoForge=" + isNeoForge
                + ", cancel=" + !isNeoForge);
        if (!isNeoForge) {
            ci.cancel();
        }
    }
}
