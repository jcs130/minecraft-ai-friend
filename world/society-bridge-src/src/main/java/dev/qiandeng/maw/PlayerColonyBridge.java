package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.minecolonies.api.colony.IColony;
import com.minecolonies.api.colony.IColonyManager;
import com.minecolonies.api.colony.ICitizenData;
import com.minecolonies.api.colony.buildings.IBuilding;
import com.minecolonies.api.colony.requestsystem.request.IRequest;
import com.minecolonies.api.colony.requestsystem.request.RequestState;
import com.minecolonies.api.colony.requestsystem.manager.IRequestManager;
import com.minecolonies.api.colony.requestsystem.requestable.IDeliverable;
import com.minecolonies.api.colony.requestsystem.token.IToken;
import com.minecolonies.api.colony.workorders.IServerWorkOrder;
import com.minecolonies.api.util.InventoryUtils;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;

/** Read-only MineColonies facts for the colony this player is visiting or owns. */
final class PlayerColonyBridge {
    private static final int MAX_BYTES = 16384;
    private static final int MAX_ROWS = 24;
    private static final Map<UUID, Integer> LAST_QUERY_TICK = new HashMap<>();
    private static final Map<UUID, LinkedHashMap<String, String>> ACTION_RECEIPTS = new HashMap<>();

