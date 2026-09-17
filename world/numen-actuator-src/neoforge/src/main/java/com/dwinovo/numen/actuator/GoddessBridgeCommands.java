package com.dwinovo.numen.actuator;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.ChatType;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.OutgoingChatMessage;
import net.minecraft.network.chat.PlayerChatMessage;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

/**
 * {@code /mycli} / {@code /myhelp} 命令桥：让真人玩家（MC 客户端）用斜杠命令触达女神。
 *
 * <p>背景（2026-08-23 小桃测试报告）：女神的 {@code /cli}、{@code /help} 并非真实注册
 * 命令，真人玩家打斜杠会被客户端当作服务器命令拦截（报 Unknown command），永远到不了
 * 女神的 mineflayer chat 监听。这里注册带 {@code my} 前缀的真命令，避开原版/内置命令名
 * 冲突，收到后以「玩家本人身份」向 Goddess 私语 {@code /cli <args>} 或 {@code /help
 * <topic>}，复用女神既有的 whisper → parseCli / isHelpCommand → handleCli /
 * handleHelpText 链路，玩家本人收私聊回执。
 */
public final class GoddessBridgeCommands {

    private GoddessBridgeCommands() {}

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("mycli")
                .executes(ctx -> forward(ctx, "/cli", ""))
                .then(Commands.argument("args", StringArgumentType.greedyString())
                        .executes(ctx -> forward(ctx, "/cli", StringArgumentType.getString(ctx, "args")))));

        dispatcher.register(Commands.literal("myhelp")
                .executes(ctx -> forward(ctx, "/help", ""))
                .then(Commands.argument("topic", StringArgumentType.greedyString())
                        .executes(ctx -> forward(ctx, "/help", StringArgumentType.getString(ctx, "topic")))));
    }

    private static int forward(CommandContext<CommandSourceStack> ctx, String verb, String args)
            throws CommandSyntaxException {
        CommandSourceStack src = ctx.getSource();
        ServerPlayer caller = src.getPlayerOrException();
        MinecraftServer server = caller.getServer();
        ServerPlayer goddess = server.getPlayerList().getPlayerByName("Goddess");
        if (goddess == null) {
            src.sendFailure(Component.literal("女神不在线，稍后再试"));
            return 0;
        }
        String message = (args == null || args.isBlank()) ? verb : verb + " " + args.trim();
        if (message.length() > 256) message = message.substring(0, 256);
        PlayerChatMessage chatMessage = PlayerChatMessage.unsigned(caller.getUUID(), message);
        // 对齐原版 /msg：incoming 私语直接发给目标，Bound 用发话人（真人玩家）的
        // CommandSourceStack 构造，目标客户端（mineflayer）据此触发 whisper 事件。
        ChatType.Bound incomingBound = ChatType.bind(
                ChatType.MSG_COMMAND_INCOMING, caller.createCommandSourceStack());
        OutgoingChatMessage outgoing = OutgoingChatMessage.create(chatMessage);
        goddess.sendChatMessage(outgoing, false, incomingBound);
        src.sendSuccess(() -> Component.literal("已上达女神"), false);
        return 1;
    }
}
