package dev.god.settlementsfix.mixin;

import dev.breezes.settlements.domain.entities.ISettlementsVillager;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * 2026-08-24 天神止血补丁：VillagerBubbleService.publishSnapshot 是气泡快照的
 * 唯一发包口（所有入口 tick/applyCommand/CourtshipPresenter/BubbleSpeechSink 都汇聚于此）。
 * NeoForge 21.1.73 NetworkRegistry.checkPacket 对 settlements 的 optional clientbound
 * payload 抛 UnsupportedOperationException("may not be sent to the client!") → 服务端崩溃。
 * 此处在 HEAD cancel，气泡功能整体关闭（对话仍走 speech_mirror 公屏），
 * 等 settlements 源码级修复（过滤接收端连接）上线后移除此 mixin。
 */
@Mixin(targets = "dev.breezes.settlements.application.ui.bubble.VillagerBubbleService", remap = false)
public class BubblePublishGuardMixin {

    @Inject(method = "publishSnapshot", at = @At("HEAD"), cancellable = true, remap = false)
    private void settlementsfix$disableBubblePublish(ISettlementsVillager villager, CallbackInfo ci) {
        ci.cancel();
    }
}
