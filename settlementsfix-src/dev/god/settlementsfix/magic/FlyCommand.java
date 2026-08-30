package dev.god.settlementsfix.magic;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 御空术（2026-08-30 造物主钦点）：/fly <player> <seconds>（OP，mc-magic atoms 调用）。
 *
 * 实现：ServerPlayer abilities.mayfly=true + flying=true + onUpdateAbilities() 同步——
 * 原版能力包下发，客户端双击空格即飞（survival 玩家同样有效，原版机制零客户端依赖）。
 * 到期由单例调度线程收回：回主线程 server.execute 改 abilities；收回前给 5s 缓降
 * 防高空坠落。重复授予=刷新到期（版本戳比对防旧任务误收）。
 * 服务端重启：abilities 归零 + 表清空，天然一致，无需持久化。
 */
public final class FlyCommand {
    private static final Logger GODFIX = LoggerFactory.getLogger("godfix-fly");
    /** 玩家 → 到期时间戳（毫秒，wall clock）；到期任务自带 expected 戳防刷新后被旧任务误收。 */
    private static final Map<UUID, Long> EXPIRY = new ConcurrentHashMap<>();
    private static final ScheduledExecutorService TIMER = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "godfix-fly-timer");
        t.setDaemon(true);
        return t;
    });

    private FlyCommand() {}

    public static LiteralArgumentBuilder<CommandSourceStack> root() {
        LiteralArgumentBuilder<CommandSourceStack> root = Commands.literal("fly");
        root.requires(src -> src.hasPermission(2));
        root.then(Commands.literal("off")
                .then(Commands.argument("player", StringArgumentType.word())
                        .executes(ctx -> revokeNow(ctx.getSource(), StringArgumentType.getString(ctx, "player")))));
        root.then(Commands.argument("player", StringArgumentType.word())
                .then(Commands.argument("seconds", IntegerArgumentType.integer(3, 600))
                        .executes(ctx -> grant(ctx.getSource(),
                                StringArgumentType.getString(ctx, "player"),
                                IntegerArgumentType.getInteger(ctx, "seconds")))));
        return root;
    }

    private static int grant(CommandSourceStack source, String name, int seconds) {
        MinecraftServer server = source.getServer();
        ServerPlayer sp = server.getPlayerList().getPlayerByName(name);
        if (sp == null) return 0;
        UUID id = sp.getUUID();
        long deadline = System.currentTimeMillis() + seconds * 1000L;
        EXPIRY.put(id, deadline);
        sp.getAbilities().mayfly = true;
        sp.getAbilities().flying = true;
        sp.onUpdateAbilities();
        GODFIX.info("[fly] grant {}s to {} ({})", seconds, name, id);
        TIMER.schedule(() -> {
            Long cur = EXPIRY.get(id);
            if (cur == null || cur != deadline) return; // 已被刷新/收回，旧任务跳过
            server.execute(() -> revoke(server, name, id));
        }, seconds, TimeUnit.SECONDS);
        return 1;
    }

    private static int revokeNow(CommandSourceStack source, String name) {
        return revoke(source.getServer(), name, null);
    }

    private static int revoke(MinecraftServer server, String name, UUID expectedId) {
        ServerPlayer sp = server.getPlayerList().getPlayerByName(name);
        if (sp == null) {
            if (expectedId != null) EXPIRY.remove(expectedId);
            return 0;
        }
        UUID id = sp.getUUID();
        if (expectedId != null && !id.equals(expectedId)) return 0; // 同名顶替（numen 重召），不动新人
        EXPIRY.remove(id);
        // 缓降 5s：御空收回时人在半空，直接断会摔伤甚至摔死
        var cmds = server.getCommands();
        cmds.performPrefixedCommand(server.createCommandSourceStack(),
                "effect give " + name + " minecraft:slow_falling 5 0 true");
        sp.getAbilities().mayfly = false;
        sp.getAbilities().flying = false;
        sp.onUpdateAbilities();
        GODFIX.info("[fly] revoke {} ({})", name, id);
        return 1;
    }
}
