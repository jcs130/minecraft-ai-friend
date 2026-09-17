package com.dwinovo.numen.actuator;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import net.minecraft.network.chat.ChatType;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.OutgoingChatMessage;
import net.minecraft.network.chat.PlayerChatMessage;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;

/**
 * 技能书右键施法（2026-08-29 造物主谕「真人拿技能书按右键即可释放」）。
 *
 * <p>技能书 = 带 ✦ 徽记的 enchanted_book（custom_name 文本以「✦ 」开头，
 * 如「✦ 螺旋丸」）。右键（{@link PlayerInteractEvent.RightClickItem}）触发：
 * 以玩家本人身份向 Goddess 私语 {@code /cli cast <书名去徽记>}，复用女神既有
 * cast 链（等级/魔力/冷却校验、模糊咒词匹配、[CLI] 私语回执）——本处零旁路，
 * 未匹配书名会收到女神的自然反馈。
 *
 * <p>设计要点：
 * <ul>
 *   <li>徽记「✦ 」是法术书与非附魔用途附魔书的分界，普通附魔书右键无动作；</li>
 *   <li>每玩家 500ms 节流，防按住右键连发刷屏；</li>
 *   <li>副手也认（萌萌手柄操作，主副手都可能出现）；</li>
 *   <li>书不消耗——书是「习得凭证 + 释放器」（对齐生存手册既有文案）。</li>
 * </ul>
 */
public final class SkillBookHandler {

    private static final String BADGE = "\u2726 "; // ✦ 徽记（后随空格）
    private static final long THROTTLE_MS = 500L;
    private static final Map<UUID, Long> LAST_USE = new ConcurrentHashMap<>();

    private SkillBookHandler() {}

    public static void onRightClickItem(PlayerInteractEvent.RightClickItem event) {
        if (event.getEntity().level().isClientSide()) return;
        if (!(event.getEntity() instanceof ServerPlayer player)) return;

        String spell = spellNameFromHand(player, event.getHand());
        if (spell == null) return;

        long now = System.currentTimeMillis();
        long last = LAST_USE.getOrDefault(player.getUUID(), 0L);
        if (now - last < THROTTLE_MS) {
            event.setCanceled(true);
            return;
        }
        LAST_USE.put(player.getUUID(), now);

        MinecraftServer server = player.getServer();
        ServerPlayer goddess = server == null ? null : server.getPlayerList().getPlayerByName("Goddess");
        if (goddess == null) {
            player.sendSystemMessage(Component.literal("\u2726 女神不在线，法术暂歇"));
            event.setCanceled(true);
            return;
        }

        String message = "/cli cast " + spell;
        PlayerChatMessage chatMessage = PlayerChatMessage.unsigned(player.getUUID(), message);
        ChatType.Bound incomingBound = ChatType.bind(
                ChatType.MSG_COMMAND_INCOMING, player.createCommandSourceStack());
        goddess.sendChatMessage(OutgoingChatMessage.create(chatMessage), false, incomingBound);
        player.sendSystemMessage(Component.literal("\u2726 施法：" + spell));
        event.setCanceled(true);
    }

    /** 该手是否持有技能书，是则返回书名去徽记后的法术名；否则 null。 */
    private static String spellNameFromHand(ServerPlayer player, InteractionHand hand) {
        ItemStack stack = player.getItemInHand(hand);
        if (stack.isEmpty()) return null;
        String plain = stack.getHoverName().getString();
        if (!plain.startsWith(BADGE)) return null;
        String spell = plain.substring(BADGE.length()).trim();
        if (spell.isEmpty() || spell.length() > 32) return null;
        return spell;
    }

    /** 玩家退出时清节流表，防 UUID 泄漏。 */
    public static void onPlayerLoggedOut(net.neoforged.neoforge.event.entity.player.PlayerEvent.PlayerLoggedOutEvent event) {
        LAST_USE.remove(event.getEntity().getUUID());
    }
}
