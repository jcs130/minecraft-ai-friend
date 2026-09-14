package com.dwinovo.numen.core.entity;

import com.dwinovo.numen.entity.CompanionChunkLoader;
import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.NumenPlayer;
import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.brigadier.CommandDispatcher;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.TicketType;
import net.minecraft.world.level.ChunkPos;
import net.neoforged.fml.loading.FMLPaths;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Reuse Numen's expiring pad for explicitly authorized bodies.
 * The supplemental NeoForge force-tick ticket enables vanilla crop/weather ticks
 * despite Numen's deliberate exclusion from player-view loading. No manual tick,
 * second brain, movement, teleport, restoration or model call.
 */
public final class AutonomousBodyTick {
    public static final String CAPABILITY = "autonomous_body_tick_v1";
    public static final String WORLD_TICK_CAPABILITY = "autonomous_world_tick_v3";
    private static final TicketType<UUID> WORLD_TICKET = TicketType.create(
        "qiandeng_autonomous_world", UUID::compareTo, 40);
    private record WorldPad(UUID bodyUuid, ServerLevel level, ChunkPos pos, int refreshedAt) {}
    private static final Map<UUID, WorldPad> worldPads = new LinkedHashMap<>();
    public record AllowedBody(UUID bodyUuid, UUID ownerUuid, String bodyName) {}
    private static Map<UUID, AllowedBody> allowed = Map.of();
    private static final Map<UUID, Integer> refreshed = new LinkedHashMap<>();
    private static boolean configValid;
    private static boolean configEnabled;
    private static String configHash = "";
    private static int radius = -1, timeout = -1, refreshInterval = -1;

    private AutonomousBodyTick() {}

    private static UUID canonical(String text) {
        UUID value = UUID.fromString(text);
        if (!value.toString().equals(text)) throw new IllegalArgumentException("noncanonical_body_uuid");
        return value;
    }

