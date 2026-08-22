package dev.god.settlementsfix.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import dev.breezes.settlements.application.ui.bubble.VillagerBubbleService;
import dev.breezes.settlements.domain.entities.ISettlementsVillager;

/**
 * 停用 VillagerBubbleService.tick，终结 enable_client=false 崩溃循环
 * （UNSUPPORTED_OPERATION_EXCEPTION on packet_bubble_snapshot_clientbound）。
 * 气泡不再生成——NPC 头顶改成 CustomName 常驻名牌（见 VillagerNameMixin）。
 */
@Mixin(VillagerBubbleService.class)
public abstract class VillagerBubbleServiceMixin {

    @Inject(method = "tick", at = @At("HEAD"), cancellable = true)
    private void settlementsfix$noBubble(ISettlementsVillager villager, long tick, CallbackInfoReturnable<Boolean> cir) {
        cir.setReturnValue(Boolean.FALSE);
    }
}