    private record Query(String json) implements CustomPacketPayload {
        static final Type<Query> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "colony_query"));
        static final StreamCodec<RegistryFriendlyByteBuf, Query> CODEC = StreamCodec.of(
                (buf, payload) -> writeJson(buf, payload.json), buf -> new Query(readJson(buf)));
        @Override public Type<Query> type() { return TYPE; }
    }

    private record State(String json) implements CustomPacketPayload {
        static final Type<State> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "colony_state"));
        static final StreamCodec<RegistryFriendlyByteBuf, State> CODEC = StreamCodec.of(
                (buf, payload) -> writeJson(buf, payload.json), buf -> new State(readJson(buf)));
        @Override public Type<State> type() { return TYPE; }
    }

    private record Action(String json) implements CustomPacketPayload {
        static final Type<Action> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "colony_action"));
        static final StreamCodec<RegistryFriendlyByteBuf, Action> CODEC = StreamCodec.of(
                (buf, payload) -> writeJson(buf, payload.json), buf -> new Action(readJson(buf)));
        @Override public Type<Action> type() { return TYPE; }
    }

    private static void writeJson(RegistryFriendlyByteBuf buf, String json) {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new IllegalArgumentException("colony JSON too large");
        buf.writeBytes(bytes);
    }

    private static String readJson(RegistryFriendlyByteBuf buf) {
        int size = buf.readableBytes();
        if (size > MAX_BYTES) throw new IllegalArgumentException("colony JSON too large");
        byte[] bytes = new byte[size];
        buf.readBytes(bytes);
        return new String(bytes, StandardCharsets.UTF_8);
    }

    static void register(IEventBus modBus) {
        modBus.addListener(PlayerColonyBridge::registerPayloads);
        NeoForge.EVENT_BUS.addListener(PlayerColonyBridge::onLogout);
    }

    private static void registerPayloads(RegisterPayloadHandlersEvent event) {
        var registrar = event.registrar("1").optional();
        registrar.playToClient(State.TYPE, State.CODEC, (payload, context) -> {});
        registrar.playToServer(Query.TYPE, Query.CODEC, (payload, context) -> {
            if (context.player() instanceof ServerPlayer player) {
                context.enqueueWork(() -> handle(player, payload.json));
            }
        });
        registrar.playToServer(Action.TYPE, Action.CODEC, (payload, context) -> {
            if (context.player() instanceof ServerPlayer player) {
                context.enqueueWork(() -> handleAction(player, payload.json));
            }
        });
    }

    private static void onLogout(PlayerEvent.PlayerLoggedOutEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) {
            LAST_QUERY_TICK.remove(player.getUUID());
            ACTION_RECEIPTS.remove(player.getUUID());
        }
    }

    private static JsonObject base(String requestId) {
        JsonObject result = new JsonObject();
        result.addProperty("schemaVersion", 1);
        result.addProperty("kind", "colony_receipt");
        result.addProperty("requestId", requestId);
        return result;
    }

    private static void send(ServerPlayer player, JsonObject body) {
        if (player.connection == null || !player.connection.hasChannel(State.TYPE)) return;
        body.addProperty("playerUuid", player.getUUID().toString());
        if (body.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            JsonObject error = base(body.get("requestId").getAsString());
            error.addProperty("ok", false);
            error.addProperty("code", "colony_state_too_large");
            error.addProperty("playerUuid", player.getUUID().toString());
            body = error;
        }
        PacketDistributor.sendToPlayer(player, new State(body.toString()));
    }

    private static void reject(ServerPlayer player, String requestId, String code) {
        JsonObject body = base(requestId);
        body.addProperty("ok", false);
        body.addProperty("code", code);
        send(player, body);
    }

    private static JsonObject pos(BlockPos pos) {
        JsonObject value = new JsonObject();
        value.addProperty("x", pos.getX());
        value.addProperty("y", pos.getY());
        value.addProperty("z", pos.getZ());
        return value;
    }

    private static String limit(String value, int max) {
        return value.length() <= max ? value : value.substring(0, max);
    }

    private static boolean open(RequestState state) {
        return state != RequestState.COMPLETED && state != RequestState.CANCELLED
                && state != RequestState.OVERRULED && state != RequestState.FAILED;
    }

    private static JsonObject request(IRequestManager manager, IRequest<?> request, BlockPos buildingPos) {
        JsonObject row = new JsonObject();
        row.addProperty("token", request.getId().getIdentifier().toString());
        row.addProperty("state", request.getState().name().toLowerCase());
        row.addProperty("description", limit(request.getShortDisplayString().getString(), 160));
        row.addProperty("requestType", request.getRequest().getClass().getSimpleName());
        if (request.getRequest() instanceof IDeliverable deliverable) {
            row.addProperty("requestedCount", deliverable.getCount());
            row.addProperty("minimumCount", deliverable.getMinimumCount());
        }
        row.addProperty("requester", limit(request.getRequester()
                .getRequesterDisplayName(manager, request).getString(), 100));
        if (buildingPos != null) row.add("buildingPosition", pos(buildingPos));
        JsonArray items = new JsonArray();
        for (ItemStack stack : request.getDisplayStacks()) {
            if (stack.isEmpty() || items.size() >= 3) continue;
            JsonObject item = new JsonObject();
            item.addProperty("id", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
            item.addProperty("name", limit(stack.getHoverName().getString(), 100));
            item.addProperty("count", stack.getCount());
            items.add(item);
        }
        row.add("displayItems", items);
        return row;
    }

    private static IColony playerColony(ServerPlayer player) {
        IColonyManager manager = IColonyManager.getInstance();
        IColony here = manager.getColonyByPosFromWorld(player.level(), player.blockPosition());
        if (here != null) return here;
        IColony nearest = manager.getClosestIColony(player.level(), player.blockPosition());
        if (nearest != null && nearest.getDistanceSquared(player.blockPosition()) <= 128L * 128L) return nearest;
        return manager.getIColonyByOwner(player.level(), player);
    }

    private static void handle(ServerPlayer player, String raw) {
        String requestId = "invalid";
        try {
            JsonObject query = JsonParser.parseString(raw).getAsJsonObject();
            requestId = query.get("requestId").getAsString();
            if (!requestId.matches("[A-Za-z0-9:_-]{1,64}")) return;
            if (query.get("schemaVersion").getAsInt() != 1 || !query.get("kind").getAsString().equals("status")) {
                reject(player, requestId, "unsupported_query"); return;
            }
            int now = player.getServer().getTickCount();
            Integer last = LAST_QUERY_TICK.get(player.getUUID());
            if (last != null && now - last < 10) { reject(player, requestId, "rate_limited"); return; }
            LAST_QUERY_TICK.put(player.getUUID(), now);
            IColony colony = playerColony(player);
            if (colony == null) { reject(player, requestId, "no_nearby_or_owned_colony"); return; }

            JsonObject result = base(requestId);
            result.addProperty("ok", true);
            JsonObject meta = new JsonObject();
            meta.addProperty("id", colony.getID());
            meta.addProperty("name", colony.getName());
            meta.addProperty("dimension", colony.getDimension().location().toString());
            meta.add("center", pos(colony.getCenter()));
            meta.addProperty("state", colony.getState().name().toLowerCase());
            meta.addProperty("ownerUuid", colony.getPermissions().getOwner().toString());
            meta.addProperty("member", colony.getPermissions().isColonyMember(player));
            result.add("colony", meta);

            JsonArray citizens = new JsonArray();
            List<ICitizenData> citizenList = new ArrayList<>(colony.getCitizenManager().getCitizens());
            citizenList.sort(Comparator.comparingInt(ICitizenData::getId));
            for (ICitizenData citizen : citizenList) {
                if (citizens.size() >= MAX_ROWS) break;
                JsonObject row = new JsonObject();
                row.addProperty("id", citizen.getId());
                row.addProperty("name", limit(citizen.getName(), 100));
                if (citizen.getStatus() != null) row.addProperty("status", citizen.getStatus().getTranslationKey());
                row.add("lastPosition", pos(citizen.getLastPosition()));
                if (citizen.getWorkBuilding() != null) row.add("workBuilding", pos(citizen.getWorkBuilding().getPosition()));
                citizens.add(row);
            }
            result.add("citizens", citizens);
            result.addProperty("citizenCount", citizenList.size());

            List<IBuilding> buildingList = new ArrayList<>(colony.getServerBuildingManager().getBuildings().values());
            buildingList.sort(Comparator.comparing(IBuilding::getPosition));
            JsonArray buildings = new JsonArray();
            Set<String> seen = new HashSet<>();
            JsonArray requests = new JsonArray();
            for (IBuilding building : buildingList) {
                if (buildings.size() < MAX_ROWS) {
                    JsonObject row = new JsonObject();
                    row.addProperty("type", building.getBuildingType().getRegistryName().toString());
                    row.addProperty("level", building.getBuildingLevel());
                    row.addProperty("built", building.isBuilt());
                    row.add("position", pos(building.getPosition()));
                    if (colony.getPermissions().isColonyMember(player) && building.getTileEntity() != null) {
                        Map<String, Integer> stock = new TreeMap<>();
                        building.getTileEntity().getAllContent().forEach((item, count) -> {
                            String id = BuiltInRegistries.ITEM.getKey(item.getItem()).toString();
                            stock.merge(id, count, Integer::sum);
                        });
                        JsonArray summary = new JsonArray();
                        for (var item : stock.entrySet()) {
                            if (summary.size() >= 12) break;
                            JsonObject amount = new JsonObject();
                            amount.addProperty("id", item.getKey());
                            amount.addProperty("count", item.getValue());
                            summary.add(amount);
                        }
                        row.add("stock", summary);
                        row.addProperty("stockTruncated", stock.size() > summary.size());
                    }
                    buildings.add(row);
                }
                for (var tokens : building.getOpenRequestsByRequestableType().values()) {
                    for (IToken<?> token : tokens) {
                        if (requests.size() >= MAX_ROWS) break;
                        String id = token.getIdentifier().toString();
                        if (!seen.add(id)) continue;
                        IRequest<?> entry = colony.getRequestManager().getRequestForToken(token);
                        if (entry != null && open(entry.getState())) requests.add(request(colony.getRequestManager(), entry, building.getPosition()));
                    }
                }
            }
            for (IToken<?> token : colony.getRequestManager().getPlayerResolver().getAllAssignedRequests()) {
                if (requests.size() >= MAX_ROWS) break;
                if (!seen.add(token.getIdentifier().toString())) continue;
                IRequest<?> entry = colony.getRequestManager().getRequestForToken(token);
                if (entry != null && open(entry.getState())) requests.add(request(colony.getRequestManager(), entry, null));
            }
            result.add("buildings", buildings);
            result.addProperty("buildingCount", buildingList.size());
            result.add("requests", requests);
            result.addProperty("requestsTruncated", requests.size() >= MAX_ROWS);

            JsonArray workOrders = new JsonArray();
            List<IServerWorkOrder> orderList = new ArrayList<>(colony.getWorkManager().getWorkOrders().values());
            orderList.sort(Comparator.comparingInt(IServerWorkOrder::getID));
            for (IServerWorkOrder order : orderList) {
                if (workOrders.size() >= MAX_ROWS) break;
                JsonObject row = new JsonObject();
                row.addProperty("id", order.getID());
                row.addProperty("type", order.getWorkOrderType().name().toLowerCase());
                row.addProperty("name", limit(order.getDisplayName().getString(), 120));
                row.addProperty("claimed", order.isClaimed());
                row.add("position", pos(order.getLocation()));
                workOrders.add(row);
            }
            result.add("workOrders", workOrders);
            result.addProperty("workOrderCount", orderList.size());
            send(player, result);
        } catch (RuntimeException error) {
            reject(player, requestId, "colony_query_failed");
        }
    }

    private static void actionReply(ServerPlayer player, JsonObject body) {
        body.addProperty("playerUuid", player.getUUID().toString());
        body.addProperty("retryAutomatically", false);
        String text = body.toString();
        var receipts = ACTION_RECEIPTS.computeIfAbsent(player.getUUID(), ignored -> new LinkedHashMap<>());
        receipts.put(body.get("requestId").getAsString(), text);
        while (receipts.size() > 32) receipts.remove(receipts.keySet().iterator().next());
        if (player.connection != null && player.connection.hasChannel(State.TYPE)) {
            PacketDistributor.sendToPlayer(player, new State(text));
        }
    }

    private static void actionReject(ServerPlayer player, String requestId, String code) {
        JsonObject result = base(requestId);
        result.addProperty("action", "deliver");
        result.addProperty("ok", false);
        result.addProperty("code", code);
        result.addProperty("accepted", 0);
        actionReply(player, result);
    }

    /** Mirrors MineColonies' own TransferItemsRequestMessage storage path with explicit player preconditions. */
    private static void handleAction(ServerPlayer player, String raw) {
        String requestId = "invalid";
        boolean transferStarted = false;
        try {
            JsonObject input = JsonParser.parseString(raw).getAsJsonObject();
            requestId = input.get("requestId").getAsString();
            if (!requestId.matches("[A-Za-z0-9:_-]{1,64}")) return;
            String cached = ACTION_RECEIPTS.getOrDefault(player.getUUID(), new LinkedHashMap<>()).get(requestId);
            if (cached != null) {
                if (player.connection != null && player.connection.hasChannel(State.TYPE)) {
                    PacketDistributor.sendToPlayer(player, new State(cached));
                }
                return;
            }
            if (input.get("schemaVersion").getAsInt() != 1 || !input.get("kind").getAsString().equals("deliver")) {
                actionReject(player, requestId, "unsupported_action"); return;
            }
            JsonObject target = input.getAsJsonObject("buildingPosition");
            BlockPos pos = new BlockPos(target.get("x").getAsInt(), target.get("y").getAsInt(), target.get("z").getAsInt());
            if (!player.level().isLoaded(pos) || player.distanceToSqr(pos.getX() + .5, pos.getY() + .5, pos.getZ() + .5) > 64) {
                actionReject(player, requestId, "building_not_reachable"); return;
            }
            IBuilding building = IColonyManager.getInstance().getBuilding(player.level(), pos);
            if (building == null || building.getTileEntity() == null) {
                actionReject(player, requestId, "building_missing"); return;
            }
            IColony colony = building.getColony();
            if (!colony.getPermissions().isColonyMember(player)) {
                actionReject(player, requestId, "not_colony_member"); return;
            }
            String tokenId = input.get("token").getAsString();
            if (!tokenId.matches("[0-9a-fA-F-]{36}")) {
                actionReject(player, requestId, "invalid_request_token"); return;
            }
            IToken<?> token = null;
            for (var tokens : building.getOpenRequestsByRequestableType().values()) {
                for (IToken<?> candidate : tokens) {
                    if (candidate.getIdentifier().toString().equals(tokenId)) token = candidate;
                }
            }
            if (token == null) { actionReject(player, requestId, "request_not_open_for_building"); return; }
            IRequest<?> request = colony.getRequestManager().getRequestForToken(token);
            if (request == null || !open(request.getState()) || !(request.getRequest() instanceof IDeliverable requested)) {
                actionReject(player, requestId, "request_not_deliverable"); return;
            }
            int slot = input.get("inventorySlot").getAsInt();
            int quantity = input.get("quantity").getAsInt();
            if (slot < 0 || slot >= 36 || quantity < 1 || quantity > 64 || quantity > requested.getCount()) {
                actionReject(player, requestId, "invalid_slot_or_quantity"); return;
            }
            ItemStack held = player.getInventory().getItem(slot);
            if (held.isEmpty() || held.getCount() < quantity || !requested.matches(held)) {
                actionReject(player, requestId, "inventory_item_missing_or_wrong"); return;
            }
            String actual = held.saveOptional(player.registryAccess()).toString();
            if (!actual.equals(input.get("expectedSnbt").getAsString())) {
                actionReject(player, requestId, "inventory_components_changed"); return;
            }

            String stateBefore = request.getState().name().toLowerCase();
            ItemStack offered = held.copyWithCount(quantity);
            transferStarted = true;
            ItemStack leftover = InventoryUtils.addItemStackToProviderWithResult(building.getTileEntity(), offered);
            int accepted = quantity - (leftover.isEmpty() ? 0 : leftover.getCount());
            if (accepted <= 0) { actionReject(player, requestId, "building_storage_full"); return; }
            ItemStack removed = player.getInventory().removeItem(slot, accepted);
            if (removed.getCount() != accepted) throw new IllegalStateException("inventory changed on server thread");
            building.getTileEntity().setChanged();
            player.getInventory().setChanged();
            player.containerMenu.broadcastChanges();
            // MineColonies uses this after native player transfer; it only overrides a stuck matching request.
            boolean resolutionError = false;
            try { building.overruleNextOpenRequestWithStack(removed); }
            catch (RuntimeException error) { resolutionError = true; }
            boolean requestStillOpen = false;
            for (var tokens : building.getOpenRequestsByRequestableType().values()) {
                for (IToken<?> candidate : tokens) {
                    if (candidate.getIdentifier().toString().equals(tokenId)) requestStillOpen = true;
                }
            }

            JsonObject result = base(requestId);
            result.addProperty("action", "deliver");
            result.addProperty("ok", true);
            result.addProperty("code", "stored_in_building");
            result.addProperty("token", tokenId);
            result.add("buildingPosition", pos(pos));
            result.addProperty("itemId", BuiltInRegistries.ITEM.getKey(removed.getItem()).toString());
            result.addProperty("accepted", accepted);
            result.addProperty("inventorySlot", slot);
            result.addProperty("inventoryRemaining", player.getInventory().getItem(slot).getCount());
            result.addProperty("requestStateBefore", stateBefore);
            result.addProperty("requestStillOpen", requestStillOpen);
            result.addProperty("requestMayNeedWorkerPickup", requestStillOpen);
            result.addProperty("resolutionError", resolutionError);
            actionReply(player, result);
        } catch (RuntimeException error) {
            if (!transferStarted) actionReject(player, requestId, "colony_delivery_failed");
            else {
                JsonObject result = base(requestId);
                result.addProperty("action", "deliver");
                result.addProperty("ok", false);
                result.addProperty("code", "delivery_outcome_unknown_check_inventory");
                result.add("accepted", null);
                actionReply(player, result);
            }
        }
    }
}
