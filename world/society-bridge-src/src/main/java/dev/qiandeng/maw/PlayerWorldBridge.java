package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.simibubi.create.AllRecipeTypes;
import com.simibubi.create.content.kinetics.base.KineticBlockEntity;
import com.simibubi.create.content.contraptions.ControlledContraptionEntity;
import com.simibubi.create.content.contraptions.bearing.WindmillBearingBlockEntity;
import com.simibubi.create.content.kinetics.millstone.MillingRecipe;
import com.simibubi.create.content.kinetics.millstone.MillstoneBlockEntity;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.Tag;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.minecraft.world.item.crafting.RecipeInput;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.TamableAnimal;
import net.minecraft.world.entity.OwnableEntity;
import net.minecraft.world.entity.monster.Enemy;
import net.minecraft.world.entity.npc.AbstractVillager;
import net.minecraft.world.entity.player.Player;
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
import net.neoforged.neoforge.items.IItemHandler;
import net.neoforged.neoforge.items.wrapper.RecipeWrapper;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import vectorwing.farmersdelight.common.block.entity.AbstractStoveBlockEntity;
import vectorwing.farmersdelight.common.block.entity.CuttingBoardBlockEntity;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.Set;
import java.util.HashSet;

/** Native identity for only the block this player can currently see. */
final class PlayerWorldBridge {
    private static final int MAX_REQUEST = 4096;
    private static final int MAX_STATE = 65536;
    private static final Map<UUID, Integer> LAST_QUERY_TICK = new HashMap<>();
    private static final Map<UUID, Set<UUID>> TRACKED = new HashMap<>();

