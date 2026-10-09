package dev.qiandeng.maw;

import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.Companions;
import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.program.CallObserver;
import com.dwinovo.numen.program.ModuleSet;
import com.dwinovo.numen.program.NetworkTransport;
import com.dwinovo.numen.program.ServerPrograms;
import com.dwinovo.numen.sdk.ApiFunction;
import com.dwinovo.numen.sdk.ApiRegistry;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.TickTask;
import net.minecraft.world.level.storage.LevelResource;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;

/** Operator transport for the official Lua engine; the player's MCP remains client-owned. */
final class NumenBodyBridge {
    private static final String SESSION = UUID.randomUUID().toString();
    private NumenBodyBridge() {}

    static LiteralArgumentBuilder<CommandSourceStack> luaNode() {
        return Commands.literal("lua").then(Commands.argument("bodyUuid", StringArgumentType.word())
                .then(Commands.argument("actionId", StringArgumentType.word())
                        .then(Commands.argument("program", StringArgumentType.greedyString())
                                .executes(NumenBodyBridge::lua))));
    }

    static LiteralArgumentBuilder<CommandSourceStack> restoreNode() {
        return Commands.literal("restore").then(Commands.argument("bodyUuid", StringArgumentType.word())
                .executes(ctx -> lifecycle(ctx, false)));
    }

    static LiteralArgumentBuilder<CommandSourceStack> dormantNode() {
        return Commands.literal("dormant").then(Commands.argument("bodyUuid", StringArgumentType.word())
                .executes(ctx -> lifecycle(ctx, true)));
    }

    static LiteralArgumentBuilder<CommandSourceStack> operationsNode() {
        return Commands.literal("operations").executes(ctx -> operations(ctx, null))
                .then(Commands.argument("group", StringArgumentType.word())
                        .executes(ctx -> operations(ctx, StringArgumentType.getString(ctx, "group"))));
    }

    private static JsonObject base(String action) {
        JsonObject out = new JsonObject();
        out.addProperty("schemaVersion", 1); out.addProperty("provider", "numen_lua");
        out.addProperty("numenVersion", "0.1.4.1"); out.addProperty("action", action);
        out.addProperty("sampledAt", java.time.Instant.now().toString());
        out.addProperty("retryAutomatically", false);
        return out;
    }

    private static int reply(CommandSourceStack source, JsonObject out) {
        source.sendSuccess(() -> Component.literal("MAW_AGENT " + out), false);
        return out.has("ok") && out.get("ok").getAsBoolean() ? 1 : 0;
    }

    private static int fail(CommandSourceStack source, String action, String code) {
        JsonObject out = base(action); out.addProperty("ok", false); out.addProperty("code", code);
        return reply(source, out);
    }

    private static int operations(CommandContext<CommandSourceStack> ctx, String group) {
        JsonObject out = base("operations"); JsonArray rows = new JsonArray();
        if (group == null) {
            for (var g : ApiRegistry.groups()) {
                JsonObject row = new JsonObject(); row.addProperty("id", g.fullName());
                row.addProperty("description", g.summary()); row.addProperty("count", g.functions().size());
                rows.add(row);
            }
            out.add("groups", rows); out.addProperty("totalFunctions", ApiRegistry.functions().size());
        } else {
            var g = ApiRegistry.group(group);
            if (g == null) return fail(ctx.getSource(), "operations", "unknown_group");
            for (ApiFunction f : g.functions()) {
                JsonObject row = new JsonObject(); row.addProperty("id", f.fullName());
                row.addProperty("description", f.summary()); row.addProperty("side", f.side().name().toLowerCase());
                row.addProperty("execution", f.kind().toString());
                row.addProperty("returns", f.returns().type().toString());
                JsonArray params = new JsonArray();
                for (var p : f.params()) {
                    JsonObject param = new JsonObject(); param.addProperty("name", p.name());
                    param.addProperty("role", p.role().name().toLowerCase());
                    param.addProperty("type", p.type().toString()); param.addProperty("description", p.explained());
                    params.add(param);
                }
                row.add("parameters", params); JsonArray examples = new JsonArray();
                f.examples().stream().limit(3).forEach(examples::add); row.add("examples", examples); rows.add(row);
            }
            out.add("functions", rows);
        }
        out.addProperty("ok", true); out.addProperty("permission", "operator_level_4_transport_native_owner_rules_still_apply");
        out.addProperty("officialMcpLocation", "owner_java_client");
        return reply(ctx.getSource(), out);
    }

    private static UUID bodyId(CommandContext<CommandSourceStack> ctx) {
        return UUID.fromString(StringArgumentType.getString(ctx, "bodyUuid"));
    }

    private static int lifecycle(CommandContext<CommandSourceStack> ctx, boolean dormant) {
        var source = ctx.getSource(); String action = dormant ? "dormant" : "restore";
        UUID uuid;
        try { uuid = bodyId(ctx); } catch (IllegalArgumentException e) { return fail(source, action, "invalid_body_uuid"); }
        var server = source.getServer(); var entry = CompanionRegistry.get(server).find(uuid);
        if (entry == null) return fail(source, action, "unknown_body_no_replacement_created");
        NumenPlayer body = NumenPlayer.findByUuid(server, uuid);
        if (dormant) {
            if (body != null) Companions.dormant(server, body);
        } else {
            if (body == null && !Files.isRegularFile(server.getWorldPath(LevelResource.ROOT)
                    .resolve("playerdata").resolve(uuid + ".dat"))) {
                return fail(source, action, "saved_body_missing_no_replacement_created");
            }
            if (!entry.taskName().isEmpty() || !entry.taskLua().isEmpty()) {
                return fail(source, action, "saved_task_requires_owner_review_before_restore");
            }
            body = Companions.respawn(server, uuid);
            if (body == null || !uuid.equals(body.getUUID())) return fail(source, action, "restore_failed_no_replacement_created");
        }
        JsonObject out = base(action); out.addProperty("ok", true); out.addProperty("bodyUuid", uuid.toString());
        out.addProperty("ownerUuid", entry.owner().toString()); out.addProperty("name", entry.name());
        out.addProperty("online", !dormant); out.addProperty("inventoryPreserved", true);
        return reply(source, out);
    }

