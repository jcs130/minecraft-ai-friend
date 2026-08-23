package dev.god.settlementsfix.mixin;

import dev.god.settlementsfix.SettlementsFixMod;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.WrittenBookItem;
import net.minecraft.world.level.Level;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * 技能书施法拦截（2026-08-23 根因修复）。
 *
 * 背景：原方案监听 {@code PlayerInteractEvent.RightClickItem}，但该事件只在
 * {@code ServerPlayerGameMode.useItem}（对着空气右键）fire；书右键打开 GUI 时
 * 玩家通常对着地面/方块，走 {@code useItemOn}，该路径不 fire RightClickItem
 * → 书右键永远不触发施法。
 *
 * 正确拦截点 = {@code WrittenBookItem.use(Level, Player, InteractionHand)} ——
 * 这是书被使用的唯一统一入口（对空气/对方块右键最终都经过它）。在 HEAD 处把
 * 玩家与手上的书交给 {@link SettlementsFixMod#handleSkillBookUse} 处理。
 *
 * 注意：1.21 中该方法的返回类型是 {@link InteractionResultHolder}{@code <ItemStack>}
 * （不再是旧版的 InteractionResult），CallbackInfoReturnable 泛型必须匹配，否则
 * 注入签名校验失败。
 */
@Mixin(WrittenBookItem.class)
public abstract class WrittenBookItemMixin {

    @Inject(method = "use", at = @At("HEAD"))
    private void settlementsfix$onSkillBookUse(Level level, Player player, InteractionHand hand,
                                               CallbackInfoReturnable<InteractionResultHolder<ItemStack>> cir) {
        SettlementsFixMod.handleSkillBookUse(player, player.getItemInHand(hand));
    }
}
