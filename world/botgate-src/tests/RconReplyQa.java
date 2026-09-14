package dev.qiandeng.rconqa;

import com.google.gson.Gson;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import java.util.LinkedHashMap;
import java.util.Map;

/** Isolated fixture only: no production game actions or model clients. */
@Mod("qiandeng_rcon_reply_qa")
public final class RconReplyQa {
    private final Map<String, Integer> counts = new LinkedHashMap<>();
    public RconReplyQa() { NeoForge.EVENT_BUS.addListener(this::register); }

    void register(RegisterCommandsEvent event) {
        if (!"isolated-rcon-transaction".equals(System.getenv("QD_QA_FIXTURE")))
            throw new IllegalStateException("isolated_fixture_required");
        event.getDispatcher().register(Commands.literal("qdrconqa")
            .requires(s -> s.getEntity() == null && s.hasPermission(4))
            .then(Commands.literal("status").executes(c -> {
                c.getSource().sendSuccess(() -> Component.literal("QD_RCON_COUNTS " + new Gson().toJson(counts)), false);
                return 1;
            }))
            .then(Commands.literal("echo").then(Commands.argument("token", StringArgumentType.word()).executes(c -> {
                String token = StringArgumentType.getString(c, "token");
                counts.merge(token, 1, Integer::sum);
                // Force independent RCON client threads to overlap their native
                // prepare/execute/read steps. This delay exists ONLY in QA.
                try { Thread.sleep(10); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
                if (token.equals("throw-once")) throw new IllegalStateException("qa_expected_command_failure");
                c.getSource().sendSuccess(() -> Component.literal("QD_RCON_REPLY " + token), false);
                return 1;
            }))));
    }
}
