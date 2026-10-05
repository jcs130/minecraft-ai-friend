package dev.qiandeng.maw;

import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.phys.shapes.CollisionContext;

import java.util.Set;

/** A single currently visible, loaded block's real player-context collision shape. */
final class PlayerCollisionBridge {
    private static final double REACH = 8.0;
    private static final Set<String> FIELDS = Set.of("schemaVersion", "kind", "requestId", "playerUuid",
            "dimension", "position", "expectedBlockId", "expectedProperties");

    // Called by PlayerWorldBridge's existing per-player, rate-limited query route.
    // No channel registration, mutation, world scan or independently owned service.
    static JsonObject query(ServerPlayer player, JsonObject input, String requestId) {
        JsonObject result = base(player, requestId);
        try {
            if (!FIELDS.containsAll(input.keySet())) return failure(result, "unsupported_collision_field");
            if (NativeCollisionFacts.integer(input, "schemaVersion") != 1
                    || !input.has("kind") || !input.get("kind").isJsonPrimitive()
                    || !input.get("kind").getAsJsonPrimitive().isString()
                    || !"collision".equals(input.get("kind").getAsString())
                    || !input.has("requestId") || !input.get("requestId").isJsonPrimitive()
                    || !input.get("requestId").getAsJsonPrimitive().isString()
                    || !requestId.equals(input.get("requestId").getAsString()))
                return failure(result, "invalid_collision_query");
            if (!input.has("playerUuid") || !input.get("playerUuid").isJsonPrimitive()
                    || !input.get("playerUuid").getAsJsonPrimitive().isString())
                return failure(result, "collision_player_identity_mismatch");
            if (!player.getUUID().toString().equals(input.get("playerUuid").getAsString()))
                return failure(result, "collision_player_identity_mismatch");
            String dimension = player.level().dimension().location().toString();
            if (!input.has("dimension") || !input.get("dimension").isJsonPrimitive()
                    || !input.get("dimension").getAsJsonPrimitive().isString())
                return failure(result, "collision_dimension_changed");
            if (!dimension.equals(input.get("dimension").getAsString()))
                return failure(result, "collision_dimension_changed");
            JsonObject point = input.getAsJsonObject("position");
            if (point.size() != 3 || !point.keySet().equals(Set.of("x", "y", "z")))
                return failure(result, "invalid_collision_position");
            BlockPos target = new BlockPos(NativeCollisionFacts.integer(point, "x"),
                    NativeCollisionFacts.integer(point, "y"), NativeCollisionFacts.integer(point, "z"));
            String expectedId = input.get("expectedBlockId").getAsString();
            if (!input.get("expectedBlockId").isJsonPrimitive()
                    || !input.get("expectedBlockId").getAsJsonPrimitive().isString()
                    || expectedId.length() > 256 || !expectedId.matches("[a-z0-9_.-]+:[a-z0-9_./-]+"))
                return failure(result, "invalid_collision_block_id");
            JsonObject expectedProperties = NativeCollisionFacts.properties(input.getAsJsonObject("expectedProperties"));
            Vec3 eye = player.getEyePosition();
            if (eye.distanceToSqr(Vec3.atCenterOf(target)) > (REACH + 1.0) * (REACH + 1.0))
                return failure(result, "collision_outside_local_range");
            if (!player.level().isLoaded(target)) return failure(result, "collision_block_not_loaded");

            // Native traverseBlocks visits only the input ray up to its first hit.
            // Check loaded local context and audited dispatch BEFORE any shape
            // getter. Calling generic level.clip on unknown mod classes could
            // otherwise execute an unaudited getter and load a distant chunk.
            Vec3 direction = Vec3.directionFromRotation(player.getXRot(), player.getYRot());
            Vec3 end = eye.add(direction.scale(REACH));
            ClipContext ray = new ClipContext(eye, end, ClipContext.Block.OUTLINE, ClipContext.Fluid.NONE, player);
            BlockHitResult hit = BlockGetter.traverseBlocks(eye, end, ray, (context, position) -> {
                loadedNeighbourhood(player, position);
                BlockState state = player.level().getBlockState(position);
                if (state.isAir()) return null;
                audited(state);
                return player.level().clipWithInteractionOverride(context.getFrom(), context.getTo(), position,
                        context.getBlockShape(state, player.level(), position), state);
            }, context -> null);
            if (hit == null || hit.getType() != HitResult.Type.BLOCK)
                return failure(result, "collision_no_visible_block");
            if (!hit.getBlockPos().equals(target)) {
                result.add("blockingPosition", position(hit.getBlockPos()));
                return failure(result, "collision_different_visible_block");
            }

            loadedNeighbourhood(player, target);
            BlockState state = player.level().getBlockState(target);
            audited(state);
            String id = BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
            JsonObject properties = new JsonObject();
            state.getValues().entrySet().stream().sorted(java.util.Comparator.comparing(entry -> entry.getKey().getName()))
                    .forEach(entry -> properties.addProperty(entry.getKey().getName(),
                            NativeCollisionFacts.propertyValue(entry.getKey(), entry.getValue())));
            if (!id.equals(expectedId) || !properties.equals(expectedProperties))
                return failure(result, "collision_block_state_changed");

            // The actual ServerLevel and actual ServerPlayer are intentional.
            // Do not replace either with EmptyBlockGetter/CollisionContext.empty,
            // visual meshes, occlusion boxes, or globally cached state geometry.
            var boxes = NativeCollisionFacts.boxes(state.getCollisionShape(player.level(), target,
                    CollisionContext.of(player)).toAabbs());
            JsonObject block = new JsonObject();
            block.addProperty("id", id); block.addProperty("stateId", Block.getId(state));
            block.add("properties", properties); block.addProperty("javaClass", state.getBlock().getClass().getName());
            block.addProperty("dynamicShape", state.getBlock().hasDynamicShape());
            block.addProperty("hasOffsetFunction", state.hasOffsetFunction());
            JsonObject context = new JsonObject();
            context.addProperty("source", "CollisionContext.of_actual_ServerPlayer");
            context.addProperty("capturedTick", player.getServer().getTickCount());
            context.addProperty("gameTime", Long.toString(player.level().getGameTime()));
            context.addProperty("pose", player.getPose().name().toLowerCase(java.util.Locale.ROOT));
            context.addProperty("width", player.getBbWidth()); context.addProperty("height", player.getBbHeight());
            context.add("playerPosition", vector(player.position()));
            context.addProperty("loadedNeighbourhoodRadius", 1);
            result.addProperty("ok", true); result.addProperty("available", true); result.addProperty("code", "native_collision_shape_observed");
            result.add("position", position(target)); result.add("block", block); result.add("context", context);
            result.add("boxes", boxes); result.addProperty("boxCount", boxes.size());
            result.addProperty("boxCoordinates", "block_local");
            result.addProperty("boxesMayExtendBeyondUnitBlock", true);
            result.addProperty("sampledAt", System.currentTimeMillis());
            result.addProperty("maxAgeMs", 250);
            if (NativeCollisionFacts.bytes(result) > NativeCollisionFacts.MAX_BYTES)
                return failure(base(player, requestId), "collision_state_too_large");
            return result;
        } catch (UnsupportedShape unsupported) {
            return failure(result, unsupported.getMessage());
        } catch (IllegalArgumentException invalid) {
            String reason = invalid.getMessage();
            return failure(result, reason != null && reason.startsWith("collision_") ? reason : "invalid_collision_query");
        } catch (RuntimeException unavailable) {
            return failure(result, "collision_query_unavailable");
        }
    }