    private record Query(String json) implements CustomPacketPayload {
        static final Type<Query> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "world_query"));
        static final StreamCodec<RegistryFriendlyByteBuf, Query> CODEC = StreamCodec.of(
                (buf, payload) -> writeJson(buf, payload.json, MAX_REQUEST), buf -> new Query(readJson(buf, MAX_REQUEST)));

        @Override public Type<Query> type() { return TYPE; }
    }

    private record State(String json) implements CustomPacketPayload {
        static final Type<State> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "world_state"));
        static final StreamCodec<RegistryFriendlyByteBuf, State> CODEC = StreamCodec.of(
                (buf, payload) -> writeJson(buf, payload.json, MAX_STATE), buf -> new State(readJson(buf, MAX_STATE)));

        @Override public Type<State> type() { return TYPE; }
    }

    private static void writeJson(RegistryFriendlyByteBuf buf, String json, int limit) {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > limit) throw new IllegalArgumentException("world JSON too large");
        buf.writeBytes(bytes);
    }

    private static String readJson(RegistryFriendlyByteBuf buf, int limit) {
        int size = buf.readableBytes();
        if (size > limit) throw new IllegalArgumentException("world JSON too large");
        byte[] bytes = new byte[size];
        buf.readBytes(bytes);
        return new String(bytes, StandardCharsets.UTF_8);
    }

    static void register(IEventBus modBus) {
        modBus.addListener(PlayerWorldBridge::registerPayloads);
        NeoForge.EVENT_BUS.addListener(PlayerWorldBridge::onLogout);
        NeoForge.EVENT_BUS.addListener(PlayerWorldBridge::onStartTracking);
        NeoForge.EVENT_BUS.addListener(PlayerWorldBridge::onStopTracking);
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
        if (event.getEntity() instanceof ServerPlayer player) {
            LAST_QUERY_TICK.remove(player.getUUID());
            TRACKED.remove(player.getUUID());
        }
    }

    private static void onStartTracking(PlayerEvent.StartTracking event) {
        if (event.getEntity() instanceof ServerPlayer player)
            TRACKED.computeIfAbsent(player.getUUID(), ignored -> new HashSet<>()).add(event.getTarget().getUUID());
    }

    private static void onStopTracking(PlayerEvent.StopTracking event) {
        if (event.getEntity() instanceof ServerPlayer player) {
            Set<UUID> values = TRACKED.get(player.getUUID());
            if (values != null) values.remove(event.getTarget().getUUID());
        }
    }

    static boolean isTracked(ServerPlayer player, Entity entity) {
        return TRACKED.getOrDefault(player.getUUID(), Set.of()).contains(entity.getUUID()) &&
                entity.level() == player.level();
    }

    static JsonArray maidRenderStates(ServerPlayer player) {
        JsonArray rows = new JsonArray();
        // Only this connection's tracked identities, never a world entity scan.
        for (UUID uuid : TRACKED.getOrDefault(player.getUUID(), Set.of()).stream().sorted().toList()) {
            Entity entity = player.serverLevel().getEntity(uuid);
            if (!(entity instanceof EntityMaid maid) || !isTracked(player, maid) || !maid.isAlive() ||
                    player.distanceTo(maid) > 16 || !player.hasLineOfSight(maid)) continue;
            if (rows.size() >= 16) break;
            JsonObject row = new JsonObject();
            row.addProperty("source", "same_player_tracked_entity");
            row.addProperty("playerUuid", player.getUUID().toString());
            row.addProperty("entityId", maid.getId()); row.addProperty("uuid", maid.getUUID().toString());
            row.addProperty("dimension", player.level().dimension().location().toString());
            row.addProperty("passenger", maid.isPassenger());
            row.addProperty("swimAmount", maid.getSwimAmount(1));
            row.addProperty("inSwimFluid", maid.isInWater() || maid.isInFluidType((type, height) -> maid.canSwimInFluidType(type)));
            row.addProperty("backpackType", maid.getMaidBackpackType().getId().toString());
            // Both original BackItem and Banner layers read this same getter.
            row.add("backItem", PlayerMenuBridge.nativeItem(player, maid.getBackpackShowItem()));
            row.add("bannerItem", PlayerMenuBridge.nativeItem(player, maid.getBackpackShowItem()));
            rows.add(row);
        }
        return rows;
    }

    static JsonArray contraptionRenderStates(ServerPlayer player) {
        JsonArray rows = new JsonArray();
        int bytes = 0;
        for (UUID uuid : TRACKED.getOrDefault(player.getUUID(), Set.of()).stream().sorted().toList()) {
            Entity entity = player.serverLevel().getEntity(uuid);
            // Rendering follows the entity actually tracked by this connection.
            // Its centre can be hidden by its own bearing while sails remain
            // visible. Java clients still receive its geometry and depth-test
            // it; centre-point LOS would incorrectly erase the entire rotor.
            // This is not the visibility-gated native.entity/world.look API.
            if (!(entity instanceof ControlledContraptionEntity contraption) || !isTracked(player, entity) ||
                    !entity.isAlive() || player.distanceTo(entity) > 32) continue;
            if (rows.size() >= 4) break;
            JsonObject row = PlayerWindmillState.contraption(player, contraption);
            int size = row.toString().getBytes(StandardCharsets.UTF_8).length;
            if (bytes + size > 24000) {
                row.remove("blocks"); row.addProperty("available", false);
                row.addProperty("reason", "contraption_snapshot_budget_exceeded");
                size = row.toString().getBytes(StandardCharsets.UTF_8).length;
            }
            rows.add(row); bytes += size;
        }
        return rows;
    }

    private static void entity(ServerPlayer player, JsonObject input, String requestId) {
        int entityId = input.get("entityId").getAsInt();
        UUID expected = UUID.fromString(input.get("expectedUuid").getAsString());
        Entity entity = player.serverLevel().getEntity(entityId);
        if (entity == null || !expected.equals(entity.getUUID())) { reject(player, requestId, "entity_identity_changed"); return; }
        if (!isTracked(player, entity)) { reject(player, requestId, "entity_not_tracked"); return; }
        if (!entity.isAlive() || entity.isRemoved()) { reject(player, requestId, "entity_not_alive"); return; }
        double distance = player.position().distanceTo(entity.position());
        if (distance > 12) { reject(player, requestId, "entity_outside_local_range"); return; }
        if (!player.hasLineOfSight(entity)) { reject(player, requestId, "entity_not_visible"); return; }
        String id = BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString();
        JsonObject value = new JsonObject();
        value.addProperty("entityId", entity.getId());
        value.addProperty("uuid", entity.getUUID().toString());
        value.addProperty("id", id);
        value.addProperty("dimension", player.level().dimension().location().toString());
        JsonObject position = new JsonObject();
        position.addProperty("x", entity.getX()); position.addProperty("y", entity.getY()); position.addProperty("z", entity.getZ());
        value.add("position", position);
        value.addProperty("distance", distance);
        if (entity instanceof LivingEntity living) {
            value.addProperty("health", living.getHealth()); value.addProperty("maxHealth", living.getMaxHealth());
        } else { value.add("health", JsonNull.INSTANCE); value.add("maxHealth", JsonNull.INSTANCE); }
        UUID owner = entity instanceof OwnableEntity owned ? owned.getOwnerUUID() : null;
        boolean tamed = entity instanceof TamableAnimal animal && animal.isTame();
        boolean npc = entity instanceof Player || entity instanceof AbstractVillager ||
                id.equals("touhou_little_maid:maid") || id.startsWith("minecolonies:citizen");
        value.addProperty("hostile", entity instanceof Enemy);
        value.addProperty("tameable", entity instanceof TamableAnimal);
        value.addProperty("tamed", tamed);
        value.addProperty("ownerKnown", true);
        if (owner == null) value.add("ownerUuid", JsonNull.INSTANCE); else value.addProperty("ownerUuid", owner.toString());
        value.addProperty("npc", npc);
        if (entity.getCustomName() == null) value.add("customName", JsonNull.INSTANCE);
        else value.addProperty("customName", entity.getCustomName().getString());
        value.addProperty("friendlyToPlayer", entity.isAlliedTo(player) || owner != null || tamed || npc);
        value.addProperty("hasLineOfSight", true);
        value.addProperty("inReach", distance <= 3);
        value.addProperty("interactionReach", distance <= 4.5);
        JsonObject result = result(requestId);
        result.addProperty("ok", true); result.addProperty("query", "entity");
        result.addProperty("source", "same_player_tracked_entity"); result.add("entity", value);
        send(player, result);
    }

    private static void send(ServerPlayer player, JsonObject result) {
        if (NativeModAccess.capturing(player) || player.connection != null && player.connection.hasChannel(State.TYPE)) {
            result.addProperty("playerUuid", player.getUUID().toString());
            String json = result.toString();
            int budget = result.has("query") && result.get("query").getAsString().equals("body_snapshot") ? MAX_STATE : 16384;
            // Never truncate a native item component or let encoding a large
            // component fail the connection. The caller receives an explicit
            // private failure instead of an apparently complete inventory.
            if (json.getBytes(StandardCharsets.UTF_8).length > budget) {
                JsonObject oversized = result(result.get("requestId").getAsString());
                oversized.addProperty("playerUuid", player.getUUID().toString());
                oversized.addProperty("ok", false);
                oversized.addProperty("code", "world_state_too_large");
                oversized.addProperty("maxBytes", budget);
                json = oversized.toString();
            }
            if (!NativeModAccess.capture(player, json)) PacketDistributor.sendToPlayer(player, new State(json));
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

    private static JsonArray inventory(ServerPlayer player, IItemHandler handler) {
        JsonArray items = new JsonArray();
        for (int slot = 0; slot < handler.getSlots(); slot++) {
            ItemStack stack = handler.getStackInSlot(slot);
            if (stack.isEmpty()) continue;
            JsonObject item = new JsonObject();
            item.addProperty("slot", slot);
            item.addProperty("id", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
            item.addProperty("count", stack.getCount());
            // Includes the complete native components, not the vanilla-facing
            // proxy item or a guessed ID-to-item mapping.
            item.addProperty("snbt", stack.saveOptional(player.registryAccess()).toString());
            items.add(item);
        }
        return items;
    }

    private static JsonObject millstone(ServerPlayer player, MillstoneBlockEntity machine, JsonObject rotation) {
        // This is in-memory serialization of this single visible BE. It reads
        // the real cached Network fields without creating/updating a network,
        // scanning its members, touching a save file, or applying a recipe.
        CompoundTag snapshot = new CompoundTag();
        machine.write(snapshot, player.registryAccess(), true);
        boolean connected = snapshot.contains("Network", Tag.TAG_COMPOUND);
        CompoundTag network = snapshot.getCompound("Network");
        rotation.addProperty("rpm", machine.getSpeed());
        rotation.addProperty("networkConnected", connected);
        if (connected && network.contains("Stress", Tag.TAG_ANY_NUMERIC)) {
            rotation.addProperty("networkStress", network.getFloat("Stress"));
        } else rotation.add("networkStress", JsonNull.INSTANCE);
        if (connected && network.contains("Capacity", Tag.TAG_ANY_NUMERIC)) {
            rotation.addProperty("stressCapacity", network.getFloat("Capacity"));
        } else rotation.add("stressCapacity", JsonNull.INSTANCE);
        rotation.addProperty("stressUnit", "SU");

        JsonArray input = inventory(player, machine.inputInv);
        JsonArray output = inventory(player, machine.outputInv);
        boolean inputPresent = !input.isEmpty();
        boolean outputAvailable = !output.isEmpty();
        boolean outputBlocked = false;
        // Matches Create 6.0.10's actual tick guard: any output slot exactly at
        // its slot limit pauses processing, even when other slots are empty.
        for (int slot = 0; slot < machine.outputInv.getSlots(); slot++) {
            if (machine.outputInv.getStackInSlot(slot).getCount() == machine.outputInv.getSlotLimit(slot)) {
                outputBlocked = true;
                break;
            }
        }
        Optional<RecipeHolder<MillingRecipe>> recipe = inputPresent
                ? AllRecipeTypes.MILLING.<RecipeInput, MillingRecipe>find(new RecipeWrapper(machine.inputInv), player.level())
                : Optional.empty();
        boolean waitingForPower = machine.getSpeed() == 0;
        JsonObject processing = new JsonObject();
        processing.addProperty("type", "create:milling");
        processing.addProperty("inputSlotCount", machine.inputInv.getSlots());
        processing.addProperty("outputSlotCount", machine.outputInv.getSlots());
        processing.add("input", input);
        processing.add("output", output);
        processing.addProperty("timer", machine.timer);
        // Timer is Create's remaining processing work, not wall-clock ticks.
        processing.addProperty("timerUnit", "processing_work_ticks");
        processing.addProperty("processingSpeed", machine.getProcessingSpeed());
        processing.addProperty("advancing", !waitingForPower && !outputBlocked && machine.timer > 0);
        processing.addProperty("waitingForPower", waitingForPower);
        processing.addProperty("outputAvailable", outputAvailable);
        processing.addProperty("outputBlocked", outputBlocked);
        processing.addProperty("canCollectOutput", outputAvailable);
        if (recipe.isPresent()) {
            processing.addProperty("recipeId", recipe.get().id().toString());
            processing.addProperty("recipeDuration", recipe.get().value().getProcessingDuration());
        } else {
            processing.add("recipeId", JsonNull.INSTANCE);
            processing.add("recipeDuration", JsonNull.INSTANCE);
        }
        String status;
        if (outputBlocked) status = "output_blocked";
        else if (!inputPresent) status = outputAvailable ? "output_ready" : "waiting_input";
        else if (recipe.isEmpty()) status = "invalid_input";
        else if (machine.isOverStressed()) status = "overstressed";
        else if (waitingForPower) status = "waiting_power";
        else status = machine.timer > 0 ? "processing" : "ready_to_process";
        processing.addProperty("status", status);
        return processing;
    }

    static void handle(ServerPlayer player, String raw) {
        String requestId = "invalid";
        try {
            JsonObject input = JsonParser.parseString(raw).getAsJsonObject();
            requestId = input.get("requestId").getAsString();
            if (!requestId.matches("[A-Za-z0-9:_-]{1,64}")) return;
            String kind = input.get("kind").getAsString();
            if (input.get("schemaVersion").getAsInt() != 1 ||
                    !(kind.equals("look") || kind.equals("entity") || kind.equals("recipes") || kind.equals("collision") ||
                            kind.equals("capabilities") || kind.equals("body_snapshot") || kind.equals("body_observe"))) {
                reject(player, requestId, "unsupported_query"); return;
            }
            int now = player.getServer().getTickCount();
            Integer last = LAST_QUERY_TICK.get(player.getUUID());
            if (last != null && now - last < 2) {
                reject(player, requestId, "rate_limited"); return;
            }
            LAST_QUERY_TICK.put(player.getUUID(), now);
            if (kind.equals("capabilities") || kind.equals("body_snapshot") || kind.equals("body_observe")) {
                send(player, PlayerBodyState.query(player, input, result(requestId))); return;
            }
            if (kind.equals("collision")) { send(player, PlayerCollisionBridge.query(player, input, requestId)); return; }
            if (kind.equals("entity")) { entity(player, input, requestId); return; }
            if (kind.equals("recipes")) { send(player, PlayerRecipeCatalog.query(player, input, result(requestId))); return; }
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
            JsonObject hitDetails = new JsonObject();
            hitDetails.addProperty("face", blockHit.getDirection().get3DDataValue());
            JsonObject cursor = new JsonObject();
            cursor.addProperty("x", blockHit.getLocation().x - pos.getX());
            cursor.addProperty("y", blockHit.getLocation().y - pos.getY());
            cursor.addProperty("z", blockHit.getLocation().z - pos.getZ());
            hitDetails.add("cursor", cursor); result.add("hit", hitDetails);
            JsonObject block = new JsonObject();
            block.addProperty("id", BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
            JsonObject properties = new JsonObject();
            state.getValues().forEach((property, value) -> properties.addProperty(property.getName(), NativeCollisionFacts.propertyValue(property, value)));
            block.add("properties", properties);
            block.addProperty("requiresCorrectToolForDrops", state.requiresCorrectToolForDrops());
            block.addProperty("canHarvestWithMainHand", state.canHarvestBlock(player.level(), pos, player));
            block.addProperty("destroySpeed", state.getDestroySpeed(player.level(), pos));
            block.addProperty("mainHandItemId", BuiltInRegistries.ITEM.getKey(player.getMainHandItem().getItem()).toString());
            BlockEntity entity = player.level().getBlockEntity(pos);
            if (entity != null) {
                block.addProperty("blockEntityType", BuiltInRegistries.BLOCK_ENTITY_TYPE.getKey(entity.getType()).toString());
                if (entity instanceof KineticBlockEntity kinetic) {
                    JsonObject rotation = new JsonObject();
                    rotation.addProperty("speed", kinetic.getSpeed());
                    rotation.addProperty("theoreticalSpeed", kinetic.getTheoreticalSpeed());
                    rotation.addProperty("overstressed", kinetic.isOverStressed());
                    rotation.addProperty("speedRequirementFulfilled", kinetic.isSpeedRequirementFulfilled());
                    if (entity instanceof MillstoneBlockEntity machine) {
                        block.add("processing", millstone(player, machine, rotation));
                    }
                    block.add("kinetic", rotation);
                }
                if (entity instanceof WindmillBearingBlockEntity bearing) {
                    block.add("windmill", PlayerWindmillState.bearing(bearing));
                }
                if (entity instanceof AbstractStoveBlockEntity stove) {
                    JsonObject fd = new JsonObject();
                    fd.addProperty("source", "native_visible_block_entity"); fd.addProperty("kind", "stove");
                    fd.add("inventory", inventory(player, stove.getItems()));
                    fd.addProperty("nextEmptySlot", stove.getNextEmptySlot()); fd.addProperty("full", stove.isFull());
                    fd.addProperty("slotLimit", 1); fd.addProperty("slotCount", stove.getItems().getSlots());
                    if (state.hasProperty(BlockStateProperties.LIT)) fd.addProperty("lit", state.getValue(BlockStateProperties.LIT));
                    CompoundTag data = new CompoundTag(); stove.saveAdditional(data, player.registryAccess());
                    JsonArray progress = new JsonArray(), duration = new JsonArray();
                    for (int value : data.getIntArray("CookingTimes")) progress.add(value);
                    for (int value : data.getIntArray("CookingTotalTimes")) duration.add(value);
                    fd.add("cookingTimes", progress); fd.add("cookingTotalTimes", duration);
                    block.add("farmersDelight", fd);
                } else if (entity instanceof CuttingBoardBlockEntity board) {
                    JsonObject fd = new JsonObject();
                    fd.addProperty("source", "native_visible_block_entity"); fd.addProperty("kind", "cutting_board");
                    fd.add("inventory", inventory(player, board.getInventory()));
                    fd.add("storedItem", PlayerMenuBridge.nativeItem(player, board.getStoredItem()));
                    fd.addProperty("maxStackSize", board.getMaxStackSize()); fd.addProperty("empty", board.isEmpty());
                    fd.addProperty("isItemCarvingBoard", board.isItemCarvingBoard());
                    block.add("farmersDelight", fd);
                }
            }
            result.add("block", block);
            send(player, result);
        } catch (RuntimeException error) {
            reject(player, requestId, "invalid_world_query");
        }
    }
}
