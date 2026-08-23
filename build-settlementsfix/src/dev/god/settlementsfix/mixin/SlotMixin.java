package dev.god.settlementsfix.mixin;

import dev.god.settlementsfix.SettlementsFixMod;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * 神使手札/技能书不可入箱（2026-08-23 造物主谕「无法丢弃无法放入箱子」）。
 *
 * 拦截点 = {@link Slot#set(ItemStack)}：玩家把物品放进箱子/漏斗/熔炉等容器槽时，
 * 最终都会调目标槽的 set()。若放入的栈是受保护标记书（skillbook/craftreq/statusbook）
 * 且目标槽不属于玩家背包（Inventory），直接取消——书留在原地（玩家手里/背包/光标），
 * 进不了任何容器。
 *
 * 玩家背包槽的 container = PlayerInventory（继承 Container），因此「不是背包槽」= 容器槽。
 * 这同时拦下鼠标拖放与 shift 批量移动两条路径（后者底层也走 Slot.set）。
 */
@Mixin(Slot.class)
public abstract class SlotMixin {

    @Shadow
    public net.minecraft.world.Container container;

    @Inject(method = "set", at = @At("HEAD"), cancellable = true)
    private void settlementsfix$noMarkedBookInContainer(ItemStack stack, CallbackInfo ci) {
        try {
            if (this.container instanceof Inventory) {
                return; // 背包槽（含快捷栏/副手）放行
            }
            if (SettlementsFixMod.isMarkedBook(stack)) {
                ci.cancel();
            }
        } catch (Exception e) {
            // 任何异常都不阻断正常容器操作
        }
    }
}