    private static String text(JsonObject row, String key) {
        JsonElement value = row.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString())
            throw new IllegalArgumentException("invalid_identity_field");
        return value.getAsString();
    }

    public static Map<UUID, AllowedBody> parsePolicy(String json) {
        if (json == null || json.getBytes(StandardCharsets.UTF_8).length > 16384)
            throw new IllegalArgumentException("policy_too_large");
        try {
            JsonObject root = JsonParser.parseString(json).getAsJsonObject();
            if (!root.keySet().equals(Set.of("schema", "enabled", "bodies"))
                    || !root.get("schema").isJsonPrimitive() || !root.getAsJsonPrimitive("schema").isNumber()
                    || !root.get("schema").getAsString().equals("1")
                    || !root.get("enabled").isJsonPrimitive() || !root.getAsJsonPrimitive("enabled").isBoolean()
                    || !root.get("bodies").isJsonArray() || root.getAsJsonArray("bodies").size() > 8)
                throw new IllegalArgumentException("invalid_autonomous_policy");
            Map<UUID, AllowedBody> result = new LinkedHashMap<>();
            for (JsonElement value : root.getAsJsonArray("bodies")) {
                JsonObject row = value.getAsJsonObject();
                if (!row.keySet().equals(Set.of("bodyUuid", "ownerUuid", "bodyName")))
                    throw new IllegalArgumentException("invalid_autonomous_identity");
                UUID body = canonical(text(row, "bodyUuid")), owner = canonical(text(row, "ownerUuid"));
                String name = text(row, "bodyName");
                if (body.equals(owner) || !name.matches("[A-Za-z0-9_]{1,16}")
                        || result.putIfAbsent(body, new AllowedBody(body, owner, name)) != null)
                    throw new IllegalArgumentException("invalid_autonomous_identity");
            }
            return root.get("enabled").getAsBoolean() ? Map.copyOf(result) : Map.of();
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("invalid_autonomous_policy", error);
        }
    }

    public static boolean eligible(AllowedBody entry, UUID body, UUID owner, String name,
                                   boolean alive, boolean removed, UUID registeredOwner,
                                   String registeredName, long diedAt, boolean ownerOnline) {
        return entry != null && alive && !removed && !ownerOnline && diedAt == 0
            && entry.bodyUuid().equals(body) && entry.ownerUuid().equals(owner)
            && entry.bodyName().equals(name) && entry.ownerUuid().equals(registeredOwner)
            && entry.bodyName().equals(registeredName);
    }

    private static int nativeInt(String name) throws ReflectiveOperationException {
        var field = CompanionChunkLoader.class.getDeclaredField(name);
        field.setAccessible(true);
        return field.getInt(null);
    }

    /** Called once at mod initialization. No filesystem reads in any server tick. */
    public static void loadPolicy() {
        for (WorldPad pad : worldPads.values()) releaseWorldPad(pad);
        worldPads.clear();
        allowed = Map.of(); refreshed.clear(); configValid = false; configEnabled = false; configHash = "";
        try {
            radius = nativeInt("RADIUS"); timeout = nativeInt("TIMEOUT_TICKS");
            refreshInterval = nativeInt("REFRESH_TICKS");
            if (radius != 2 || timeout != 40 || refreshInterval != 20)
                throw new IllegalArgumentException("native_pad_contract_changed");
            Path file = FMLPaths.CONFIGDIR.get().resolve("numen-autonomous-bodies.json");
            if (Files.isSymbolicLink(file) || !Files.isRegularFile(file) || Files.size(file) > 16384)
                throw new IllegalArgumentException("autonomous_policy_unavailable");
            byte[] bytes = Files.readAllBytes(file);
            Map<UUID, AllowedBody> parsed = parsePolicy(new String(bytes, StandardCharsets.UTF_8));
            configEnabled = JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8))
                .getAsJsonObject().get("enabled").getAsBoolean();
            configHash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            allowed = parsed; configValid = true;
            com.dwinovo.numen.core.Constants.LOG.info("[numen-autonomy] cached {} authorized bodies; native expiring pad unchanged", allowed.size());
        } catch (Exception error) {
            com.dwinovo.numen.core.Constants.LOG.error("[numen-autonomy] policy disabled: {}", error.getClass().getSimpleName());
        }
    }

    private static boolean identityValid(MinecraftServer server, AllowedBody binding, NumenPlayer body) {
        CompanionRegistry.Entry registered = CompanionRegistry.get(server).find(binding.bodyUuid());
        return eligible(binding, body.getUUID(), body.getOwnerUuid(), body.getGameProfile().getName(),
            body.isAlive(), body.isRemoved(), registered == null ? null : registered.owner(),
            registered == null ? null : registered.name(), registered == null ? -1 : registered.diedAt(), false);
    }

    private static boolean eligible(MinecraftServer server, AllowedBody binding, NumenPlayer body) {
        return server.getPlayerList().getPlayer(binding.ownerUuid()) == null && identityValid(server, binding, body);
    }

    public static Set<Long> worldChunks(int centerX, int centerZ) {
        var chunks = new LinkedHashSet<Long>();
        for (int dx = -1; dx <= 1; dx++) for (int dz = -1; dz <= 1; dz++)
            chunks.add(ChunkPos.asLong(centerX + dx, centerZ + dz));
        return chunks;
    }

    private static void releaseWorldPad(WorldPad pad) { releaseWorldPadExcept(pad, Set.of()); }

    private static void releaseWorldPadExcept(WorldPad pad, Set<Long> retained) {
        for (long key : worldChunks(pad.pos().x, pad.pos().z)) if (!retained.contains(key))
            pad.level().getChunkSource().removeRegionTicket(WORLD_TICKET, new ChunkPos(key), 2, pad.bodyUuid(), true);
    }

    private static void refreshWorldPad(MinecraftServer server, AllowedBody binding, NumenPlayer body) {
        ServerLevel level = (ServerLevel) body.level();
        ChunkPos pos = body.chunkPosition();
        WorldPad previous = worldPads.get(binding.bodyUuid());
        boolean changed = previous == null || previous.level() != level || !previous.pos().equals(pos);
        if (!changed && server.getTickCount() - previous.refreshedAt() < 20) return;
        Set<Long> targets = worldChunks(pos.x, pos.z);
        if (changed && previous != null)
            releaseWorldPadExcept(previous, previous.level() == level ? targets : Set.of());
        // The 4-argument overload defaults to false: entity ticking alone does
        // not enter ServerChunkCache.tickChunks when no viewer is nearby.
        for (long key : targets)
            level.getChunkSource().addRegionTicket(WORLD_TICKET, new ChunkPos(key), 2, binding.bodyUuid(), true);
        worldPads.put(binding.bodyUuid(), new WorldPad(binding.bodyUuid(), level, pos, server.getTickCount()));
    }

    /** Runs on the existing core ServerTickEvent.Post, even if entity ticks stopped. */
    public static void serverTick(MinecraftServer server) {
        if (!configValid || !configEnabled || !CompanionChunkLoader.enabled) {
            for (WorldPad pad : worldPads.values()) releaseWorldPad(pad);
            worldPads.clear();
            return;
        }
        for (AllowedBody binding : allowed.values()) {
            ServerPlayer player = server.getPlayerList().getPlayer(binding.bodyUuid());
            if (player instanceof NumenPlayer body && identityValid(server, binding, body)) {
                if (eligible(server, binding, body)) {
                    // Owner-online bodies retain the original entity ticket path.
                    CompanionChunkLoader.refresh(body);
                    refreshed.put(binding.bodyUuid(), server.getTickCount());
                }
                refreshWorldPad(server, binding, body);
            } else {
                WorldPad previous = worldPads.remove(binding.bodyUuid());
                if (previous != null) releaseWorldPad(previous);
            }
        }
    }

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("numen_autonomy_status").requires(source -> source.hasPermission(4))
            .executes(context -> status(context.getSource())));
    }

    private static int status(CommandSourceStack source) {
        MinecraftServer server = source.getServer();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("schema", 1); result.put("capability", CAPABILITY);
        result.put("worldTickCapability", WORLD_TICK_CAPABILITY);
        result.put("worldTickRadius", 2); result.put("worldTickForceTicks", true);
        result.put("worldTickChunkRadius", 1); result.put("worldTickChunkCount", 9);
        result.put("worldTickTimeoutTicks", 40); result.put("worldTickRefreshTicks", 20);
        result.put("configValid", configValid); result.put("configEnabled", configEnabled);
        result.put("configSha256", configHash); result.put("nativePadEnabled", CompanionChunkLoader.enabled);
        result.put("nativePadRadius", radius); result.put("nativePadTimeoutTicks", timeout);
        result.put("nativePadRefreshTicks", refreshInterval); result.put("serverTick", server.getTickCount());
        result.put("observedAt", System.currentTimeMillis());
        var bodies = new ArrayList<Map<String, Object>>();
        for (AllowedBody binding : allowed.values()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("bodyUuid", binding.bodyUuid().toString()); row.put("ownerUuid", binding.ownerUuid().toString());
            row.put("bodyName", binding.bodyName()); row.put("online", false); row.put("eligible", false);
            row.put("identityValid", false);
            row.put("ownerOnline", server.getPlayerList().getPlayer(binding.ownerUuid()) != null);
            ServerPlayer player = server.getPlayerList().getPlayer(binding.bodyUuid());
            if (player instanceof NumenPlayer body) {
                row.put("online", true); row.put("eligible", eligible(server, binding, body));
                row.put("identityValid", identityValid(server, binding, body));
                row.put("entityTicking", ((ServerLevel) body.level()).isPositionEntityTicking(body.blockPosition()));
                row.put("nativeForceTicks", ((ServerLevel) body.level()).getChunkSource().chunkMap
                    .getDistanceManager().shouldForceTicks(body.chunkPosition().toLong()));
                row.put("bodyTickCount", body.tickCount); row.put("dimension", body.level().dimension().location().toString());
            }
            row.put("lastRefreshServerTick", refreshed.get(binding.bodyUuid()));
            WorldPad pad = worldPads.get(binding.bodyUuid());
            row.put("worldTickTicketActive", pad != null);
            row.put("worldTickLastRefreshServerTick", pad == null ? null : pad.refreshedAt());
            if (pad != null) {
                row.put("worldTickChunkX", pad.pos().x); row.put("worldTickChunkZ", pad.pos().z);
                row.put("worldTickDimension", pad.level().dimension().location().toString());
                int forceCount = 0, entityCount = 0;
                for (long key : worldChunks(pad.pos().x, pad.pos().z)) {
                    if (pad.level().getChunkSource().chunkMap.getDistanceManager().shouldForceTicks(key)) forceCount++;
                    if (pad.level().isPositionEntityTicking(new ChunkPos(key).getMiddleBlockPosition(0))) entityCount++;
                }
                row.put("worldTickNativeForcedCount", forceCount);
                row.put("worldTickEntityTickingCount", entityCount);
            }
            bodies.add(row);
        }
        result.put("bodies", bodies);
        source.sendSuccess(() -> Component.literal("QD_NUMEN_AUTONOMY_JSON " + new Gson().toJson(result)), false);
        return 1;
    }
}
