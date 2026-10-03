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
import com.minecolonies.api.IMinecoloniesAPI;
import com.minecolonies.api.eventbus.events.colony.ColonyCreatedModEvent;
import com.minecolonies.api.blocks.ModBlocks;
import com.minecolonies.api.util.InventoryUtils;
import com.minecolonies.core.MineColonies;
import com.minecolonies.core.colony.buildings.AbstractBuildingStructureBuilder;
import com.minecolonies.core.colony.buildings.utils.BuildingBuilderResource;
import com.minecolonies.api.configuration.ServerConfiguration;
import com.minecolonies.core.tileentities.TileEntityColonyBuilding;
import com.ldtteam.structurize.storage.StructurePacks;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.phys.AABB;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

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
    private static final Logger LOGGER = LoggerFactory.getLogger(PlayerColonyBridge.class);
    private static final int MAX_BYTES = 16384;
    private static final int MAX_ROWS = 24;
    private static final int MAX_RESOURCE_ROWS = 12;
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
            int listedResources = 0;
            Set<String> seen = new HashSet<>();
            JsonArray requests = new JsonArray();
            for (IBuilding building : buildingList) {
                if (buildings.size() < MAX_ROWS) {
                    JsonObject row = new JsonObject();
                    row.addProperty("type", building.getBuildingType().getRegistryName().toString());
                    row.addProperty("level", building.getBuildingLevel());
                    row.addProperty("built", building.isBuilt());
                    row.addProperty("constructionPending", building.isPendingConstruction());
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
                        if (building instanceof AbstractBuildingStructureBuilder builder) {
                            var progress = builder.getProgress();
                            if (progress != null) {
                                JsonObject construction = new JsonObject();
                                if (progress.getB() != null) {
                                    construction.addProperty("stage", progress.getB().name().toLowerCase());
                                }
                                row.add("construction", construction);
                            }
                            List<BuildingBuilderResource> needed = new ArrayList<>(builder.getNeededResources().values());
                            needed.sort(Comparator.comparing(resource ->
                                    BuiltInRegistries.ITEM.getKey(resource.getItemStack().getItem()).toString()));
                            JsonArray resources = new JsonArray();
                            for (BuildingBuilderResource resource : needed) {
                                if (listedResources >= MAX_RESOURCE_ROWS) break;
                                ItemStack item = resource.getItemStack();
                                if (item.isEmpty()) continue;
                                JsonObject entry = new JsonObject();
                                entry.addProperty("id", BuiltInRegistries.ITEM.getKey(item.getItem()).toString());
                                entry.addProperty("name", limit(item.getHoverName().getString(), 80));
                                entry.addProperty("needed", resource.getAmount());
                                entry.addProperty("availableReported", resource.getAvailable());
                                entry.addProperty("inDelivery", resource.getAmountInDelivery());
                                resources.add(entry);
                                listedResources++;
                            }
                            row.add("resources", resources);
                            row.addProperty("resourceCount", needed.size());
                            row.addProperty("resourcesTruncated", needed.size() > resources.size());
                        }
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
            String kind = input.get("kind").getAsString();
            if (kind.equals("found") || kind.equals("place_builder") || kind.equals("request_build")) {
                handleConstruction(player, input, requestId, kind);
                return;
            }
            if (input.get("schemaVersion").getAsInt() != 1 || !kind.equals("deliver")) {
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
            if (transferStarted) {
                LOGGER.error("Colony delivery outcome unknown for player {} request {}", player.getUUID(), requestId, error);
            }
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

    private static void constructionReject(ServerPlayer player, String requestId, String kind, String code) {
        JsonObject result = base(requestId);
        result.addProperty("action", kind);
        result.addProperty("ok", false);
        result.addProperty("code", code);
        actionReply(player, result);
    }

    /**
     * A narrow server-authoritative substitute for the Build Tool's BlockUI flow.
     * It only handles the initial town hall, the first builder hut, and a build request.
     */
    private static void handleConstruction(ServerPlayer player, JsonObject input, String requestId, String kind) {
        boolean mutationStarted = false;
        try {
            if (input.get("schemaVersion").getAsInt() != 1) {
                constructionReject(player, requestId, kind, "unsupported_action"); return;
            }
            ServerLevel level = player.serverLevel();
            JsonObject point = input.getAsJsonObject(kind.equals("request_build") ? "buildingPosition" : "position");
            BlockPos pos = new BlockPos(point.get("x").getAsInt(), point.get("y").getAsInt(), point.get("z").getAsInt());
            if (!level.isLoaded(pos) || player.distanceToSqr(pos.getX() + .5, pos.getY() + .5, pos.getZ() + .5) > 64) {
                constructionReject(player, requestId, kind, "position_not_reachable"); return;
            }
            IColonyManager manager = IColonyManager.getInstance();
            if (kind.equals("request_build")) {
                IBuilding building = manager.getBuilding(level, pos);
                if (building == null) { constructionReject(player, requestId, kind, "building_missing"); return; }
                IColony colony = building.getColony();
                if (!colony.getPermissions().hasPermission(player,
                        com.minecolonies.api.colony.permissions.Action.MANAGE_HUTS)) {
                    constructionReject(player, requestId, kind, "manage_huts_denied"); return;
                }
                if (building.isPendingConstruction()) {
                    constructionReject(player, requestId, kind, "construction_already_pending"); return;
                }
                JsonObject builderPoint = input.getAsJsonObject("builderPosition");
                BlockPos builderPos = new BlockPos(builderPoint.get("x").getAsInt(),
                        builderPoint.get("y").getAsInt(), builderPoint.get("z").getAsInt());
                IBuilding builder = manager.getBuilding(level, builderPos);
                if (builder == null || builder.getColony().getID() != colony.getID()
                        || !builder.getBuildingType().getRegistryName().getPath().equals("builder")) {
                    constructionReject(player, requestId, kind, "builder_missing_or_wrong_colony"); return;
                }
                mutationStarted = true;
                building.requestUpgrade(player, builderPos);
                JsonObject result = base(requestId);
                result.addProperty("action", kind);
                result.addProperty("ok", true);
                result.addProperty("code", "build_requested");
                result.add("buildingPosition", pos(pos));
                result.add("builderPosition", pos(builderPos));
                result.addProperty("colonyId", colony.getID());
                actionReply(player, result);
                return;
            }

            if (!level.getWorldBorder().isWithinBounds(pos) || pos.getY() <= level.getMinBuildHeight()
                    || pos.getY() >= level.getMaxBuildHeight() - 1
                    || !level.getBlockState(pos).canBeReplaced()
                    || !level.getEntitiesOfClass(LivingEntity.class, new AABB(pos)).isEmpty()
                    || !level.getBlockState(pos.below()).isFaceSturdy(level, pos.below(), Direction.UP)) {
                constructionReject(player, requestId, kind, "invalid_build_position"); return;
            }
            boolean founding = kind.equals("found");
            Block hut = founding ? ModBlocks.blockHutTownHall : ModBlocks.blockHutBuilder;
            String blueprint = founding ? "fundamentals/townhall1.blueprint" : "fundamentals/builder1.blueprint";
            IColony colony;
            if (founding) {
                if (manager.getIColonyByOwner(level, player) != null || !manager.isFarEnoughFromColonies(level, pos)) {
                    constructionReject(player, requestId, kind, "colony_already_owned_or_too_close"); return;
                }
                ServerConfiguration config = (ServerConfiguration) MineColonies.getConfig().getServer();
                BlockPos spawn = level.getSharedSpawnPos();
                double distance = Math.hypot(pos.getX() - spawn.getX(), pos.getZ() - spawn.getZ());
                if (distance < config.minDistanceFromWorldSpawn.get()
                        || distance > config.maxDistanceFromWorldSpawn.get()) {
                    constructionReject(player, requestId, kind, "colony_spawn_distance_denied"); return;
                }
                String name = input.get("name").getAsString().strip();
                if (!name.matches("[\\p{L}\\p{N} _-]{1,48}")) {
                    constructionReject(player, requestId, kind, "invalid_colony_name"); return;
                }
            } else {
                colony = manager.getColonyByPosFromWorld(level, pos);
                if (colony == null || !colony.getPermissions().hasPermission(player,
                        com.minecolonies.api.colony.permissions.Action.PLACE_HUTS)
                        || !colony.getServerBuildingManager().canPlaceAt(hut, pos, player)) {
                    constructionReject(player, requestId, kind, "place_hut_denied"); return;
                }
            }
            int slot = input.get("inventorySlot").getAsInt();
            if (slot < 0 || slot >= 36) { constructionReject(player, requestId, kind, "invalid_inventory_slot"); return; }
            ItemStack held = player.getInventory().getItem(slot);
            if (held.isEmpty() || !held.is(hut.asItem())
                    || !held.saveOptional(player.registryAccess()).toString().equals(input.get("expectedSnbt").getAsString())) {
                constructionReject(player, requestId, kind, "hut_item_missing_or_changed"); return;
            }
            var pack = StructurePacks.getStructurePack("Minecolonies Original");
            if (pack == null) { constructionReject(player, requestId, kind, "structure_pack_unavailable"); return; }

            mutationStarted = true;
            if (!level.setBlockAndUpdate(pos, hut.defaultBlockState())
                    || !(level.getBlockEntity(pos) instanceof TileEntityColonyBuilding tile)) {
                throw new IllegalStateException("hut placement did not create tile");
            }
            tile.setStructurePack(pack);
            tile.setBlueprintPath(blueprint);
            if (founding) {
                colony = manager.createColony(level, pos, player, input.get("name").getAsString().strip(),
                        "Minecolonies Original");
                if (colony == null) throw new IllegalStateException("native colony creation failed");
            } else {
                colony = manager.getColonyByPosFromWorld(level, pos);
            }
            hut.setPlacedBy(level, pos, level.getBlockState(pos), player, held.copyWithCount(1));
            IBuilding building = manager.getBuilding(level, pos);
            if (building == null) throw new IllegalStateException("native hut registration failed");
            building.setStructurePack("Minecolonies Original");
            building.setBlueprintPath(blueprint);
            building.calculateCorners();
            ItemStack removed = player.getInventory().removeItem(slot, 1);
            if (removed.getCount() != 1) throw new IllegalStateException("hut item changed on server thread");
            player.getInventory().setChanged();
            player.containerMenu.broadcastChanges();
            if (founding) {
                IMinecoloniesAPI.getInstance().getEventBus().post(new ColonyCreatedModEvent(colony));
            }

            JsonObject result = base(requestId);
            result.addProperty("action", kind);
            result.addProperty("ok", true);
            result.addProperty("code", founding ? "colony_founded" : "builder_placed");
            result.addProperty("colonyId", colony.getID());
            result.add("position", pos(pos));
            result.addProperty("itemId", BuiltInRegistries.ITEM.getKey(removed.getItem()).toString());
            result.addProperty("inventoryRemaining", player.getInventory().getItem(slot).getCount());
            actionReply(player, result);
        } catch (RuntimeException error) {
            if (mutationStarted) {
                LOGGER.error("Colony construction outcome unknown for player {} request {} action {}",
                        player.getUUID(), requestId, kind, error);
            }
            constructionReject(player, requestId, kind,
                    mutationStarted ? "construction_outcome_unknown_check_world" : "construction_failed");
        }
    }
}
