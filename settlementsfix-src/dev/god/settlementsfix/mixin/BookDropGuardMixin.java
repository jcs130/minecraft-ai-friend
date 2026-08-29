package dev.god.settlementsfix.mixin;

import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.CustomData;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * godfix 神物护持 · 丢书防线（2026-08-30 造物主谕：命格书应不可丢弃）。
 *
 * 命格书（statusbook）/技能书（skillbook）/书匣（skillbox）带 custom_data 标——
 * 活着的玩家主动丢弃（Q 键/拖出背包/容器 THROW）一律拦截，提示「此物与你命格相连」。
 * 死亡掉落不拦（!isAlive 放行）——书掉了由 BookAutoRestoreMixin 5 秒内自动补回。
 * require=0：无此路径不炸服。
 */
@Mixin(Player.class)
public abstract class BookDropGuardMixin {

    private static final Logger GODFIX = LoggerFactory.getLogger("godfix-bookguard");

    @Inject(
        method = "drop(Lnet/minecraft/world/item/ItemStack;ZZ)Lnet/minecraft/world/entity/item/ItemEntity;",
        at = @At("HEAD"),
        cancellable = true,
        require = 0
    )
    private void settlementsfix$guardDrop(ItemStack stack, boolean includeThrowerName,
                                          boolean includeName,
                                          CallbackInfoReturnable<ItemEntity> cir) {
        try {
            if (stack == null || stack.isEmpty()) {
                return;
            }
            Player self = (Player) (Object) this;
            if (!self.isAlive()) {
                return; // 死亡掉落放行 → AutoRestore 兜底补回
            }
            CustomData cd = stack.get(DataComponents.CUSTOM_DATA);
            if (cd == null || cd.isEmpty()) {
                return;
            }
            var tag = cd.copyTag();
            boolean guarded = tag.getBoolean("statusbook")
                    || tag.getBoolean("skillbox")
                    || tag.contains("skillbook");
            if (guarded) {
                if (self instanceof ServerPlayer sp) {
                    sp.displayClientMessage(
                            Component.literal("§6✦ 此物与你的命格相连，不可丢弃。"), true);
                }
                cir.setReturnValue(null);
            }
        } catch (Exception e) {
            GODFIX.warn("[bookguard] drop hook failed: {}", e.toString());
        }
    }
}
