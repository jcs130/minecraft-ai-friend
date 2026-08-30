package dev.god.settlementsfix.mixin;

import net.minecraft.core.component.DataComponents;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.network.protocol.game.ServerboundUseItemPacket;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.CustomData;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * godfix 技能罗盘 · godfix.6（2026-08-30 造物主谕：书页手柄点不了，要一个
 * 「右键就出界面」的物品——手柄 LT/RT 即物品使用，容器轮盘十字键可选）。
 *
 * 拦服务端右键总入口 handleUseItem：任意物品带 custom_data.skillbox=true
 * （不限于 written_book——罗盘/紫水晶/任意壳）→ 开 9x1 技能轮盘，cancel 原行为。
 * 潜行+右键 = 放行原版（保留物品本来用途，与书通道一致）。
 * require=0：无包处理不炸。
 */
@Mixin(ServerGamePacketListenerImpl.class)
public abstract class SkillItemUseMixin {

    private static final Logger GODFIX = LoggerFactory.getLogger("godfix-itemuse");

    @Shadow
    public ServerPlayer player;

    @Inject(method = "handleUseItem", at = @At("HEAD"), cancellable = true, require = 0)
    private void settlementsfix$wheelItemUse(ServerboundUseItemPacket packet, CallbackInfo ci) {
        try {
            if (player == null || player.isSpectator() || player.isShiftKeyDown()) {
                return;
            }
            InteractionHand hand = packet.getHand();
            ItemStack stack = player.getItemInHand(hand);
            if (stack == null || stack.isEmpty()) {
                return;
            }
            CustomData cd = stack.get(DataComponents.CUSTOM_DATA);
            if (cd == null || cd.isEmpty() || !cd.copyTag().getBoolean("skillbox")) {
                return;
            }
            dev.god.settlementsfix.chest.SkillChestCommands.openWheelFor(player, 0);
            player.displayClientMessage(
                    net.minecraft.network.chat.Component.literal("§b✦ 转动罗盘…"), true);
            ci.cancel();
        } catch (Exception e) {
            GODFIX.warn("[itemuse] wheel item hook failed: {}", e.toString());
        }
    }
}