    private static Path record(CommandSourceStack source, UUID body, String actionId) {
        if (!actionId.matches("[A-Za-z0-9._-]{1,64}")) throw new IllegalArgumentException("invalid_action_id");
        return source.getServer().getWorldPath(LevelResource.ROOT).resolve("maw-numen-actions")
                .resolve(body.toString()).resolve(actionId + ".json");
    }

    private static String hash(String code) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(code.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    private static void write(Path path, JsonObject out, boolean fresh) throws IOException {
        Files.createDirectories(path.getParent());
        Path target = fresh ? path : path.resolveSibling(path.getFileName() + ".tmp-" + UUID.randomUUID());
        try (FileChannel channel = FileChannel.open(target, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            ByteBuffer bytes = StandardCharsets.UTF_8.encode(out.toString());
            while (bytes.hasRemaining()) channel.write(bytes);
            channel.force(true);
        }
        if (!fresh) Files.move(target, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }

    private static JsonObject read(Path path) throws IOException {
        JsonObject out = JsonParser.parseString(Files.readString(path, StandardCharsets.UTF_8)).getAsJsonObject();
        if (!out.get("session").getAsString().equals(SESSION) && !out.get("phase").getAsString().equals("terminal")) {
            out.addProperty("phase", "unknown"); out.addProperty("code", "interrupted_result_unknown_do_not_replay");
            out.addProperty("ok", false);
        }
        out.addProperty("sampledAt", java.time.Instant.now().toString());
        return out;
    }

    static int receipt(CommandContext<CommandSourceStack> ctx) {
        var source = ctx.getSource();
        try {
            Path p = record(source, bodyId(ctx), StringArgumentType.getString(ctx, "callId"));
            if (!Files.isRegularFile(p)) return fail(source, "receipt", "unknown_action");
            return reply(source, read(p));
        } catch (IllegalArgumentException e) { return fail(source, "receipt", "invalid_body_or_action_id"); }
        catch (IOException | RuntimeException e) { return fail(source, "receipt", "receipt_unavailable_no_retry"); }
    }

    private static int lua(CommandContext<CommandSourceStack> ctx) {
        var source = ctx.getSource(); UUID uuid; Path path;
        String actionId = StringArgumentType.getString(ctx, "actionId");
        String code = StringArgumentType.getString(ctx, "program");
        if (code.getBytes(StandardCharsets.UTF_8).length > 8192) return fail(source, "lua", "program_too_large");
        try { uuid = bodyId(ctx); path = record(source, uuid, actionId); }
        catch (IllegalArgumentException e) { return fail(source, "lua", "invalid_body_or_action_id"); }
        String fingerprint = hash(code);
        try {
            if (Files.exists(path)) {
                JsonObject prior = read(path);
                if (!prior.get("programSha256").getAsString().equals(fingerprint)) return fail(source, "lua", "action_id_conflict");
                prior.addProperty("cached", true); return reply(source, prior);
            }
        } catch (IOException | RuntimeException e) { return fail(source, "lua", "receipt_unavailable_no_retry"); }
        NumenPlayer body = NumenPlayer.findByUuid(source.getServer(), uuid);
        if (body == null) return fail(source, "lua", "body_offline");
        if (!body.isAlive()) return fail(source, "lua", "body_dead");
        if (!ServerPrograms.idle(uuid)) return fail(source, "lua", "body_program_busy");
        JsonObject intent = base("lua"); intent.addProperty("ok", true); intent.addProperty("bodyUuid", uuid.toString());
        intent.addProperty("ownerUuid", body.getOwnerUuid().toString()); intent.addProperty("actionId", actionId);
        intent.addProperty("callId", actionId); intent.addProperty("programSha256", fingerprint);
        intent.addProperty("session", SESSION); intent.addProperty("phase", "accepted"); intent.addProperty("finalKnown", false);
        try { write(path, intent, true); }
        catch (IOException e) { return fail(source, "lua", "intent_not_durable_no_dispatch"); }
        // Like upstream /numen drive: leave the command stack before a Lua
        // program can itself dispatch commands. The engine runs off-thread.
        var server = source.getServer();
        server.tell(new TickTask(server.getTickCount(), () -> ServerPrograms.run(body, uuid, body.getOwnerUuid(),
                new ServerPrograms.Request(actionId, code, ModuleSet.factory(), true), NetworkTransport.INSTANCE,
                CallObserver.NONE, result -> {
                    JsonObject terminal = intent.deepCopy(); terminal.addProperty("phase", "terminal");
                    terminal.addProperty("finalKnown", true);
                    JsonObject outcome = JsonParser.parseString(result.toJson()).getAsJsonObject();
                    terminal.add("outcome", outcome);
                    terminal.addProperty("ok", outcome.has("receipt")
                            && JsonParser.parseString(outcome.get("receipt").getAsString()).getAsJsonObject().get("success").getAsBoolean());
                    terminal.addProperty("completedAt", java.time.Instant.now().toString());
                    try { write(path, terminal, false); }
                    catch (IOException e) { /* Keep the original durable intent unknown, never replay it. */ }
                })));
        return reply(source, intent);
    }
}