    private static void audited(BlockState state) {
        if (state.getBlock().hasDynamicShape()) throw new UnsupportedShape("collision_dynamic_shape_unsupported");
        if (state.hasOffsetFunction()) throw new UnsupportedShape("collision_offset_shape_unsupported");
        String namespace = BuiltInRegistries.BLOCK.getKey(state.getBlock()).getNamespace();
        if (!NativeCollisionFacts.supported(namespace, state.getBlock().getClass().getName()))
            throw new UnsupportedShape("collision_class_not_audited");
    }

    private static void loadedNeighbourhood(ServerPlayer player, BlockPos position) {
        for (int x = -1; x <= 1; x++) for (int z = -1; z <= 1; z++)
            if (!player.level().isLoaded(position.offset(x, 0, z)))
                throw new UnsupportedShape("collision_context_not_loaded");
    }

    private static JsonObject base(ServerPlayer player, String requestId) {
        JsonObject result = new JsonObject();
        result.addProperty("schemaVersion", 1); result.addProperty("kind", "world_receipt");
        result.addProperty("query", "collision"); result.addProperty("requestId", requestId);
        result.addProperty("playerUuid", player.getUUID().toString());
        result.addProperty("dimension", player.level().dimension().location().toString());
        result.addProperty("source", NativeCollisionFacts.SOURCE); result.addProperty("readOnly", true);
        result.addProperty("outcomeKnown", true); result.addProperty("retryAutomatically", false);
        result.addProperty("globalStateCacheSafe", false);
        result.addProperty("physicsIntegrated", false); result.addProperty("pathfinderIntegrated", false);
        return result;
    }

    private static JsonObject failure(JsonObject result, String reason) {
        result.addProperty("ok", false); result.addProperty("available", false); result.addProperty("code", reason);
        result.add("boxes", JsonNull.INSTANCE);
        return result;
    }

    private static JsonObject position(BlockPos pos) {
        JsonObject value = new JsonObject();
        value.addProperty("x", pos.getX()); value.addProperty("y", pos.getY()); value.addProperty("z", pos.getZ());
        return value;
    }

    private static JsonObject vector(Vec3 pos) {
        JsonObject value = new JsonObject();
        value.addProperty("x", pos.x); value.addProperty("y", pos.y); value.addProperty("z", pos.z);
        return value;
    }

    private static final class UnsupportedShape extends RuntimeException {
        UnsupportedShape(String reason) { super(reason); }
    }
}
