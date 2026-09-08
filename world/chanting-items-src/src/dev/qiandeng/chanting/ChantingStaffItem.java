package dev.qiandeng.chanting;

import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.UseAnim;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.level.Level;

/** Own item: no Iron casting component, spell container or automatic right-click cast. */
public final class ChantingStaffItem extends Item {
    public ChantingStaffItem(Properties properties) { super(properties); }
    @Override public InteractionResultHolder<ItemStack> use(Level level, Player player, InteractionHand hand) {
        if (!player.isAlive() || player.isSpectator()) return InteractionResultHolder.fail(player.getItemInHand(hand));
        player.startUsingItem(hand);
        if (player instanceof ServerPlayer serverPlayer) QiandengChantingItems.begin(serverPlayer);
        return InteractionResultHolder.consume(player.getItemInHand(hand));
    }
    @Override public int getUseDuration(ItemStack stack, LivingEntity user) { return 72_000; }
    @Override public UseAnim getUseAnimation(ItemStack stack) { return UseAnim.BOW; }
    @Override public void appendHoverText(ItemStack stack, Item.TooltipContext context, List<Component> lines, TooltipFlag flag) {
        lines.add(Component.translatable("tooltip.qiandeng_chanting.hold").withStyle(ChatFormatting.AQUA));
        lines.add(Component.translatable("tooltip.qiandeng_chanting.once").withStyle(ChatFormatting.GRAY));
    }
    @Override public void releaseUsing(ItemStack stack, Level level, LivingEntity entity, int remaining) {
        if (entity instanceof ServerPlayer player) QiandengChantingItems.release(player, stack);
    }
}
