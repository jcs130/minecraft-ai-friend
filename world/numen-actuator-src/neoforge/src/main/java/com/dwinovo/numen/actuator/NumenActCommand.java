package com.dwinovo.numen.actuator;

import com.dwinovo.numen.agent.tool.NumenTool;
import com.dwinovo.numen.agent.tool.ToolRegistry;
import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.Companions;
import com.dwinovo.numen.entity.NumenPlayer;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.ChatType;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.OutgoingChatMessage;
import net.minecraft.network.chat.PlayerChatMessage;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.phys.Vec3;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Map;
import java.util.UUID;

/**
 * {@code /numen_act} 命令树：服务端 RCON 桥。
 *
 * <pre>
 *   numen_act list                         列全部假玩家（名字|uuid|owner|维度|坐标）
 *   numen_act summon &lt;ownerUuid&gt; &lt;name&gt;  在 overworld 出生点召唤假玩家
 *   numen_act invoke &lt;name&gt; &lt;tool&gt; &lt;json&gt;  直调工具（服务端 onServerCall，回结果）
 *   numen_act dismiss &lt;name&gt;               遣散假玩家
 *   numen_act say &lt;name&gt; &lt;消息&gt;            假玩家以本人身份公屏发言
 *   numen_act whisper &lt;name&gt; &lt;target&gt; &lt;消息&gt; 假玩家向目标玩家私语（咏唱通道）
 * </pre>
 *
 * <p>回执口径：查询型工具当场回结果；动作型（goto/mine/build 等）经
 * {@code TaskDispatch.setTask} 受理即回 task_id（均在本线程回调），RCON 同步拿得到。
 * 动作型收尾须由调用方另发 {@code invoke &lt;name&gt; task_status &lt;json&gt;} 轮询。
 */
public final class NumenActCommand {

