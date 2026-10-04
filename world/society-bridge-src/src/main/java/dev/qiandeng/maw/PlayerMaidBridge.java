package dev.qiandeng.maw;

import com.github.tartaricacid.touhoulittlemaid.api.event.MaidTaskEnableEvent;
import com.github.tartaricacid.touhoulittlemaid.api.event.InteractMaidEvent;
import com.github.tartaricacid.touhoulittlemaid.api.task.IMaidTask;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import com.github.tartaricacid.touhoulittlemaid.init.InitTrigger;
import com.github.tartaricacid.touhoulittlemaid.inventory.container.AbstractMaidContainer;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

/** Owner-only interaction with real, nearby TLM maids. No summon or owner transfer. */
final class PlayerMaidBridge {
    private static final int MAX_BYTES = 16384;
    private static final int MAX_MAIDS = 8;
    private static final int MAX_TASKS = 32;
    private static final int MAX_RECEIPTS = 128;
    private static final double RANGE_SQUARED = 8.0 * 8.0;
    // Kept across reconnects in this process. Never promise replay across a restart.
    private static final Map<UUID, LinkedHashMap<String, Receipt>> RECEIPTS = new LinkedHashMap<>();
    private record Receipt(String fingerprint, String json) {}

    private record Query(String json) implements CustomPacketPayload {
        static final Type<Query> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "maid_query"));
        static final StreamCodec<RegistryFriendlyByteBuf, Query> CODEC = StreamCodec.of(
                (buf, payload) -> writeJson(buf, payload.json), buf -> new Query(readJson(buf)));
        @Override public Type<Query> type() { return TYPE; }
    }

    private record Action(String json) implements CustomPacketPayload {
        static final Type<Action> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "maid_action"));
        static final StreamCodec<RegistryFriendlyByteBuf, Action> CODEC = StreamCodec.of(
                (buf, payload) -> writeJson(buf, payload.json), buf -> new Action(readJson(buf)));
        @Override public Type<Action> type() { return TYPE; }
    }

    private record State(String json) implements CustomPacketPayload {
        static final Type<State> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "maid_state"));
        static final StreamCodec<RegistryFriendlyByteBuf, State> CODEC = StreamCodec.of(
                (buf, payload) -> writeJson(buf, payload.json), buf -> new State(readJson(buf)));
        @Override public Type<State> type() { return TYPE; }
    }

    private static void writeJson(RegistryFriendlyByteBuf buf, String json) {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new IllegalArgumentException("maid JSON too large");
        buf.writeBytes(bytes);
    }

    private static String readJson(RegistryFriendlyByteBuf buf) {
        int size = buf.readableBytes();
        if (size > MAX_BYTES) throw new IllegalArgumentException("maid JSON too large");
        byte[] bytes = new byte[size];
        buf.readBytes(bytes);
        return new String(bytes, StandardCharsets.UTF_8);
    }

    static void register(IEventBus modBus) {
        modBus.addListener(PlayerMaidBridge::registerPayloads);
    }

    private static void registerPayloads(RegisterPayloadHandlersEvent event) {
        var registrar = event.registrar("1").optional();
        registrar.playToClient(State.TYPE, State.CODEC, (payload, context) -> {});
        registrar.playToServer(Query.TYPE, Query.CODEC, (payload, context) -> {
            if (context.player() instanceof ServerPlayer player) {
                context.enqueueWork(() -> handle(player, payload.json, false));
            }
        });
        registrar.playToServer(Action.TYPE, Action.CODEC, (payload, context) -> {
            if (context.player() instanceof ServerPlayer player) {
                context.enqueueWork(() -> handle(player, payload.json, true));
            }
        });
    }

    private static JsonObject base(ServerPlayer player, String requestId, boolean ok, String code) {
        JsonObject body = new JsonObject();
        body.addProperty("schemaVersion", 1);
        body.addProperty("kind", "maid_receipt");
        body.addProperty("requestId", requestId);
        body.addProperty("playerUuid", player.getUUID().toString());
        body.addProperty("ok", ok);
        body.addProperty("code", code);
        body.addProperty("retryAutomatically", false);
        body.addProperty("replayScope", "server_process");
        return body;
    }

    private static boolean canSend(ServerPlayer player) {
        return player.connection != null && player.connection.hasChannel(State.TYPE);
    }

    private static void send(ServerPlayer player, JsonObject body) {
        if (!canSend(player)) return;
        if (body.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            JsonObject error = base(player, body.get("requestId").getAsString(), false, "maid_state_too_large");
            error.addProperty("outcome", body.has("outcome") ? body.get("outcome").getAsString() : "not_applied");
            body = error;
        }
        PacketDistributor.sendToPlayer(player, new State(body.toString()));
    }

    private static JsonElement canonical(JsonElement value) {
        if (value.isJsonObject()) {
            JsonObject sorted = new JsonObject();
            for (var entry : new TreeMap<>(value.getAsJsonObject().asMap()).entrySet()) {
                sorted.add(entry.getKey(), canonical(entry.getValue()));
            }
            return sorted;
        }
        if (value.isJsonArray()) {
            JsonArray sorted = new JsonArray();
            for (JsonElement element : value.getAsJsonArray()) sorted.add(canonical(element));
            return sorted;
        }
        return value;
    }

    private static String fingerprint(JsonObject body) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(canonical(body).toString().getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    private static void remember(ServerPlayer player, String requestId, String fingerprint, JsonObject body) {
        var receipts = RECEIPTS.computeIfAbsent(player.getUUID(), ignored -> new LinkedHashMap<>());
        receipts.put(requestId, new Receipt(fingerprint, body.toString()));
        while (receipts.size() > MAX_RECEIPTS) receipts.remove(receipts.keySet().iterator().next());
        while (RECEIPTS.size() > 128) RECEIPTS.remove(RECEIPTS.keySet().iterator().next());
    }

    private static boolean eligible(ServerPlayer player, EntityMaid maid) {
        return maid.isAlive() && !maid.isRemoved() && maid.level() == player.level()
                && player.serverLevel().hasChunkAt(maid.blockPosition())
                && maid.isTame() && maid.isOwnedBy(player)
                && player.distanceToSqr(maid) <= RANGE_SQUARED;
    }

    private static EntityMaid find(ServerPlayer player, String uuid) {
        // getEntity on this ServerLevel only consults already loaded entities.
        var entity = player.serverLevel().getEntity(UUID.fromString(uuid));
        return entity instanceof EntityMaid maid && eligible(player, maid) ? maid : null;
    }

    private static String limit(String text, int size) {
        return text.length() > size ? text.substring(0, size) : text;
    }

    private static JsonObject item(ItemStack stack, int slot) {
        if (stack.isEmpty()) return null;
        JsonObject row = new JsonObject();
        row.addProperty("slot", slot);
        row.addProperty("id", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
        row.addProperty("name", limit(stack.getHoverName().getString(), 80));
        row.addProperty("count", stack.getCount());
        return row;
    }

    private static JsonObject maidState(ServerPlayer player, EntityMaid maid) {
        JsonObject row = new JsonObject();
        row.addProperty("uuid", maid.getUUID().toString());
        row.addProperty("entityId", maid.getId());
        row.addProperty("type", BuiltInRegistries.ENTITY_TYPE.getKey(maid.getType()).toString());
        row.addProperty("name", limit(maid.getName().getString(), 80));
        row.addProperty("ownerUuid", player.getUUID().toString());
        row.addProperty("owned", maid.isOwnedBy(player));
        row.addProperty("loaded", true);
        row.addProperty("dimension", maid.level().dimension().location().toString());
        JsonObject pos = new JsonObject();
        pos.addProperty("x", maid.getX()); pos.addProperty("y", maid.getY()); pos.addProperty("z", maid.getZ());
        row.add("position", pos);
        row.addProperty("distance", Math.sqrt(player.distanceToSqr(maid)));
        row.addProperty("health", maid.getHealth());
        row.addProperty("maxHealth", maid.getMaxHealth());
        row.addProperty("hunger", maid.getHunger());
        row.add("saturation", null); // TLM exposes hunger, not vanilla FoodData saturation.
        row.addProperty("taskId", maid.getTask().getUid().toString());
        row.addProperty("taskName", limit(maid.getTask().getName().getString(), 80));
        row.addProperty("sitting", maid.isMaidInSittingPose());
        row.addProperty("follow", !maid.isMaidInSittingPose() && !maid.isHomeModeEnable());
        row.addProperty("homeMode", maid.isHomeModeEnable());
        row.addProperty("pickup", maid.isPickup());
        row.addProperty("sleeping", maid.isSleeping());
        row.addProperty("schedule", maid.getSchedule().name().toLowerCase(Locale.ROOT));
        row.addProperty("activity", maid.getScheduleDetail().getName());
        row.addProperty("backpackType", maid.getMaidBackpackType().getId().toString());
        var inventory = maid.getAvailableBackpackInv();
        row.addProperty("bagSlots", inventory.getSlots());
        JsonArray bag = new JsonArray();
        for (int slot = 0; slot < Math.min(inventory.getSlots(), 54); slot++) {
            JsonObject stack = item(inventory.getStackInSlot(slot), slot);
            if (stack != null) bag.add(stack);
        }
        row.add("bag", bag);
        row.addProperty("bagTruncated", inventory.getSlots() > 54);
        row.add("mainHand", item(maid.getMainHandItem(), -1));
        return row;
    }

    private static void handle(ServerPlayer player, String raw, boolean mutation) {
        if (!canSend(player)) return; // Do not execute a mutation without a private receipt channel.
        String requestId = "invalid";
        String fingerprint = null;
        boolean started = false;
        try {
            JsonObject input = JsonParser.parseString(raw).getAsJsonObject();
            requestId = input.get("requestId").getAsString();
            if (!requestId.matches("[A-Za-z0-9:_-]{1,64}")) return;
            fingerprint = fingerprint(input);
            if (mutation) {
                Receipt cached = RECEIPTS.getOrDefault(player.getUUID(), new LinkedHashMap<>()).get(requestId);
                if (cached != null) {
                    if (!cached.fingerprint.equals(fingerprint)) {
                        send(player, base(player, requestId, false, "request_id_conflict"));
                    } else {
                        JsonObject replay = JsonParser.parseString(cached.json).getAsJsonObject();
                        replay.addProperty("replayed", true);
                        send(player, replay);
                    }
                    return;
                }
            }
            if (input.get("schemaVersion").getAsInt() != 1) throw new IllegalArgumentException("schema");
            String kind = input.get("kind").getAsString();
            JsonObject result = base(player, requestId, true, "ok");
            result.addProperty("action", kind);
            result.addProperty("outcome", "not_applied");
            if (!mutation && kind.equals("list")) {
                JsonArray maids = new JsonArray();
                var nearby = player.serverLevel().getEntitiesOfClass(EntityMaid.class,
                        player.getBoundingBox().inflate(8), maid -> eligible(player, maid));
                nearby.sort(Comparator.comparingInt(EntityMaid::getId));
                for (EntityMaid maid : nearby) {
                    if (maids.size() >= MAX_MAIDS) break;
                    JsonObject summary = maidState(player, maid);
                    summary.remove("bag"); // Detailed inventory belongs to a single-maid status query.
                    maids.add(summary);
                }
                result.add("maids", maids);
                result.addProperty("count", nearby.size());
                result.addProperty("truncated", nearby.size() > maids.size());
            } else {
                EntityMaid maid = find(player, input.get("maidUuid").getAsString());
                if (maid == null) {
                    result.addProperty("ok", false);
                    result.addProperty("code", "maid_not_owned_nearby_loaded");
                } else if (!mutation && kind.equals("status")) {
                    result.add("maid", maidState(player, maid));
                } else if (!mutation && kind.equals("tasks")) {
                    JsonArray tasks = new JsonArray();
                    var available = TaskManager.getNotHiddenTaskList(maid);
                    for (IMaidTask task : available) {
                        if (tasks.size() >= MAX_TASKS) break;
                        JsonObject entry = new JsonObject();
                        entry.addProperty("id", task.getUid().toString());
                        entry.addProperty("name", limit(task.getName().getString(), 80));
                        entry.addProperty("enabled", task.isEnable(maid));
                        entry.addProperty("summary", limit(task.getMaidActionSummary(), 240));
                        tasks.add(entry);
                    }
                    result.add("tasks", tasks);
                    result.addProperty("taskCount", available.size());
                    result.addProperty("truncated", available.size() > tasks.size());
                } else if (mutation) {
                    if (maid.isSleeping()) {
                        result.addProperty("ok", false); result.addProperty("code", "maid_sleeping");
                    } else if (kind.equals("task_set")) {
                        ResourceLocation uid = ResourceLocation.tryParse(input.get("taskId").getAsString());
                        IMaidTask task = uid == null ? null : TaskManager.findTask(uid).orElse(null);
                        if (task == null || task.isHidden(maid)) {
                            result.addProperty("ok", false); result.addProperty("code", "unknown_or_hidden_task");
                        } else if ((task != TaskManager.getIdleTask()
                                && NeoForge.EVENT_BUS.post(new MaidTaskEnableEvent(task, maid)).isCanceled())
                                || !task.isEnable(maid)) {
                            result.addProperty("ok", false); result.addProperty("code", "task_disabled");
                        } else {
                            started = true;
                            remember(player, requestId, fingerprint, base(player, requestId, false, "action_outcome_unknown"));
                            maid.setTask(task); // Real task setter refreshes the real server Brain.
                            if (task != TaskManager.getIdleTask()) InitTrigger.MAID_EVENT.get().trigger(player, "switch_task");
                            result.addProperty("code", "task_set"); result.addProperty("outcome", "applied");
                        }
                    } else if (kind.equals("follow_set")) {
                        if (!input.get("follow").isJsonPrimitive() || !input.get("follow").getAsJsonPrimitive().isBoolean()) {
                            throw new IllegalArgumentException("follow must be boolean");
                        }
                        boolean follow = input.get("follow").getAsBoolean();
                        started = true;
                        remember(player, requestId, fingerprint, base(player, requestId, false, "action_outcome_unknown"));
                        if (follow) maid.setHomeModeEnable(false);
                        maid.setInSittingPose(!follow);
                        result.addProperty("code", "follow_set"); result.addProperty("outcome", "applied");
                    } else if (kind.equals("pickup_set")) {
                        if (!input.get("pickup").isJsonPrimitive() || !input.get("pickup").getAsJsonPrimitive().isBoolean()) {
                            throw new IllegalArgumentException("pickup must be boolean");
                        }
                        boolean pickup = input.get("pickup").getAsBoolean();
                        started = true;
                        remember(player, requestId, fingerprint, base(player, requestId, false, "action_outcome_unknown"));
                        maid.setPickup(pickup);
                        result.addProperty("code", "pickup_set"); result.addProperty("outcome", "applied");
                    } else if (kind.equals("open_bag")) {
                        if (player.containerMenu != player.inventoryMenu) {
                            result.addProperty("ok", false); result.addProperty("code", "close_current_menu_first");
                        } else if (NeoForge.EVENT_BUS.post(new InteractMaidEvent(player, maid, player.getMainHandItem())).isCanceled()) {
                            result.addProperty("ok", false); result.addProperty("code", "maid_interaction_denied");
                        } else {
                            started = true;
                            remember(player, requestId, fingerprint, base(player, requestId, false, "action_outcome_unknown"));
                            maid.openMaidGui(player);
                            if (player.containerMenu instanceof AbstractMaidContainer menu && menu.getMaid() == maid
                                    && menu.stillValid(player)) {
                                result.addProperty("windowId", menu.containerId);
                                result.addProperty("code", "native_menu_opened"); result.addProperty("outcome", "applied");
                            } else {
                                if (player.containerMenu != player.inventoryMenu) player.closeContainer();
                                result.addProperty("ok", false); result.addProperty("code", "native_menu_not_opened_or_valid");
                            }
                        }
                    } else {
                        result.addProperty("ok", false); result.addProperty("code", "unsupported_action");
                    }
                    result.add("maid", maidState(player, maid));
                } else {
                    result.addProperty("ok", false); result.addProperty("code", "unsupported_query");
                }
            }
            if (mutation) remember(player, requestId, fingerprint, result);
            send(player, result);
        } catch (RuntimeException error) {
            JsonObject result = base(player, requestId, false, started ? "action_outcome_unknown" : "invalid_request");
            result.addProperty("outcome", started ? "unknown" : "not_applied");
            if (mutation && fingerprint != null) remember(player, requestId, fingerprint, result);
            send(player, result);
        }
    }
}
