package local.qdj.maids.brain;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.arguments.StringArgumentType;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.UuidArgument;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

final class CompanionCommands {
    static void register(CommandDispatcher<CommandSourceStack> dispatcher, Supplier<MaidCompanions> runtime) {
        var root = Commands.literal("maidagent");
        root.then(Commands.literal("companions").executes(c -> list(c, runtime.get(), false))
                .then(Commands.literal("json").executes(c -> list(c, runtime.get(), true))));
        var target = Commands.argument("companion", UuidArgument.uuid());
        for (String action : List.of("status", "recruit", "follow", "stay", "work", "dismiss")) {
            LiteralArgumentBuilder<CommandSourceStack> command = Commands.literal(action)
                    .executes(c -> run(c, runtime.get(), action, false));
            target.then(command.then(Commands.literal("json").executes(c -> run(c, runtime.get(), action, true))));
        }
        target.then(Commands.literal("say").then(Commands.argument("message", StringArgumentType.greedyString()).executes(c -> {
            var r = runtime.get();
            if (r == null || !(c.getSource().getEntity() instanceof ServerPlayer p)) return unavailable(c);
            var result = r.ask(p, UuidArgument.getUuid(c, "companion"), StringArgumentType.getString(c, "message"), 0);
            MaidCompanions.reply(c.getSource(), result, true);
            return "accepted".equals(result.get("status")) ? 1 : 0;
        })));
        target.then(Commands.literal("leave").executes(c -> {
            var r = runtime.get();
            if (r == null || !(c.getSource().getEntity() instanceof ServerPlayer p)) return unavailable(c);
            var result = r.execute(p, UuidArgument.getUuid(c, "companion"), "dismiss", null, false);
            MaidCompanions.reply(c.getSource(), result, true);
            return "accepted".equals(result.get("status")) ? 1 : 0;
        }));
        target.then(Commands.literal("whisper").then(Commands.argument("message",StringArgumentType.greedyString()).executes(c->{
            var r=runtime.get();if(r==null||!(c.getSource().getEntity() instanceof ServerPlayer p))return unavailable(c);
            var result=r.ask(p,UuidArgument.getUuid(c,"companion"),StringArgumentType.getString(c,"message"),0,"private");
            MaidCompanions.reply(c.getSource(),result,true);return "accepted".equals(result.get("status"))?1:0;
        })));
        root.then(Commands.literal("companion").then(target));
        root.then(Commands.literal("social").requires(s -> s.hasPermission(2))
                .then(Commands.argument("npc", UuidArgument.uuid()).executes(c -> {
                    var r = runtime.get();
                    if (r == null) return unavailable(c);
                    var result = r.social(UuidArgument.getUuid(c, "npc"));
                    MaidCompanions.reply(c.getSource(), result, true);
                    return "accepted".equals(result.get("status")) ? 1 : 0;
                })));
        dispatcher.register(root);
    }

    private static int list(CommandContext<CommandSourceStack> c, MaidCompanions r, boolean json) {
        if (r == null || !(c.getSource().getEntity() instanceof ServerPlayer p)) return unavailable(c);
        if (json) MaidCompanions.reply(c.getSource(), r.roster(p), true);
        else CompanionMenu.open(p, r, null, 0);
        return 1;
    }

    private static int run(CommandContext<CommandSourceStack> c, MaidCompanions r, String action, boolean json) {
        if (r == null || !(c.getSource().getEntity() instanceof ServerPlayer p)) return unavailable(c);
        UUID id = UuidArgument.getUuid(c, "companion");
        Map<String, Object> result = action.equals("status") ? r.execute(p, id, action, null, false) :
                r.ask(p, id, phrase(action), 0);
        if (!json && action.equals("status") && "ok".equals(result.get("status"))) CompanionMenu.open(p, r, id, 0);
        else MaidCompanions.reply(c.getSource(), result, json);
        return List.of("ok", "accepted").contains(result.get("status")) ? 1 : 0;
    }
    static String phrase(String action) {
        return switch(action) {
            case "recruit" -> "你好，愿意和我组队，一起出去冒险吗？也可以聊聊你想做什么。";
            case "follow" -> "我们一起走吧，请跟着我。";
            case "stay" -> "请在这里稍等我一下，好吗？";
            case "work" -> "你愿意在这里用自己的专长帮帮忙吗？";
            case "dismiss" -> "今天先到这里吧，我们结束同行，你回自己的驻地休息。";
            default -> "你好，介绍一下你自己和喜欢做的事情吧。";
        };
    }
    private static int unavailable(CommandContext<CommandSourceStack> c) {
        c.getSource().sendFailure(Component.literal("请在游戏里打开已启用的伙伴招募系统。"));
        return 0;
    }
}
