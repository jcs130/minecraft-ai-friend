package dev.qiandeng.irons;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.tags.TagKey;
import net.minecraft.world.level.block.Block;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.PriorityQueue;
import java.util.Set;
import java.util.UUID;

/** Synchronous, loaded-only local block survey; never occupies a Numen action task. */
public final class WorldScanBridge {
    private static final int MAX_RADIUS = 16;
    private static final int MAX_CHECKS = 35_937;
    private static final int MAX_MATCHES = 16;
    private static final int MAX_REPLY_BYTES = 3_000;
    private static final long COOLDOWN_NANOS = 5_000_000_000L;
    // Commands execute on the server thread. Bound even if operators query many distinct players.
    private static final LinkedHashMap<UUID, Long> LAST_SCAN = new LinkedHashMap<>();
    private record Hit(BlockPos position, String block, int distanceSquared, Boolean source) {}
    private static final Comparator<Hit> NEAREST = Comparator.comparingInt(Hit::distanceSquared)
        .thenComparingInt(h -> h.position().getX()).thenComparingInt(h -> h.position().getY())
        .thenComparingInt(h -> h.position().getZ());

    private WorldScanBridge() {}

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("qdworld").requires(s -> s.hasPermission(2))
            .then(Commands.literal("scan").then(Commands.argument("actor", StringArgumentType.string())
                .then(Commands.argument("radius", IntegerArgumentType.integer(1, MAX_RADIUS))
                    .then(Commands.argument("filters", StringArgumentType.greedyString()).executes(c -> scan(
                        c.getSource(), StringArgumentType.getString(c, "actor"),
                        IntegerArgumentType.getInteger(c, "radius"), StringArgumentType.getString(c, "filters"))))))));
    }

    private static Set<Block> filters(String query) {
        if (query.length() > 815) throw new IllegalArgumentException("invalid_scan_filter");
        String[] values = query.split(",", -1);
        if (values.length < 1 || values.length > 8) throw new IllegalArgumentException("invalid_scan_filter");
        Set<Block> targets = new HashSet<>();
        for (String value : values) {
            boolean tag = value.startsWith("#");
            String raw = tag ? value.substring(1) : value;
            if (raw.length() > 100 || !raw.matches("[a-z0-9_.-]+:[a-z0-9_./-]+"))
                throw new IllegalArgumentException("invalid_scan_filter");
            ResourceLocation id = ResourceLocation.tryParse(raw);
            if (id == null) throw new IllegalArgumentException("invalid_scan_filter");
            if (tag) {
                boolean present = false;
                for (var holder : BuiltInRegistries.BLOCK.getTagOrEmpty(TagKey.create(Registries.BLOCK, id))) {
                    targets.add(holder.value());
                    present = true;
                }
                if (!present) throw new IllegalArgumentException("unknown_or_empty_scan_tag");
            } else {
                if (!BuiltInRegistries.BLOCK.containsKey(id)) throw new IllegalArgumentException("unknown_scan_block");
                targets.add(BuiltInRegistries.BLOCK.get(id));
            }
        }
        return targets;
    }

    private static JsonObject point(BlockPos position) {
        var out = new JsonObject();
        out.addProperty("x", position.getX()); out.addProperty("y", position.getY()); out.addProperty("z", position.getZ());
        return out;
    }

    private static int scan(CommandSourceStack source, String query, int radius, String filterQuery) {
        var out = new JsonObject();
        out.addProperty("schema", 1); out.addProperty("capability", "bounded_block_scan_v1");
        out.addProperty("ok", false);
        long started = System.nanoTime();
        try {
            UUID actorId = UUID.fromString(query);
            if (!actorId.toString().equals(query)) throw new IllegalArgumentException("actor_uuid_required");
            out.addProperty("actorUuid", actorId.toString());
            var actor = QiandengIronsBridge.resolve(source.getServer(), actorId.toString());
            if (!actor.getUUID().equals(actorId) || !actor.isAlive() || actor.hasDisconnected())
                throw new IllegalArgumentException("actor_unavailable");
            var level = actor.serverLevel();
            BlockPos center = actor.blockPosition();
            out.addProperty("dimension", level.dimension().location().toString());
            out.add("center", point(center)); out.addProperty("radius_searched", radius);
            Long previous = LAST_SCAN.get(actorId);
            if (previous != null && started - previous < COOLDOWN_NANOS) {
                out.addProperty("code", "scan_cooldown");
                out.addProperty("retryAfterMs", (COOLDOWN_NANOS - (started - previous) + 999_999L) / 1_000_000L);
            } else {
                Set<Block> targets = filters(filterQuery);
                LAST_SCAN.put(actorId, started);
                if (LAST_SCAN.size() > 2_048) LAST_SCAN.remove(LAST_SCAN.keySet().iterator().next());
                var nearest = new PriorityQueue<Hit>(MAX_MATCHES, NEAREST.reversed());
                int examined = 0, found = 0, unloaded = 0, columns = 0;
                int lowX = center.getX() - radius, highX = center.getX() + radius;
                int lowZ = center.getZ() - radius, highZ = center.getZ() + radius;
                int lowY = Math.max(level.getMinBuildHeight(), center.getY() - radius);
                int highY = Math.min(level.getMaxBuildHeight() - 1, center.getY() + radius);
                int radiusSquared = radius * radius;
                var cursor = new BlockPos.MutableBlockPos();
                for (int cx = lowX >> 4; cx <= highX >> 4; cx++) {
                    for (int cz = lowZ >> 4; cz <= highZ >> 4; cz++) {
                        columns++;
                        // Cache lookup only. No getChunk/getBlockState(level), tickets or generation.
                        var chunk = level.getChunkSource().getChunkNow(cx, cz);
                        if (chunk == null) { unloaded++; continue; }
                        for (int x = Math.max(lowX, cx << 4); x <= Math.min(highX, (cx << 4) + 15); x++) {
                            for (int z = Math.max(lowZ, cz << 4); z <= Math.min(highZ, (cz << 4) + 15); z++) {
                                int horizontal = (x - center.getX()) * (x - center.getX()) + (z - center.getZ()) * (z - center.getZ());
                                for (int y = lowY; y <= highY; y++) {
                                    int distance = horizontal + (y - center.getY()) * (y - center.getY());
                                    if (distance > radiusSquared) continue;
                                    if (++examined > MAX_CHECKS) throw new IllegalStateException("scan_budget_exceeded");
                                    cursor.set(x, y, z);
                                    var state = chunk.getBlockState(cursor);
                                    if (!targets.contains(state.getBlock())) continue;
                                    found++;
                                    var hit = new Hit(cursor.immutable(), BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString(),
                                        distance, state.getFluidState().isEmpty() ? null : state.getFluidState().isSource());
                                    if (nearest.size() < MAX_MATCHES) nearest.add(hit);
                                    else if (NEAREST.compare(hit, nearest.peek()) < 0) { nearest.poll(); nearest.add(hit); }
                                }
                            }
                        }
                    }
                }
                var hits = new ArrayList<>(nearest);
                hits.sort(NEAREST);
                var rows = new JsonArray();
                for (Hit hit : hits) {
                    var row = point(hit.position());
                    row.addProperty("block", hit.block());
                    row.addProperty("distance", Math.round(Math.sqrt(hit.distanceSquared()) * 1_000) / 1_000.0);
                    if (hit.source() != null) row.addProperty("source", hit.source());
                    rows.add(row);
                }
                out.add("matches", rows); out.addProperty("examinedBlocks", examined);
                out.addProperty("columnsTotal", columns); out.addProperty("unloadedColumns", unloaded);
                out.addProperty("truncated", found > rows.size() || unloaded > 0);
                if (unloaded == 0) out.addProperty("total_in_radius", found);
                out.addProperty("coverage", unloaded == 0 ? "loaded_sphere" : "partial_unloaded");
                out.addProperty("note", "Only currently loaded blocks were examined. Unloaded terrain is unknown; inspect exact states before interaction.");
                out.addProperty("ok", true); out.addProperty("code", "ok");
            }
        } catch (IllegalArgumentException e) {
            String message = e.getMessage();
            out.addProperty("code", message != null && message.matches("[a-z_]{1,50}") ? message : "invalid_scan_argument");
        } catch (Exception e) { out.addProperty("code", "scan_unavailable"); }
        out.addProperty("scanMillis", Math.round((System.nanoTime() - started) / 1_000.0) / 1_000.0);
        // Namespaced mod IDs can be long. Remove farthest rows rather than truncate JSON on RCON.
        if (out.has("matches")) {
            var rows = out.getAsJsonArray("matches");
            while (!rows.isEmpty() && out.toString().getBytes(StandardCharsets.UTF_8).length > MAX_REPLY_BYTES) {
                rows.remove(rows.size() - 1); out.addProperty("truncated", true);
            }
        }
        source.sendSuccess(() -> Component.literal("QD_WORLD_SCAN_JSON " + out), false);
        return out.get("ok").getAsBoolean() ? 1 : 0;
    }
}
