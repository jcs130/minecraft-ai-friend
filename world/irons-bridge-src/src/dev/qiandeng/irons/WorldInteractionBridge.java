package dev.qiandeng.irons;

import com.dwinovo.numen.agent.tool.api.ToolContext;
import com.dwinovo.numen.core.tools.BlockActionOps;
import com.dwinovo.numen.core.tools.InventoryOps;
import com.dwinovo.numen.core.task.mine.MineBlockTaskRecord;
import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.task.CompanionTickDispatcher;
import com.dwinovo.numen.task.TaskDispatch;
import com.dwinovo.numen.task.TaskRecord;
import com.dwinovo.numen.task.TaskPersistence;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.storage.LevelResource;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Base64;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Keep the original native task's result, including ordinary failed clicks.
 * No new AI, manual body ticking, or replay of an interrupted request. */
public final class WorldInteractionBridge {
    public static final String PREFIX = "QD_WORLD_INTERACTION_JSON ";
    private static final String CAPABILITY = "numen_interaction_receipt_v1";
    private static final Map<String, Pending> PENDING = new HashMap<>();
    private static MinecraftServer currentServer;
    private static String epoch;
    private record Pending(Path file, JsonObject row, TaskRecord task) {}

    private WorldInteractionBridge() {}

    public static void install() {
        NativeDropTask.install();
        NeoForge.EVENT_BUS.addListener(WorldInteractionBridge::tick);
    }

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        var root = Commands.literal("qdworld").requires(s -> s.hasPermission(2));
        root.then(Commands.literal("controls").executes(c -> {
            var out = new JsonObject();
            out.addProperty("schema", 1);
            out.addProperty("capability", "numen_generic_interaction_v1");
            out.addProperty("tool", "interact_at");
            out.addProperty("forwardAim", true);
            out.addProperty("maxHoldTicks", 100);
            out.addProperty("receiptCapability", CAPABILITY);
            c.getSource().sendSuccess(() -> Component.literal(PREFIX + out), false);
            return 1;
        }));
        for (String action : new String[]{"interact", "interaction", "eat", "eating", "drop", "dropping", "mine", "mining"}) {
            String tool = action.equals("mine") || action.equals("mining") ? "mine"
                : action.equals("drop") || action.equals("dropping") ? "drop_items"
                : action.equals("eat") || action.equals("eating") ? "eat" : "interact_at";
            var request = Commands.argument("request", StringArgumentType.word());
            if (action.equals("interact") || action.equals("eat") || action.equals("drop") || action.equals("mine")) request.then(Commands.argument("payload", StringArgumentType.word())
                .executes(c -> run(c.getSource(), StringArgumentType.getString(c, "actor"),
                    StringArgumentType.getString(c, "request"), StringArgumentType.getString(c, "payload"), tool)));
            else request.executes(c -> run(c.getSource(), StringArgumentType.getString(c, "actor"),
                StringArgumentType.getString(c, "request"), null, tool));
            root.then(Commands.literal(action).then(Commands.argument("actor", StringArgumentType.word()).then(request)));
        }
        dispatcher.register(root);
    }

    private static void server(MinecraftServer value) {
        if (currentServer != value) {
            currentServer = value;
            epoch = UUID.randomUUID().toString();
            PENDING.clear();
        }
    }

    private static JsonObject base(String actor, String id, JsonObject args, String tool) {
        var out = new JsonObject();
        out.addProperty("schema", 1);
        out.addProperty("capability", CAPABILITY);
        out.addProperty("actorUuid", actor);
        out.addProperty("requestId", id);
        out.addProperty("epoch", epoch);
        out.addProperty("tool", tool);
        if (args != null) out.add("args", args.deepCopy());
        out.addProperty("observedAt", System.currentTimeMillis());
        return out;
    }

    private static JsonObject rejected(JsonObject out, String code) {
        out.addProperty("status", "rejected");
        out.addProperty("code", code);
        out.addProperty("dispatched", false);
        var result = new JsonObject();
        result.addProperty("success", false);
        result.addProperty("message", code);
        out.add("result", result);
        return out;
    }

    private static JsonObject unknown(JsonObject out, String code) {
        out.addProperty("status", "unknown");
        out.addProperty("code", code);
        out.remove("result");
        return out;
    }

    static JsonObject arguments(String encoded, String tool) {
        if (encoded.length() > 4096 || !encoded.matches("[A-Za-z0-9_=-]+"))
            throw new IllegalArgumentException("invalid_interaction_payload");
        byte[] raw = Base64.getUrlDecoder().decode(encoded);
        if (raw.length > 2048) throw new IllegalArgumentException("invalid_interaction_payload");
        var args = JsonParser.parseString(new String(raw, StandardCharsets.UTF_8)).getAsJsonObject();
        if (tool.equals("mine")) {
            if (!args.keySet().equals(Set.of("block_ids", "count")) || !args.get("block_ids").isJsonArray()
                    || args.getAsJsonArray("block_ids").size() < 1 || args.getAsJsonArray("block_ids").size() > 8
                    || !args.get("count").isJsonPrimitive() || !args.getAsJsonPrimitive("count").isNumber()
                    || !args.get("count").getAsString().matches("[1-8]"))
                throw new IllegalArgumentException("invalid_mine_arguments");
            for (var block : args.getAsJsonArray("block_ids"))
                if (!block.isJsonPrimitive() || !block.getAsJsonPrimitive().isString()
                        || !block.getAsString().matches("[a-z0-9_.-]+:[a-z0-9_./-]{1,100}"))
                    throw new IllegalArgumentException("invalid_mine_block_id");
            return args;
        }
        if (tool.equals("drop_items")) {
            if (!args.keySet().equals(Set.of("item_id", "count"))
                    || !args.get("item_id").isJsonPrimitive() || !args.getAsJsonPrimitive("item_id").isString()
                    || !args.get("item_id").getAsString().matches("[a-z0-9_.-]+:[a-z0-9_./-]{1,100}")
                    || !args.get("count").isJsonPrimitive() || !args.getAsJsonPrimitive("count").isNumber()
                    || !args.get("count").getAsString().matches("[0-9]{1,2}")
                    || args.get("count").getAsInt() < 1 || args.get("count").getAsInt() > 64)
                throw new IllegalArgumentException("invalid_drop_arguments");
            return args;
        }
        if (tool.equals("eat")) {
            if (!args.keySet().equals(Set.of("item_id")) || !args.get("item_id").isJsonPrimitive()
                    || !args.getAsJsonPrimitive("item_id").isString()
                    || !args.get("item_id").getAsString().matches("[a-z0-9_.-]+:[a-z0-9_./-]{1,100}"))
                throw new IllegalArgumentException("invalid_food_arguments");
            return args;
        }
        var required = Set.of("button", "x", "y", "z", "hold_ticks");
        var allowed = Set.of("button", "x", "y", "z", "hold_ticks", "item_id");
        if (!args.keySet().containsAll(required) || !allowed.containsAll(args.keySet())
                || !Set.of("left", "right").contains(args.get("button").getAsString()))
            throw new IllegalArgumentException("invalid_interaction_arguments");
        boolean forward = args.get("x").isJsonNull() && args.get("y").isJsonNull() && args.get("z").isJsonNull();
        for (String key : new String[]{"x", "y", "z", "hold_ticks"}) {
            if (forward && !key.equals("hold_ticks")) continue;
            if (!args.get(key).isJsonPrimitive() || !args.getAsJsonPrimitive(key).isNumber()
                    || !args.get(key).getAsString().matches("-?[0-9]{1,8}"))
                throw new IllegalArgumentException("integer_interaction_coordinates_required");
        }
        if (args.get("hold_ticks").getAsInt() < 0 || args.get("hold_ticks").getAsInt() > 100
                || (!forward && (args.get("y").getAsInt() < -64
                || args.get("y").getAsInt() > 319 || Math.abs(args.get("x").getAsInt()) > 29999984
                || Math.abs(args.get("z").getAsInt()) > 29999984)))
            throw new IllegalArgumentException("interaction_bounds_invalid");
        if (args.has("item_id") && !args.get("item_id").getAsString().matches("[a-z0-9_.-]+:[a-z0-9_./-]{1,100}"))
            throw new IllegalArgumentException("invalid_interaction_item");
        return args;
    }

    private static Path file(MinecraftServer server, String actor, String id) throws Exception {
        Path root = server.getWorldPath(LevelResource.ROOT).resolve("data/qiandeng-interactions").toAbsolutePath().normalize();
        for (Path p = root; p != null; p = p.getParent())
            if (Files.isSymbolicLink(p)) throw new IllegalArgumentException("linked_interaction_journal");
        Files.createDirectories(root);
        return root.resolve(actor + "-" + id + ".json");
    }

    private static TaskRecord mining(NumenPlayer actor, JsonObject args, ToolContext context, JsonObject out) {
        var ids = new ArrayList<String>();
        args.getAsJsonArray("block_ids").forEach(id -> ids.add(id.getAsString()));
        var original = (MineBlockTaskRecord) new BlockActionOps().autoMine(actor, ids, null,
            args.get("count").getAsInt(), null, context);
        var origin = actor.position();
        var center = actor.blockPosition();
        var candidates = new ArrayList<BlockPos>();
        // Select only loaded, local cells. Named-cell mining retains Numen's normal
        // tool/permission checks, item pickup and inventory-delta count semantics.
        for (int x = center.getX() - 16; x <= center.getX() + 16; x++)
            for (int z = center.getZ() - 16; z <= center.getZ() + 16; z++) {
                if (!actor.level().hasChunkAt(new BlockPos(x, center.getY(), z))) continue;
                for (int y = Math.max(actor.level().getMinBuildHeight(), center.getY() - 16);
                        y <= Math.min(actor.level().getMaxBuildHeight() - 1, center.getY() + 16); y++) {
                    var pos = new BlockPos(x, y, z);
                    if (origin.distanceToSqr(net.minecraft.world.phys.Vec3.atCenterOf(pos)) <= 16 * 16
                            && original.targets.contains(actor.level().getBlockState(pos).getBlock()))
                        candidates.add(pos);
                }
            }
        candidates.sort(Comparator.<BlockPos>comparingDouble(pos -> origin.distanceToSqr(net.minecraft.world.phys.Vec3.atCenterOf(pos)))
            .thenComparingInt(BlockPos::getX).thenComparingInt(BlockPos::getY).thenComparingInt(BlockPos::getZ));
        var selection = new JsonObject();
        selection.addProperty("radius", 16); selection.addProperty("loadedOnly", true);
        selection.addProperty("candidateLimit", 64); selection.addProperty("candidateCount", Math.min(64, candidates.size()));
        selection.addProperty("truncated", candidates.size() > 64);
        selection.addProperty("dimension", actor.level().dimension().location().toString());
        var point = new JsonObject(); point.addProperty("x", origin.x); point.addProperty("y", origin.y); point.addProperty("z", origin.z);
        selection.add("origin", point);
        out.add("miningSelection", selection);
        if (candidates.isEmpty()) throw new IllegalArgumentException("no_loaded_mining_targets");
        var cells = new LinkedHashMap<BlockPos, net.minecraft.world.level.block.Block>();
        candidates.stream().limit(64).forEach(pos -> cells.put(pos, actor.level().getBlockState(pos).getBlock()));
        return new MineBlockTaskRecord(context.toolCallId(), original.getDeadlineGameTime(), original.targets,
            cells, original.count, original.label, original.spec);
    }

    private static JsonObject read(Path path) throws Exception {
        if (Files.isSymbolicLink(path) || Files.size(path) > 16384)
            throw new IllegalArgumentException("invalid_interaction_journal");
        return JsonParser.parseString(Files.readString(path, StandardCharsets.UTF_8)).getAsJsonObject();
    }

    private static void save(Path path, JsonObject row, boolean claim) throws Exception {
        Path target = claim ? path : path.resolveSibling(path.getFileName() + "." + UUID.randomUUID() + ".tmp");
        Files.writeString(target, row.toString(), StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
        try (var channel = java.nio.channels.FileChannel.open(target, StandardOpenOption.WRITE)) { channel.force(true); }
        if (!claim) Files.move(target, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }

    private static JsonObject prior(Path path, String key, String actor, String id, JsonObject args, String tool) throws Exception {
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) return PENDING.containsKey(key)
            ? unknown(base(actor, id, args, tool), "interaction_claim_missing") : null;
        Pending pending = PENDING.get(key);
        if (pending != null) finish(key, pending);
        JsonObject row = read(path);
        if (!actor.equals(row.get("actorUuid").getAsString()) || !id.equals(row.get("requestId").getAsString())
                || !tool.equals(row.get("tool").getAsString())
                || (args != null && !args.equals(row.getAsJsonObject("args"))))
            return unknown(base(actor, id, args, tool), "request_identity_conflict");
        String status = row.get("status").getAsString();
        if ((status.equals("accepted") || status.equals("running")) && !PENDING.containsKey(key))
            return unknown(row, "native_runtime_interrupted");
        row.addProperty("observedAt", System.currentTimeMillis());
        return row;
    }

    private static int run(CommandSourceStack source, String actorId, String id, String payload, String tool) {
        server(source.getServer());
        JsonObject args = null;
        JsonObject out = base(actorId, id, null, tool);
        Path path = null;
        String key = actorId + "/" + id;
        boolean claimed = false;
        boolean existing = false;
        try {
            if (!UUID.fromString(actorId).toString().equals(actorId) || !id.matches("[0-9a-f]{32}"))
                throw new IllegalArgumentException("invalid_interaction_identity");
            if (payload != null) args = arguments(payload, tool);
            out = base(actorId, id, args, tool);
            path = file(source.getServer(), actorId, id);
            existing = Files.exists(path, LinkOption.NOFOLLOW_LINKS);
            var previous = prior(path, key, actorId, id, args, tool);
            if (previous != null) out = previous;
            else if (payload == null) out = unknown(out, "request_not_found");
            else {
                var player = QiandengIronsBridge.resolve(source.getServer(), actorId);
                if (!(player instanceof NumenPlayer actor) || !actor.isAlive() || actor.hasDisconnected()
                        || actor.gameMode.getGameModeForPlayer() != GameType.SURVIVAL
                        || (tool.equals("interact_at") && !actor.onGround()))
                    throw new IllegalArgumentException("live_survival_numen_required");
                var active = CompanionTickDispatcher.currentTaskFor(actor.getUUID());
                if ((active != null && !active.getState().isTerminal())
                        || PENDING.values().stream().anyMatch(p -> actorId.equals(p.row().get("actorUuid").getAsString())))
                    throw new IllegalArgumentException("native_body_busy");
                if (PENDING.size() >= 64) throw new IllegalArgumentException("interaction_bridge_busy");
                if (tool.equals("interact_at") && !args.get("x").isJsonNull() && actor.distanceToSqr(args.get("x").getAsInt() + .5,
                        args.get("y").getAsInt() + .5, args.get("z").getAsInt() + .5) > 20.25)
                    throw new IllegalArgumentException("interaction_target_out_of_reach");
                var context = new ToolContext("mcp-" + id, actor.level().getGameTime());
                TaskRecord record = tool.equals("mine") ? mining(actor, args, context, out)
                    : tool.equals("drop_items")
                    ? new NativeDropTask.Record(id, actor.level().getGameTime(), args.get("item_id").getAsString(), args.get("count").getAsInt())
                    : tool.equals("eat")
                    ? new InventoryOps().eatItem(args.get("item_id").getAsString(), context)
                    : new BlockActionOps().interactAt(args.get("button").getAsString(),
                    args.get("x").isJsonNull() ? null : args.get("x").getAsInt(),
                    args.get("y").isJsonNull() ? null : args.get("y").getAsInt(),
                    args.get("z").isJsonNull() ? null : args.get("z").getAsInt(), args.get("hold_ticks").getAsInt(),
                    args.has("item_id") ? args.get("item_id").getAsString() : null, context);
                if (record instanceof NativeDropTask.Record drop && NativeDropTask.count(actor, drop.item) < drop.count)
                    throw new IllegalArgumentException("insufficient_main_inventory_items");
                out.addProperty("status", "accepted");
                out.addProperty("dispatched", true);
                out.addProperty("nativeTaskId", record.publicId());
                // Durable claim precedes runSync, so a lost response can only query this request.
                save(path, out, true);
                claimed = true;
                Pending pending = new Pending(path, out.deepCopy(), record);
                PENDING.put(key, pending);
                if (tool.equals("eat") || tool.equals("mine")) {
                    try { TaskDispatch.setTask(actor, record, args, ignored -> {}); }
                    finally {
                        // This exact external request is journalled above. Numen's ordinary
                        // standing-task persistence replays tool arguments after restart;
                        // an externally journalled request must remain unknown, never replay.
                        TaskPersistence.forget(actor);
                    }
                }
                else TaskDispatch.runSync(actor, record, ignored -> {});
                finish(key, pending);
                out = prior(path, key, actorId, id, args, tool);
            }
        } catch (Exception error) {
            if (claimed || existing || payload == null) {
                out = unknown(out, "native_dispatch_outcome_unknown");
                // The retained record may still settle. Keep it for exact read-only queries.
            } else out = rejected(out, error instanceof IllegalArgumentException
                ? String.valueOf(error.getMessage()) : "interaction_bridge_unavailable");
        }
        JsonObject result = out;
        source.sendSuccess(() -> Component.literal(PREFIX + result), false);
        return result.has("status") && result.get("status").getAsString().equals("rejected") ? 0 : 1;
    }

    private static void finish(String key, Pending pending) throws Exception {
        if (!pending.task().getState().isTerminal() || pending.task().getResult() == null) return;
        JsonObject row = pending.row().deepCopy();
        row.addProperty("status", "terminal");
        row.addProperty("nativeState", pending.task().getState().name());
        row.addProperty("completedAt", System.currentTimeMillis());
        row.add("result", JsonParser.parseString(pending.task().getResult().toJson()));
        save(pending.file(), row, false);
        PENDING.remove(key);
    }

    private static void tick(ServerTickEvent.Post event) {
        server(event.getServer());
        for (var entry : Map.copyOf(PENDING).entrySet()) {
            try { finish(entry.getKey(), entry.getValue()); }
            catch (Exception ignored) { /* Preserve the claim and original task; never dispatch again. */ }
        }
    }
}
