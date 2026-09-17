package com.dwinovo.numen.actuator;

import com.dwinovo.numen.agent.tool.NumenTool;
import com.dwinovo.numen.agent.tool.ToolRegistry;
import com.dwinovo.numen.entity.Companions;
import com.dwinovo.numen.entity.NumenPlayer;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 神使通道（God Channel）—— 创世天神对服务器的进程内控制面，v1 文件传输。
 *
 * <p>动机：RCON 走网络+密码+单连接，容器化后还要穿端口映射，断连/凭据/并发都是坑。
 * 本通道零网络、零认证——女神侧进程与服务器同机（docker bind mount 共享 /data），
 * 以文件队列交换指令与回执：
 *
 * <pre>
 *   &lt;serverDir&gt;/god-channel/
 *     inbox/            女神写入的请求（一行 JSON 一文件：{"id","cmd",...}）
 *     inbox/processed/  已处理请求归档（只进不出，防重复执行）
 *     outbox/           回执（&lt;id&gt;.json：{"id","ok","result"/"error","ts"}）
 *     history.jsonl     审计台账：每处理一条追加一行
 *                       {"ts","id","cmd","ok","ms","error"?}，5MB 轮转留一份 .1
 *     world-status.json 世界信标（每 5s 原子覆写：天数/天气/玩家/假玩家/心跳）
 * </pre>
 *
 * <p>动词表（与 /numen_act 同源，另加 exec 通用命令）：
 * list / summon / invoke / dismiss / say / whisper / exec / status。
 *
 * <p>协议要点：单写者（女神侧写 inbox，服务器侧写 outbox/processed/status）；
 * 请求文件由写方 tmp+rename 原子落盘；处理即归档，失败也归档（不自动重试，
 * 重试语义留给女神）；每次轮询至多 {@value #MAX_BATCH} 件，防长尾卡顿。
 *
 * <p>传输层可换：接口（动词表 + 请求/回执结构）与传输（文件）分离——将来分机
 * 部署时只换传输层（HTTP/MQTT），上层不变。
 */
public final class GodChannel {

    private static final Logger LOGGER = LoggerFactory.getLogger("numen_act/god-channel");

    private static final int POLL_INBOX_EVERY = 10;    // 10 tick = 0.5s
    private static final int BEACON_EVERY = 100;       // 100 tick = 5s
    private static final int MAX_BATCH = 10;           // 每次轮询至多处理件数
    private static final long MAX_REQ_BYTES = 64 * 1024;
    private static final long MAX_HISTORY_BYTES = 5 * 1024 * 1024;  // 台账 5MB 轮转
    private static final int KEEP_FILES = 300;         // processed/outbox 各保留上限

    private static Path root;
    private static Path inbox;
    private static Path processed;
    private static Path outbox;
    private static Path statusFile;
    private static Path historyFile;
    private static boolean announced = false;

    private GodChannel() {}

    // ==================== tick 入口 ====================

    public static void onServerTick(ServerTickEvent.Post event) {
        MinecraftServer server = event.getServer();
        int tick = server.getTickCount();
        if (tick % POLL_INBOX_EVERY == 0) {
            try {
                pollInbox(server);
            } catch (Exception e) {
                LOGGER.warn("[numen_act] god-channel inbox poll error: {}", e.toString());
            }
        }
        if (tick % BEACON_EVERY == 0) {
            try {
                writeBeacon(server);
            } catch (Exception e) {
                LOGGER.warn("[numen_act] god-channel beacon error: {}", e.toString());
            }
        }
    }

    // ==================== inbox 轮询 ====================

    private static void ensureDirs(MinecraftServer server) throws IOException {
        if (root != null) return;
        root = server.getServerDirectory().resolve("god-channel");
        inbox = root.resolve("inbox");
        processed = inbox.resolve("processed");
        outbox = root.resolve("outbox");
        statusFile = root.resolve("world-status.json");
        historyFile = root.resolve("history.jsonl");
        Files.createDirectories(processed);
        Files.createDirectories(outbox);
        if (!announced) {
            announced = true;
            LOGGER.info("[numen_act] god-channel ready at {}", root.toAbsolutePath());
        }
    }

    private static void pollInbox(MinecraftServer server) throws IOException {
        ensureDirs(server);
        List<Path> files;
        try (Stream<Path> st = Files.list(inbox)) {
            files = st.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".json"))
                    .sorted(Comparator.comparing(p -> p.getFileName().toString()))
                    .limit(MAX_BATCH)
                    .collect(Collectors.toList());
        }
        for (Path f : files) {
            try {
                processOne(server, f);
            } catch (Exception e) {
                LOGGER.warn("[numen_act] god-channel process {} error: {}", f.getFileName(), e.toString());
            }
        }
        if (!files.isEmpty()) {
            cleanup(processed);
            cleanup(outbox);
        }
    }

    private static void processOne(MinecraftServer server, Path f) throws IOException {
        String id = stripJsonExt(f.getFileName().toString());
        String cmd = "";
        long startMs = System.currentTimeMillis();
        JsonObject resp;
        try {
            if (Files.size(f) > MAX_REQ_BYTES) {
                resp = errorResp("request too large (>64KB)");
            } else {
                String body = Files.readString(f, StandardCharsets.UTF_8);
                JsonObject req = JsonParser.parseString(body).getAsJsonObject();
                if (req.has("id")) {
                    String reqId = req.get("id").getAsString();
                    if (reqId != null && !reqId.isBlank()) id = reqId.trim();
                }
                cmd = req.has("cmd")
                        ? (req.get("cmd").isJsonPrimitive()
                                ? req.get("cmd").getAsString()
                                : String.valueOf(req.get("cmd")))
                        : "";
                resp = dispatch(server, req);
            }
        } catch (Exception e) {
            resp = errorResp("bad request: " + e);
        }
        long durMs = System.currentTimeMillis() - startMs;
        resp.addProperty("id", id);
        resp.addProperty("ts", System.currentTimeMillis());
        writeJsonAtomic(outbox.resolve(sanitize(id) + ".json"), resp);
        audit(id, cmd, resp, durMs);
        moveSafe(f, processed.resolve(f.getFileName()));
    }

    /**
     * 审计台账：每处理一条追加一行 JSONL（时间/id/动词/成败/耗时/错误），
     * 解决「哪条处理了哪条没处理」的索引问题——单文件、可 grep、超 5MB 轮转。
     */
    private static void audit(String id, String cmd, JsonObject resp, long durMs) {
        try {
            JsonObject line = new JsonObject();
            line.addProperty("ts", System.currentTimeMillis());
            line.addProperty("id", id);
            line.addProperty("cmd", cmd);
            line.addProperty("ok", resp.has("ok") && resp.get("ok").getAsBoolean());
            line.addProperty("ms", durMs);
            if (resp.has("error")) {
                line.addProperty("error", resp.get("error").getAsString());
            }
            rotateIfNeeded(historyFile);
            Files.writeString(historyFile, line + System.lineSeparator(),
                    StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            LOGGER.warn("[numen_act] god-channel audit error: {}", e.toString());
        }
    }

    /** 台账超限时轮转：旧账改名 .1 保留一份，再超则覆盖。 */
    private static void rotateIfNeeded(Path f) throws IOException {
        if (Files.exists(f) && Files.size(f) > MAX_HISTORY_BYTES) {
            Files.move(f, f.resolveSibling(f.getFileName() + ".1"),
                    StandardCopyOption.REPLACE_EXISTING);
        }
    }

    // ==================== 动词分发 ====================

    private static JsonObject dispatch(MinecraftServer server, JsonObject req) {
        String cmd = req.has("cmd") ? req.get("cmd").getAsString() : "";
        JsonObject resp = new JsonObject();
        try {
            switch (cmd) {
                case "list" -> resp.addProperty("result", doList(server));
                case "status" -> resp.add("result", buildStatus(server));
                case "summon" -> resp.addProperty("result", doSummon(server, req));
                case "invoke" -> resp.addProperty("result", doInvoke(server, req));
                case "dismiss" -> resp.addProperty("result", doDismiss(server, req));
                case "say" -> resp.addProperty("result", doSayCmd(server, req));
                case "whisper" -> resp.addProperty("result", doWhisperCmd(server, req));
                case "exec" -> resp.addProperty("result", doExec(server, req));
                default -> throw new IllegalArgumentException("unknown cmd: " + cmd);
            }
            resp.addProperty("ok", true);
        } catch (Exception e) {
            resp.addProperty("ok", false);
            resp.addProperty("error", String.valueOf(e.getMessage()));
        }
        return resp;
    }

    private static String doList(MinecraftServer server) {
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
        sb.insert(0, "count=" + count + "\n");
        return sb.toString();
    }

    private static String doSummon(MinecraftServer server, JsonObject req) {
        UUID ownerUuid = UUID.fromString(req.get("owner").getAsString());
        String name = req.get("name").getAsString();
        ServerLevel level = server.overworld();
        Vec3 pos = Vec3.atCenterOf(level.getSharedSpawnPos());
        NumenPlayer body = Companions.summon(server, ownerUuid, name, level, pos);
        if (body == null) throw new IllegalStateException("summon failed: " + name);
        return "summoned=" + name + "|uuid=" + body.getUUID();
    }

    private static String doInvoke(MinecraftServer server, JsonObject req) {
        NumenPlayer companion = needCompanion(server, req);
        String toolName = req.get("tool").getAsString();
        NumenTool tool = ToolRegistry.get(toolName);
        if (tool == null) throw new IllegalArgumentException("no tool: " + toolName);
        JsonObject args = req.has("args") && req.get("args").isJsonObject()
                ? req.getAsJsonObject("args") : new JsonObject();
        String callId = UUID.randomUUID().toString();
        String[] result = new String[1];
        tool.onServerCall(callId, args, companion, reply -> result[0] = reply);
        return result[0] != null ? result[0]
                : "{\"accepted\":true,\"note\":\"no immediate reply (async tool)\"}";
    }

    private static String doDismiss(MinecraftServer server, JsonObject req) {
        NumenPlayer companion = needCompanion(server, req);
        Companions.dismiss(server, companion);
        return "dismissed=" + companion.getName().getString();
    }

    private static String doSayCmd(MinecraftServer server, JsonObject req) {
        NumenPlayer companion = needCompanion(server, req);
        String message = clip(req.get("message").getAsString());
        NumenActCommand.doSay(server, companion, message);
        return "said=" + companion.getName().getString();
    }

    private static String doWhisperCmd(MinecraftServer server, JsonObject req) {
        NumenPlayer companion = needCompanion(server, req);
        String targetName = req.get("target").getAsString();
        ServerPlayer target = server.getPlayerList().getPlayerByName(targetName);
        if (target == null) throw new IllegalArgumentException("no target player: " + targetName);
        String message = clip(req.get("message").getAsString());
        NumenActCommand.doWhisper(server, companion, target, message);
        return "whispered=" + companion.getName().getString() + "->" + targetName;
    }

    /** 通用控制台命令（time/weather/give/tp/broadcast……），与 RCON 同级权限。 */
    private static String doExec(MinecraftServer server, JsonObject req) {
        String command = req.get("command").getAsString();
        if (command == null || command.isBlank()) throw new IllegalArgumentException("empty command");
        if (command.length() > 512) command = command.substring(0, 512);
        server.getCommands().performPrefixedCommand(server.createCommandSourceStack(), command);
        return "executed: " + command;
    }

    // ==================== 世界信标 ====================

    private static void writeBeacon(MinecraftServer server) throws IOException {
        ensureDirs(server);
        JsonObject beacon = new JsonObject();
        beacon.addProperty("channel", "god-channel");
        beacon.addProperty("version", 1);
        beacon.add("status", buildStatus(server));
        writeJsonAtomic(statusFile, beacon);
    }

    private static JsonObject buildStatus(MinecraftServer server) {
        JsonObject s = new JsonObject();
        s.addProperty("ts", System.currentTimeMillis());
        s.addProperty("tick", server.getTickCount());
        ServerLevel ow = server.overworld();
        JsonObject world = new JsonObject();
        world.addProperty("dayTime", ow.getDayTime());
        world.addProperty("isDay", ow.isDay());
        world.addProperty("raining", ow.isRaining());
        world.addProperty("thundering", ow.isThundering());
        s.add("overworld", world);
        JsonArray players = new JsonArray();
        for (ServerPlayer p : server.getPlayerList().getPlayers()) {
            JsonObject pj = new JsonObject();
            pj.addProperty("name", p.getName().getString());
            pj.addProperty("uuid", p.getUUID().toString());
            pj.addProperty("companion", p instanceof NumenPlayer);
            if (p instanceof NumenPlayer np) {
                pj.addProperty("owner", String.valueOf(np.getOwnerUuid()));
            }
            pj.addProperty("dim", p.level().dimension().location().toString());
            pj.addProperty("x", p.blockPosition().getX());
            pj.addProperty("y", p.blockPosition().getY());
            pj.addProperty("z", p.blockPosition().getZ());
            pj.addProperty("hp", p.getHealth());
            players.add(pj);
        }
        s.add("players", players);
        return s;
    }

    // ==================== 工具 ====================

    private static NumenPlayer needCompanion(MinecraftServer server, JsonObject req) {
        String name = req.get("companion").getAsString();
        NumenPlayer companion = NumenActCommand.findCompanion(server, name);
        if (companion == null) throw new IllegalArgumentException("no companion: " + name);
        return companion;
    }

    private static String clip(String message) {
        if (message == null || message.isBlank()) throw new IllegalArgumentException("empty message");
        return message.length() > 256 ? message.substring(0, 256) : message;
    }

    private static JsonObject errorResp(String msg) {
        JsonObject resp = new JsonObject();
        resp.addProperty("ok", false);
        resp.addProperty("error", msg);
        return resp;
    }

    private static String stripJsonExt(String fileName) {
        return fileName.endsWith(".json") ? fileName.substring(0, fileName.length() - 5) : fileName;
    }

    private static String sanitize(String id) {
        String s = id.replaceAll("[^A-Za-z0-9_.-]", "_");
        return s.length() > 64 ? s.substring(0, 64) : s;
    }

    /** 原子写：tmp + rename，读方永远看不到半截文件。 */
    private static void writeJsonAtomic(Path target, JsonObject json) throws IOException {
        Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
        Files.writeString(tmp, json.toString(), StandardCharsets.UTF_8);
        try {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static void moveSafe(Path src, Path dst) throws IOException {
        try {
            Files.move(src, dst, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(src, dst, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /** 目录文件超过上限时删最旧的（保最新 {@value #KEEP_FILES} 件）。 */
    private static void cleanup(Path dir) {
        try (Stream<Path> st = Files.list(dir)) {
            List<Path> files = st.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".json"))
                    .sorted(Comparator.comparingLong(p -> p.toFile().lastModified()))
                    .collect(Collectors.toList());
            int excess = files.size() - KEEP_FILES;
            for (int i = 0; i < excess; i++) {
                Files.deleteIfExists(files.get(i));
            }
        } catch (IOException ignored) {
            // 清理失败不影响主流程
        }
    }
}
