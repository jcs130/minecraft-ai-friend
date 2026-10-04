package dev.qiandeng.maw;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.simibubi.create.content.kinetics.base.KineticBlockEntity;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Native identity for only the block this player can currently see. */
final class PlayerWorldBridge {
    private static final int MAX_REQUEST = 4096;
    private static final Map<UUID, Integer> LAST_QUERY_TICK = new HashMap<>();

    private record Query(String json) implements CustomPacketPayload {
        static final Type<Query> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "world_query"));
        static final StreamCodec<RegistryFriendlyByteBuf, Query> CODEC = StreamCodec.of(
                (buf, payload) -> writeJson(buf, payload.json), buf -> new Query(readJson(buf)));

        @Override public Type<Query> type() { return TYPE; }
    }

    private record State(String json) implements CustomPacketPayload {
        static final Type<State> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "world_state"));
        static final StreamCodec<RegistryFriendlyByteBuf, State> CODEC = StreamCodec.of(
                (buf, payload) -> writeJson(buf, payload.json), buf -> new State(readJson(buf)));

        @Override public Type<State> type() { return TYPE; }
    }

    private static void writeJson(RegistryFriendlyByteBuf buf, String json) {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_REQUEST) throw new IllegalArgumentException("world JSON too large");
        buf.writeBytes(bytes);
    }

    private static String readJson(RegistryFriendlyByteBuf buf) {
        int size = buf.readableBytes();
        if (size > MAX_REQUEST) throw new IllegalArgumentException("world JSON too large");
        byte[] bytes = new byte[size];
        buf.readBytes(bytes);
        return new String(bytes, StandardCharsets.UTF_8);
    }

    static void register(IEventBus modBus) {
        modBus.addListener(PlayerWorldBridge::registerPayloads);
        NeoForge.EVENT_BUS.addListener(PlayerWorldBridge::onLogout);
    }

    private static void registerPayloads(RegisterPayloadHandlersEvent event) {
        var registrar = event.registrar("1").optional();
        registrar.playToClient(State.TYPE, State.CODEC, (payload, context) -> {});
        registrar.playToServer(Query.TYPE, Query.CODEC, (payload, context) -> {
            if (context.player() instanceof ServerPlayer player) {
                context.enqueueWork(() -> handle(player, payload.json));
            }
        });
    }

    private static void onLogout(PlayerEvent.PlayerLoggedOutEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) LAST_QUERY_TICK.remove(player.getUUID());
    }

    private static void send(ServerPlayer player, JsonObject result) {
        if (player.connection != null && player.connection.hasChannel(State.TYPE)) {
            result.addProperty("playerUuid", player.getUUID().toString());
            PacketDistributor.sendToPlayer(player, new State(result.toString()));
        }
    }

    private static JsonObject result(String requestId) {
        JsonObject result = new JsonObject();
        result.addProperty("schemaVersion", 1);
        result.addProperty("kind", "world_receipt");
        result.addProperty("requestId", requestId);
        return result;
    }

    private static void reject(ServerPlayer player, String requestId, String code) {
        JsonObject result = result(requestId);
        result.addProperty("ok", false);
        result.addProperty("code", code);
        send(player, result);
    }

    private static void handle(ServerPlayer player, String raw) {
        String requestId = "invalid";
        try {
            JsonObject input = JsonParser.parseString(raw).getAsJsonObject();
            requestId = input.get("requestId").getAsString();
            if (!requestId.matches("[A-Za-z0-9:_-]{1,64}")) return;
            if (input.get("schemaVersion").getAsInt() != 1 || !input.get("kind").getAsString().equals("look")) {
                reject(player, requestId, "unsupported_query"); return;
            }
            int now = player.getServer().getTickCount();
            Integer last = LAST_QUERY_TICK.get(player.getUUID());
            if (last != null && now - last < 2) {
                reject(player, requestId, "rate_limited"); return;
            }
            LAST_QUERY_TICK.put(player.getUUID(), now);
            // The authoritative server raycast exposes only the first visible
            // block under this player's crosshair, not hidden ore or inventories.
            // ServerPlayer.pick interpolates old/head-render rotation. A look
            // packet has already updated body yaw/pitch, while yHeadRot may
            // still belong to the previous AI tick. Raycast the current input
            // rotation, keeping vanilla outline/fluid/occlusion rules.
            Vec3 eye = player.getEyePosition();
            Vec3 direction = Vec3.directionFromRotation(player.getXRot(), player.getYRot());
            HitResult hit = player.level().clip(new ClipContext(eye, eye.add(direction.scale(8.0)),
                    ClipContext.Block.OUTLINE, ClipContext.Fluid.NONE, player));
            if (!(hit instanceof BlockHitResult blockHit) || hit.getType() != HitResult.Type.BLOCK) {
                reject(player, requestId, "no_visible_block"); return;
            }
            BlockPos pos = blockHit.getBlockPos();
            if (!player.level().isLoaded(pos)) {
                reject(player, requestId, "block_not_loaded"); return;
            }
            BlockState state = player.level().getBlockState(pos);
            JsonObject result = result(requestId);
            result.addProperty("ok", true);
            result.addProperty("dimension", player.level().dimension().location().toString());
            JsonObject position = new JsonObject();
            position.addProperty("x", pos.getX());
            position.addProperty("y", pos.getY());
            position.addProperty("z", pos.getZ());
            result.add("position", position);
            JsonObject block = new JsonObject();
            block.addProperty("id", BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
            JsonObject properties = new JsonObject();
            state.getValues().forEach((property, value) -> properties.addProperty(property.getName(), value.toString()));
            block.add("properties", properties);
            BlockEntity entity = player.level().getBlockEntity(pos);
            if (entity != null) {
                block.addProperty("blockEntityType", BuiltInRegistries.BLOCK_ENTITY_TYPE.getKey(entity.getType()).toString());
                if (entity instanceof KineticBlockEntity kinetic) {
                    JsonObject rotation = new JsonObject();
                    rotation.addProperty("speed", kinetic.getSpeed());
                    rotation.addProperty("theoreticalSpeed", kinetic.getTheoreticalSpeed());
                    rotation.addProperty("overstressed", kinetic.isOverStressed());
                    rotation.addProperty("speedRequirementFulfilled", kinetic.isSpeedRequirementFulfilled());
                    block.add("kinetic", rotation);
                }
            }
            result.add("block", block);
            send(player, result);
        } catch (RuntimeException error) {
            reject(player, requestId, "invalid_world_query");
        }
    }
}