    private NumenActCommand() {}

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        registerRestore(dispatcher);
        dispatcher.register(Commands.literal("numen_act")
                .requires(src -> src.hasPermission(2)) // RCON / op 2 级
                .then(Commands.literal("pad")
                        .executes(NumenActCommand::pad))
                .then(Commands.literal("list")
                        .executes(NumenActCommand::list))
                .then(Commands.literal("summon")
                        .then(Commands.argument("owner", StringArgumentType.string())
                                .then(Commands.argument("name", StringArgumentType.string()) // string 非 word：支持中文名（桐人/鸣人）
                                        .executes(NumenActCommand::summon))))
                .then(Commands.literal("invoke")
                        .then(Commands.argument("companion", StringArgumentType.string()) // string：中文名
                                .then(Commands.argument("tool", StringArgumentType.word())
                                        .then(Commands.argument("args", StringArgumentType.greedyString())
                                                .executes(NumenActCommand::invoke)))))
                .then(Commands.literal("dismiss")
                        .then(Commands.argument("companion", StringArgumentType.string()) // string：中文名
                                .executes(NumenActCommand::dismiss)))
                .then(Commands.literal("skin") // 换肤（2026-08-30 天神谕：守卫穿本尊皮肤）——
                        // Mojang 签名的 textures value+signature 存 CompanionRegistry，
                        // 在线身体 dormant+respawn 无缝换装（位置/背包/任务原样保留）。
                        .then(Commands.argument("companion", StringArgumentType.string())
                                .then(Commands.argument("value", StringArgumentType.string())
                                        .executes(NumenActCommand::skinNoSig)
                                        .then(Commands.argument("signature", StringArgumentType.string())
                                                .executes(NumenActCommand::skin)))))
                .then(Commands.literal("say")
                        .then(Commands.argument("companion", StringArgumentType.string()) // string：中文名
                                .then(Commands.argument("message", StringArgumentType.greedyString()) // greedy：消息可含空格/中文
                                        .executes(NumenActCommand::say))))
                .then(Commands.literal("whisper")
                        .then(Commands.argument("companion", StringArgumentType.string()) // string：中文名
                                .then(Commands.argument("target", StringArgumentType.string()) // string：目标玩家名（如 Goddess）
                                        .then(Commands.argument("message", StringArgumentType.greedyString()) // greedy：消息可含空格/中文
                                                .executes(NumenActCommand::whisper)))))
                .then(Commands.literal("dumpregistry") // 导出全块状态注册表（name→stateId→properties），喂 mineflayer mcData 注入 + 网页端 stateId→块名映射
                        .executes(NumenActCommand::dumpRegistry)));
    }

    // ==================== pad ====================

    /** Report the companion chunk pad: what is configured, and what was stamped. */
    private static int pad(CommandContext<CommandSourceStack> ctx) {
        CommandSourceStack src = ctx.getSource();
        src.sendSuccess(() -> Component.literal(CompanionPad.status(src.getServer())), false);
        return 1;
    }

    // ==================== list ====================

    private static int list(CommandContext<CommandSourceStack> ctx) {
        CommandSourceStack src = ctx.getSource();
        MinecraftServer server = src.getServer();
        StringBuilder sb = new StringBuilder();
        int count = 0;
        for (ServerPlayer p : server.getPlayerList().getPlayers()) {
            if (p instanceof NumenPlayer np) {
                sb.append(np.getName().getString())
                        .append("|uuid=").append(np.getUUID())
                        .append("|owner=").append(np.getOwnerUuid())
                        .append("|dim=").append(np.level().dimension().location())
                        .append("|pos=").append(np.blockPosition().getX())
                        .append(',').append(np.blockPosition().getY())
                        .append(',').append(np.blockPosition().getZ())
                        .append('\n');
                count++;
            }
        }
        // Companions that exist in the catalogue but are not in the world (dead, or
        // waiting on a respawn) are reported in a separate section. The online section
        // keeps its exact shape so presence checks cannot mistake a dead companion for
        // a live body, and the death state is the body's own registry speaking rather
        // than something inferred from the server's bookkeeping.
        StringBuilder dead = new StringBuilder();
        int deadCount = 0;
        try {
            for (Map.Entry<UUID, CompanionRegistry.Entry> e : CompanionRegistry.get(server).all()) {
                CompanionRegistry.Entry entry = e.getValue();
                if (entry.diedAt() <= 0L) {
                    continue;
                }
                boolean online = false;
                for (ServerPlayer p : server.getPlayerList().getPlayers()) {
                    if (p instanceof NumenPlayer np && np.getUUID().equals(e.getKey())) {
                        online = true;
                        break;
                    }
                }
                if (online) {
                    continue;
                }
                dead.append(entry.name())
                        .append("|uuid=").append(e.getKey())
                        .append("|owner=").append(entry.owner())
                        .append("|dim=").append(entry.dimension().location())
                        .append("|pos=").append(entry.pos().getX())
                        .append(',').append(entry.pos().getY())
                        .append(',').append(entry.pos().getZ())
                        .append("|dead=1")
                        .append("|diedAt=").append(entry.diedAt())
                        .append("|cause=").append(entry.deathCause() == null ? "" : entry.deathCause())
                        .append('\n');
                deadCount++;
            }
        } catch (RuntimeException ignored) {
            // The catalogue is a courtesy to the caller; never fail the roster over it.
        }
        if (count == 0) {
            src.sendSuccess(() -> Component.literal("count=0"), false);
        } else {
            sb.insert(0, "count=" + count + "\n");
            src.sendSuccess(() -> Component.literal(sb.toString()), false);
        }
        if (deadCount > 0) {
            dead.insert(0, "dead=" + deadCount + "\n");
            src.sendSuccess(() -> Component.literal(dead.toString()), false);
        }
        return count;
    }

    // ==================== summon ====================

    private static int summon(CommandContext<CommandSourceStack> ctx) {
        CommandSourceStack src = ctx.getSource();
        MinecraftServer server = src.getServer();
        String ownerStr = StringArgumentType.getString(ctx, "owner");
        String name = StringArgumentType.getString(ctx, "name");
        UUID ownerUuid;
        try {
            ownerUuid = UUID.fromString(ownerStr);
        } catch (IllegalArgumentException ex) {
            src.sendFailure(Component.literal("bad owner uuid: " + ownerStr));
            return 0;
        }
        ServerLevel level = server.overworld();
        Vec3 pos = Vec3.atCenterOf(level.getSharedSpawnPos());
        NumenPlayer body = Companions.summon(server, ownerUuid, name, level, pos);
        if (body == null) {
            src.sendFailure(Component.literal("summon failed: " + name));
            return 0;
        }
        src.sendSuccess(() -> Component.literal(
                "summoned=" + name + "|uuid=" + body.getUUID()), false);
        return 1;
    }

    // ==================== restore-existing ====================

    // The command the survivor's reconnect path calls. It used to be added by a patch to
    // the core; it lives here now, in our own module, so the core can stay upstream's.
    // The reply envelope is deliberately identical to the old one, because the reconnect
    // module's tested safety (unknown outcomes are never replayed, a reservation is never
    // re-dispatched) is written against exactly this shape.
    private static final String RESTORE_PREFIX = "QD_NUMEN_RESTORE_JSON ";

    private static void registerRestore(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("numen_restore_existing")
                .then(Commands.argument("uuid", StringArgumentType.string())
                .then(Commands.argument("owner", StringArgumentType.string())
                .then(Commands.argument("name", StringArgumentType.string())
                .executes(NumenActCommand::restoreExisting)))));
    }

    private static int restoreExisting(CommandContext<CommandSourceStack> ctx) {
        CommandSourceStack src = ctx.getSource();
        MinecraftServer server = src.getServer();
        String uuidStr = StringArgumentType.getString(ctx, "uuid");
        String ownerStr = StringArgumentType.getString(ctx, "owner");
        String name = StringArgumentType.getString(ctx, "name");
        UUID bodyUuid, ownerUuid;
        try {
            bodyUuid = UUID.fromString(uuidStr);
            ownerUuid = UUID.fromString(ownerStr);
        } catch (IllegalArgumentException ex) {
            return emitRestore(src, false, "rejected", "identity_invalid", uuidStr, ownerStr, name);
        }
        // Already in the world: the only honest phase is the observation itself.
        for (ServerPlayer p : server.getPlayerList().getPlayers()) {
            if (p instanceof NumenPlayer np && np.getUUID().equals(bodyUuid)) {
                return emitRestore(src, true, "observed", "", uuidStr, ownerStr, name);
            }
        }
        CompanionRegistry.Entry entry = CompanionRegistry.get(server).find(bodyUuid);
        if (entry == null) {
            // No catalogue entry: there is no saved body to bring back, and summoning a
            // fresh one would invent a companion. Refuse instead.
            return emitRestore(src, false, "rejected", "playerdata_unavailable", uuidStr, ownerStr, name);
        }
        if (!entry.owner().equals(ownerUuid) || !entry.name().equals(name)) {
            return emitRestore(src, false, "rejected", "identity_mismatch", uuidStr, ownerStr, name);
        }
        ServerLevel level = server.overworld();
        Vec3 pos = Vec3.atCenterOf(entry.pos());
        NumenPlayer body = Companions.summon(server, ownerUuid, name, level, pos);
        if (body == null || !body.getUUID().equals(bodyUuid)) {
            return emitRestore(src, false, "rejected", "restore_rejected", uuidStr, ownerStr, name);
        }
        return emitRestore(src, true, "restored", "", uuidStr, ownerStr, name);
    }

    private static int emitRestore(CommandSourceStack src, boolean ok, String phase, String code,
                                   String uuidStr, String ownerStr, String name) {
        String out = RESTORE_PREFIX + "{\"schema\":1,\"capability\":\"existing_body_restore_v1\""
                + ",\"bodyUuid\":\"" + uuidStr + "\""
                + ",\"ownerUuid\":\"" + ownerStr + "\""
                + ",\"bodyName\":\"" + name + "\""
                + ",\"ok\":" + ok
                + ",\"phase\":\"" + phase + "\""
                + ",\"code\":\"" + code + "\"}";
        src.sendSuccess(() -> Component.literal(out), false);
        return ok ? 1 : 0;
    }

    // ==================== invoke ====================

    private static int invoke(CommandContext<CommandSourceStack> ctx) {
        CommandSourceStack src = ctx.getSource();
        MinecraftServer server = src.getServer();
        String companionName = StringArgumentType.getString(ctx, "companion");
        String toolName = StringArgumentType.getString(ctx, "tool");
        String argsJson = StringArgumentType.getString(ctx, "args");

        NumenPlayer companion = findCompanion(server, companionName);
        if (companion == null) {
            src.sendFailure(Component.literal("no companion: " + companionName));
            return 0;
        }
        NumenTool tool = ToolRegistry.get(toolName);
        if (tool == null) {
            src.sendFailure(Component.literal("no tool: " + toolName));
            return 0;
        }
        JsonObject args;
        try {
            args = JsonParser.parseString(argsJson).getAsJsonObject();
        } catch (Exception ex) {
            src.sendFailure(Component.literal("bad json args: " + ex.getMessage()));
            return 0;
        }

        String callId = com.dwinovo.numen.task.TaskRecord.EXTERNAL_CALL_PREFIX + UUID.randomUUID();
        // 查询型当场回、动作型(setTask)受理即回 task_id，均在本线程回调；异步 runSync
        // 类工具（当前无调用方）才会 null，兜底回受理提示。
        String[] result = new String[1];
        try {
            tool.onServerCall(callId, args, companion, reply -> result[0] = reply);
        } catch (Exception ex) {
            src.sendFailure(Component.literal("invoke error: " + ex));
            return 0;
        }
        String replyStr = result[0] != null ? result[0]
                : "{\"accepted\":true,\"note\":\"no immediate reply (async tool)\"}";
        src.sendSuccess(() -> Component.literal(replyStr), false);
        return 1;
    }

    // ==================== skin ====================

    /** 无签名变体（value 传 "clear" 清皮肤回到默认）。 */
    private static int skinNoSig(CommandContext<CommandSourceStack> ctx) {
        return applySkin(ctx, "");
    }

    private static int skin(CommandContext<CommandSourceStack> ctx) {
        return applySkin(ctx, StringArgumentType.getString(ctx, "signature"));
    }

    /**
     * 换肤主流程：registry 记 withSkin → 在线身体 dormant+respawn 无缝重穿（位置/背包/任务
     * 原样——respawn 从 .dat 恢复，重放任务记录）。value="clear" 表示清空皮肤。
     * value/signature 来自 MineSkin 等（Mojang 签名的 textures 属性对）。
     */
    private static int applySkin(CommandContext<CommandSourceStack> ctx, String signature) {
        CommandSourceStack src = ctx.getSource();
        MinecraftServer server = src.getServer();
        String name = StringArgumentType.getString(ctx, "companion");
        String value = StringArgumentType.getString(ctx, "value");
        boolean clear = "clear".equalsIgnoreCase(value);
        CompanionRegistry registry = CompanionRegistry.get(server);
        UUID found = null;
        CompanionRegistry.Entry hit = null;
        for (Map.Entry<UUID, CompanionRegistry.Entry> e : registry.all()) {
            if (e.getValue().name().equals(name)) { found = e.getKey(); hit = e.getValue(); break; }
        }
        if (found == null) {
            src.sendFailure(Component.literal("no companion in registry: " + name));
            return 0;
        }
        registry.put(found, clear ? hit.withSkin("", "") : hit.withSkin(value, signature));
        // 在线身体：dormant 落档 + respawn 换装（带新 profile 重新广播 player info）。
        boolean refreshed = false;
        if (server.getPlayerList().getPlayerByName(name) instanceof NumenPlayer body) {
            Companions.dormant(server, body);
            NumenPlayer back = Companions.respawn(server, found);
            refreshed = back != null;
        }
        String out = "skin " + (clear ? "cleared" : "set") + " for " + name
                + (refreshed ? "|body_refreshed" : "|applies_on_next_summon");
        src.sendSuccess(() -> Component.literal(out), false);
        return 1;
    }

    // ==================== dismiss ====================

    private static int dismiss(CommandContext<CommandSourceStack> ctx) {
        CommandSourceStack src = ctx.getSource();
        MinecraftServer server = src.getServer();
        String companionName = StringArgumentType.getString(ctx, "companion");
        NumenPlayer companion = findCompanion(server, companionName);
        if (companion == null) {
            src.sendFailure(Component.literal("no companion: " + companionName));
            return 0;
        }
        Companions.dismiss(server, companion);
        src.sendSuccess(() -> Component.literal("dismissed=" + companionName), false);
        return 1;
    }

    // ==================== say ====================

    /** 让假玩家以本人身份在公屏发言（别的玩家看到 {@code <桐人> 你好}）。 */
    private static int say(CommandContext<CommandSourceStack> ctx) {
        CommandSourceStack src = ctx.getSource();
        MinecraftServer server = src.getServer();
        String companionName = StringArgumentType.getString(ctx, "companion");
        String message = StringArgumentType.getString(ctx, "message");

        NumenPlayer companion = findCompanion(server, companionName);
        if (companion == null) {
            src.sendFailure(Component.literal("no companion: " + companionName));
            return 0;
        }
        if (message == null || message.isBlank()) {
            src.sendFailure(Component.literal("empty message"));
            return 0;
        }
        if (message.length() > 256) {
            message = message.substring(0, 256);
        }
        doSay(server, companion, message);
        src.sendSuccess(() -> Component.literal("said=" + companionName), false);
        return 1;
    }

    /**
     * 公屏发言原语（命令树与 {@link GodChannel} 共用）。
     *
     * <p>假玩家没有真实连接，原版 {@code ServerPlayer.chat()} 走 connection 会空转；
     * 这里直接构造无签名 {@link PlayerChatMessage} 经 {@code broadcastChatMessage}
     * 广播——该路径对假玩家的 no-op connection 是空操作，对真人玩家正常送达。
     */
    static void doSay(MinecraftServer server, NumenPlayer companion, String message) {
        PlayerChatMessage chatMessage = PlayerChatMessage.unsigned(companion.getUUID(), message);
        server.getPlayerList().broadcastChatMessage(
                chatMessage, companion, ChatType.bind(ChatType.CHAT, companion));
    }

    // ==================== whisper ====================

    /**
     * 让假玩家向目标玩家（通常是 Goddess 化身）私语——这是假玩家「咏唱」的唯一通道。
     * 假玩家没有真实连接，无法自己 {@code /msg Goddess <咒语>}，走 {@link #doWhisper} 原语。
     */
    private static int whisper(CommandContext<CommandSourceStack> ctx) {
        CommandSourceStack src = ctx.getSource();
        MinecraftServer server = src.getServer();
        String companionName = StringArgumentType.getString(ctx, "companion");
        String targetName = StringArgumentType.getString(ctx, "target");
        String message = StringArgumentType.getString(ctx, "message");

        NumenPlayer companion = findCompanion(server, companionName);
        if (companion == null) {
            src.sendFailure(Component.literal("no companion: " + companionName));
            return 0;
        }
        ServerPlayer target = server.getPlayerList().getPlayerByName(targetName);
        if (target == null) {
            src.sendFailure(Component.literal("no target player: " + targetName));
            return 0;
        }
        if (message == null || message.isBlank()) {
            src.sendFailure(Component.literal("empty message"));
            return 0;
        }
        if (message.length() > 256) {
            message = message.substring(0, 256);
        }
        doWhisper(server, companion, target, message);
        src.sendSuccess(() -> Component.literal("whispered=" + companionName + "->" + targetName), false);
        return 1;
    }

    /**
     * 私语原语（命令树与 {@link GodChannel} 共用）。
     *
     * <p>对齐原版 /msg（MsgCommand.sendMessage）：incoming 私语直接发给目标玩家，
     * Bound 用发话人（假玩家）的 CommandSourceStack 构造——name=假玩家本人，渲染「假玩家 whispers to you」，
     * 目标客户端（mineflayer）据此触发 whisper 事件 → sniffChant → castSpell。
     */
    static void doWhisper(MinecraftServer server, NumenPlayer companion, ServerPlayer target, String message) {
        PlayerChatMessage chatMessage = PlayerChatMessage.unsigned(companion.getUUID(), message);
        ChatType.Bound incomingBound = ChatType.bind(
                ChatType.MSG_COMMAND_INCOMING, companion.createCommandSourceStack());
        OutgoingChatMessage outgoing = OutgoingChatMessage.create(chatMessage);
        target.sendChatMessage(outgoing, false, incomingBound);
    }

    // ==================== dumpregistry ====================

    /**
     * 导出服务器**全量**块状态注册表（原版 + mod）到 {@code <serverDir>/block-registry.json}。
     *
     * <p>动机：mineflayer / 网页 modern-viewer 用原版 minecraft-data 查不到 mod 块的 stateId
     * （超过原版上界），导致 mod 方块解码成空气/未知。本命令把服务端运行时块状态注册表
     * 落盘：
     *
     * <pre>
     *   {
     *     "minecraftVersion": "1.21.1",
     *     "generatedAt": &lt;epoch&gt;,
     *     "blockStates": [ {"stateId":&lt;int&gt;, "block":"ns:path", "properties":{"facing":"north",...}} ],
     *     "blocks":      [ {"name":"ns:path", "minStateId":&lt;int&gt;, "maxStateId":&lt;int&gt;, "defaultState":&lt;int&gt;} ]
     *   }
     * </pre>
     *
     * <p>stateId = {@link Block.BLOCK_STATE_REGISTRY#getId(BlockState)}，即区块 palette / mineflayer
     * {@code blocksByStateId} 的键；必须导出**全**注册表（不能只取 mod 块），否则 {@code maxBitsPerBlock}
     * 与该表的偏移会对不上。atomic tmp+rename 落盘。
     */
    private static int dumpRegistry(CommandContext<CommandSourceStack> ctx) {
        CommandSourceStack src = ctx.getSource();
        MinecraftServer server = src.getServer();

        JsonArray blockStates = new JsonArray();
        JsonArray blocks = new JsonArray();
        for (Block block : BuiltInRegistries.BLOCK) {
            String blockName = BuiltInRegistries.BLOCK.getKey(block).toString();
            JsonObject blockRec = new JsonObject();
            blockRec.addProperty("name", blockName);
            int min = Integer.MAX_VALUE, max = Integer.MIN_VALUE;
            int defaultId = Block.BLOCK_STATE_REGISTRY.getId(block.defaultBlockState());
            for (BlockState state : block.getStateDefinition().getPossibleStates()) {
                int id = Block.BLOCK_STATE_REGISTRY.getId(state);
                if (id < min) min = id;
                if (id > max) max = id;
                JsonObject rec = new JsonObject();
                rec.addProperty("stateId", id);
                rec.addProperty("block", blockName);
                JsonObject props = new JsonObject();
                for (Map.Entry<Property<?>, Comparable<?>> e : state.getValues().entrySet()) {
                    props.addProperty(e.getKey().getName(), String.valueOf(e.getValue()));
                }
                rec.add("properties", props);
                blockStates.add(rec);
            }
            if (min == Integer.MAX_VALUE) { min = defaultId; max = defaultId; }
            blockRec.addProperty("minStateId", min);
            blockRec.addProperty("maxStateId", max);
            blockRec.addProperty("defaultState", defaultId);
            blocks.add(blockRec);
        }

        JsonObject root = new JsonObject();
        root.addProperty("minecraftVersion", "1.21.1");
        root.addProperty("generatedAt", System.currentTimeMillis());
        root.add("blockStates", blockStates);
        root.add("blocks", blocks);

        try {
            Path dir = server.getServerDirectory();
            Path target = dir.resolve("block-registry.json");
            Path tmp = dir.resolve("block-registry.json.tmp");
            Files.writeString(tmp, root.toString(), StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
            try {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (java.nio.file.AtomicMoveNotSupportedException ex) {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
            }
            src.sendSuccess(() -> Component.literal(
                    "dumpregistry ok: states=" + blockStates.size() + " blocks=" + blocks.size()
                    + " -> " + target), false);
            return 1;
        } catch (IOException ex) {
            src.sendFailure(Component.literal("dumpregistry error: " + ex.getMessage()));
            return 0;
        }
    }

    // ==================== helper ====================

    static NumenPlayer findCompanion(MinecraftServer server, String name) {
        for (ServerPlayer p : server.getPlayerList().getPlayers()) {
            if (p instanceof NumenPlayer np && np.getName().getString().equals(name)) {
                return np;
            }
        }
        return null;
    }
}
