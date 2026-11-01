package dev.myagentworld.stock263;

import com.google.gson.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.time.Instant;
import java.util.*;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.networking.v1.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.phys.*;

/** Same-player read-only snapshots, evaluated on the authoritative server thread. */
public final class BodyBridge implements ModInitializer {
    public record Request(byte[] bytes) implements CustomPacketPayload {
        public static final Type<Request> TYPE = new Type<>(Identifier.fromNamespaceAndPath("maw_stock", "read"));
        public static final StreamCodec<RegistryFriendlyByteBuf, Request> CODEC = StreamCodec.of(
            (buffer, value) -> buffer.writeBytes(value.bytes), buffer -> {
                int size = buffer.readableBytes(); if (size > 4096) throw new IllegalArgumentException("Read budget");
                byte[] bytes = new byte[size]; buffer.readBytes(bytes); return new Request(bytes);
            });
        @Override public Type<? extends CustomPacketPayload> type() { return TYPE; }
    }
    public record Reply(byte[] bytes) implements CustomPacketPayload {
        public static final Type<Reply> TYPE = new Type<>(Identifier.fromNamespaceAndPath("maw_stock", "snapshot"));
        public static final StreamCodec<RegistryFriendlyByteBuf, Reply> CODEC = StreamCodec.of(
            (buffer, value) -> buffer.writeBytes(value.bytes), buffer -> {
                int size = buffer.readableBytes(); if (size > 12288) throw new IllegalArgumentException("Snapshot budget");
                byte[] bytes = new byte[size]; buffer.readBytes(bytes); return new Reply(bytes);
            });
        @Override public Type<? extends CustomPacketPayload> type() { return TYPE; }
    }
    private static final Map<UUID, ArrayDeque<Long>> WINDOWS = new HashMap<>();
    private static final String EPOCH = UUID.randomUUID().toString();

    @Override public void onInitialize() {
        PayloadTypeRegistry.serverboundPlay().register(Request.TYPE, Request.CODEC);
        PayloadTypeRegistry.clientboundPlay().register(Reply.TYPE, Reply.CODEC);
        ServerPlayNetworking.registerGlobalReceiver(Request.TYPE, (payload, context) -> context.server().execute(() -> read(context.player(), payload.bytes)));
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> WINDOWS.remove(handler.player.getUUID()));
    }
    private static void read(ServerPlayer player, byte[] bytes) {
        if (!ServerPlayNetworking.canSend(player, Reply.TYPE)) return;
        JsonObject out = new JsonObject();
        out.addProperty("schemaVersion", 1); out.addProperty("bodyId", player.getUUID().toString());
        out.addProperty("snapshotEpoch", EPOCH); out.addProperty("observedAt", Instant.now().toString());
        out.addProperty("serverTick", player.level().getGameTime());
        try {
            String raw = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            JsonObject input = JsonParser.parseString(raw).getAsJsonObject();
            if (input.get("requestId") == null || !input.get("requestId").getAsString().matches("[a-zA-Z0-9_.:-]{1,64}")) throw new IllegalArgumentException("requestId");
            out.add("requestId", input.get("requestId"));
            long now = System.nanoTime();
            ArrayDeque<Long> times = WINDOWS.computeIfAbsent(player.getUUID(), key -> new ArrayDeque<>());
            while (!times.isEmpty() && now - times.peekFirst() >= 1_000_000_000L) times.removeFirst();
            if (times.size() >= 8) { out.addProperty("status", "rate_limited"); out.addProperty("retryAfterMs", 250); send(player, out); return; }
            times.addLast(now);
            String kind = input.get("kind").getAsString();
            out.addProperty("kind", kind);
            out.addProperty("dimension", player.level().dimension().identifier().toString());
            if (kind.equals("status")) {
                out.addProperty("status", "ok");
                JsonObject position = new JsonObject();
                position.addProperty("x", player.getX()); position.addProperty("y", player.getY()); position.addProperty("z", player.getZ());
                out.add("position", position); out.addProperty("health", player.getHealth()); out.addProperty("maxHealth", player.getMaxHealth());
                out.addProperty("food", player.getFoodData().getFoodLevel()); out.addProperty("alive", player.isAlive());
                out.addProperty("gameMode", player.gameMode().getName()); out.addProperty("currentWindow", player.containerMenu.containerId);
            } else if (kind.equals("block")) {
                BlockPos pos = new BlockPos(coordinate(input, "x"), coordinate(input, "y"), coordinate(input, "z"));
                out.addProperty("coordinateSystem", "absolute_world_blocks"); out.addProperty("visibilityMode", "interaction_outline_raycast");
                if (!player.isWithinBlockInteractionRange(pos, 0)) { out.addProperty("status", "denied"); out.addProperty("reason", "outside_actual_player_interaction_range"); }
                else if (!player.level().hasChunkAt(pos)) { out.addProperty("status", "unknown"); out.addProperty("reason", "target_chunk_not_loaded"); }
                else {
                    BlockHitResult hit = player.level().clip(new ClipContext(player.getEyePosition(), Vec3.atCenterOf(pos), ClipContext.Block.OUTLINE, ClipContext.Fluid.NONE, player));
                    if (hit.getType() != HitResult.Type.MISS && !hit.getBlockPos().equals(pos)) { out.addProperty("status", "denied"); out.addProperty("reason", "interaction_raycast_blocked"); }
                    else {
                        var state = player.level().getBlockState(pos);
                        out.addProperty("status", "ok");
                        JsonObject block = new JsonObject(); block.addProperty("nativeId", BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
                        block.addProperty("nativeStateId", Block.getId(state)); block.addProperty("x", pos.getX()); block.addProperty("y", pos.getY()); block.addProperty("z", pos.getZ());
                        block.addProperty("air", state.isAir()); block.addProperty("canOcclude", state.canOcclude());
                        block.addProperty("destroyProgressPerTick", state.getDestroyProgress(player, player.level(), pos));
                        block.addProperty("collisionEmpty", state.getCollisionShape(player.level(), pos).isEmpty());
                        JsonObject properties = new JsonObject();
                        for (var property : state.getProperties()) properties.addProperty(property.getName(), propertyValue(property, state));
                        block.add("properties", properties); out.add("block", block);
                    }
                }
            } else throw new IllegalArgumentException("kind");
        } catch (Exception error) { out.addProperty("status", "invalid_argument"); out.addProperty("reason", "invalid_read_request"); }
        send(player, out);
    }
    private static int coordinate(JsonObject input, String key) {
        JsonElement value = input.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) throw new IllegalArgumentException(key);
        double number = value.getAsDouble();
        if (!Double.isFinite(number) || number != Math.rint(number) || Math.abs(number) > 30_000_000) throw new IllegalArgumentException(key);
        return (int) number;
    }
    @SuppressWarnings({"rawtypes", "unchecked"}) private static String propertyValue(Property property, net.minecraft.world.level.block.state.BlockState state) { return property.getName(state.getValue(property)); }
    private static void send(ServerPlayer player, JsonObject out) {
        byte[] bytes = out.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length <= 12288) ServerPlayNetworking.send(player, new Reply(bytes));
    }
}
