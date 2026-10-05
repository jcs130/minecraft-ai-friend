package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.minecolonies.api.colony.IColony;
import com.minecolonies.api.colony.IColonyManager;
import com.minecolonies.api.colony.ICitizenData;
import com.minecolonies.api.colony.buildings.IBuilding;
import com.minecolonies.api.colony.buildings.modules.IAssignsJob;
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
import com.minecolonies.core.colony.workorders.WorkOrderBuilding;
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
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;

/** Same-player MineColonies facts and bounded native construction/inventory actions. */
final class PlayerColonyBridge {
    private static final Logger LOGGER = LoggerFactory.getLogger(PlayerColonyBridge.class);
    private static final int MAX_BYTES = 16384;
    private static final int MAX_ROWS = 24;
    private static final int MAX_RESOURCE_ROWS = 12;
    private static final String PROVIDER_SOURCE = "native_building_combined_item_handler";
    private static final Map<UUID, Integer> LAST_QUERY_TICK = new HashMap<>();
    private static final Map<UUID, ColonyActionReplay> ACTION_RECEIPTS = new HashMap<>();

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
        return value == null || value.length() <= max ? value : value.substring(0, max);
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

    private static boolean blueprintAvailable(String path) {
        // The native findBlueprint searches the whole pack and waits for loading.
        // These are fixed relative paths: use getBlueprint's own pack path resolution.
        var pack = StructurePacks.getStructurePack(ColonyConstructionRules.PACK);
        return pack != null && Files.isRegularFile(pack.getPath().resolve(pack.getNormalizedSubPath(path)));
    }

    private static JsonObject constructionOptions(ServerPlayer player, IColony colony) {
        JsonObject options = new JsonObject();
        options.addProperty("scope", "fixed_original_level_one_huts");
        options.addProperty("structurePack", ColonyConstructionRules.PACK);
        options.addProperty("requestBuildSemantics", "native_next_level_subject_to_research_and_builder_rules");
        options.addProperty("hireAvailable", false);
        options.addProperty("workerConfigurationAvailable", false);
        options.addProperty("foodDelivery", "open_native_deliverable_requests_only");
        ServerConfiguration config = (ServerConfiguration) MineColonies.getConfig().getServer();
        JsonObject founding = new JsonObject();
        founding.addProperty("itemId", ColonyConstructionRules.TOWN_HALL.itemId());
        founding.addProperty("blueprintPath", ColonyConstructionRules.TOWN_HALL.blueprintPath());
        founding.addProperty("blueprintAvailable", blueprintAvailable(ColonyConstructionRules.TOWN_HALL.blueprintPath()));
        founding.addProperty("minDistanceFromWorldSpawn", config.minDistanceFromWorldSpawn.get());
        founding.addProperty("maxDistanceFromWorldSpawn", config.maxDistanceFromWorldSpawn.get());
        BlockPos spawn = player.serverLevel().getSharedSpawnPos();
        founding.add("worldSpawn", pos(spawn));
        founding.addProperty("playerDistanceFromWorldSpawn", Math.hypot(player.getX() - spawn.getX(), player.getZ() - spawn.getZ()));
        founding.addProperty("ownsColonyInDimension", IColonyManager.getInstance().getIColonyByOwner(player.level(), player) != null);
        founding.addProperty("siteChecksRequired", true);
        options.add("founding", founding);
        JsonArray huts = new JsonArray();
        for (var hut : ColonyConstructionRules.HUTS) {
            JsonObject row = new JsonObject();
            row.addProperty("hutType", hut.type());
            row.addProperty("itemId", hut.itemId());
            row.addProperty("blueprintPath", hut.blueprintPath());
            row.addProperty("initialTargetLevel", 1);
            row.addProperty("blueprintAvailable", blueprintAvailable(hut.blueprintPath()));
            huts.add(row);
        }
        options.add("allowedHuts", huts);
        if (colony != null) {
            options.addProperty("placeHutsPermission", colony.getPermissions().hasPermission(player,
                    com.minecolonies.api.colony.permissions.Action.PLACE_HUTS));
            options.addProperty("manageHutsPermission", colony.getPermissions().hasPermission(player,
                    com.minecolonies.api.colony.permissions.Action.MANAGE_HUTS));
        }
        return options;
    }

    private static JsonObject workOrder(IServerWorkOrder order) {
        JsonObject row = new JsonObject();
        row.addProperty("id", order.getID());
        row.addProperty("type", order.getWorkOrderType().name().toLowerCase(java.util.Locale.ROOT));
        row.addProperty("name", limit(order.getDisplayName().getString(), 120));
        row.addProperty("claimed", order.isClaimed());
        row.add("position", pos(order.getLocation()));
        if (order.isClaimed() && order.getClaimedBy() != null) row.add("claimedBy", pos(order.getClaimedBy()));
        row.addProperty("currentLevel", order.getCurrentLevel());
        row.addProperty("targetLevel", order.getTargetLevel());
        row.addProperty("structurePack", limit(order.getStructurePack(), 100));
        row.addProperty("blueprintPath", limit(order.getStructurePath(), 240));
        if (order.getStage() != null) row.addProperty("stage", order.getStage().name().toLowerCase(java.util.Locale.ROOT));
        return row;
    }

    private static ColonyConstructionRules.Point point(BlockPos position) {
        return position == null ? null : new ColonyConstructionRules.Point(position.getX(), position.getY(), position.getZ());
    }

    private static ColonyConstructionRules.Order orderEvidence(IServerWorkOrder order) {
        return new ColonyConstructionRules.Order(order.getID(), order.getWorkOrderType().name().toLowerCase(java.util.Locale.ROOT),
                point(order.getLocation()), order.getTargetLevel(), order.isClaimed(), point(order.getClaimedBy()));
    }

    private static Block hutBlock(String type) {
        return switch (type) {
            case "townhall" -> ModBlocks.blockHutTownHall;
            case "builder" -> ModBlocks.blockHutBuilder;
            case "home" -> ModBlocks.blockHutHome;
            case "farmer" -> ModBlocks.blockHutFarmer;
            case "warehouse" -> ModBlocks.blockHutWareHouse;
            case "blacksmith" -> ModBlocks.blockHutBlacksmith;
            case "cook" -> ModBlocks.blockHutCook;
            case "deliveryman" -> ModBlocks.blockHutDeliveryman;
            default -> null;
        };
    }

    private static JsonObject colonyMetadata(ServerPlayer player, IColony colony) {
        JsonObject meta = new JsonObject();
        meta.addProperty("id", colony.getID());
        meta.addProperty("name", colony.getName());
        meta.addProperty("dimension", colony.getDimension().location().toString());
        meta.add("center", pos(colony.getCenter()));
        meta.addProperty("state", colony.getState().name().toLowerCase(java.util.Locale.ROOT));
        meta.addProperty("ownerUuid", colony.getPermissions().getOwner().toString());
        meta.addProperty("member", colony.getPermissions().isColonyMember(player));
        return meta;
    }

    static JsonObject capabilitiesResult(String requestId, JsonObject options, JsonObject colony) {
        JsonObject result = base(requestId);
        result.addProperty("ok", true);
        result.addProperty("query", "capabilities");
        result.addProperty("readOnly", true);
        result.add("constructionOptions", options);
        result.add("colony", colony == null ? JsonNull.INSTANCE : colony);
        return result;
    }

    private static JsonObject resourceFact(ServerPlayer player, BuildingBuilderResource resource) {
        ItemStack item = resource.getItemStack();
        JsonObject entry = new JsonObject();
        entry.addProperty("id", BuiltInRegistries.ITEM.getKey(item.getItem()).toString());
        entry.addProperty("name", limit(item.getHoverName().getString(), 100));
        entry.addProperty("count", item.getCount());
        // The actual native template includes Domum material components and any custom name.
        // It is NOT the player's stockResource inventory compare-and-swap precondition.
        entry.addProperty("snbt", item.saveOptional(player.registryAccess()).toString());
        entry.addProperty("needed", resource.getAmount());
        entry.addProperty("availableReported", resource.getAvailable());
        entry.addProperty("inDelivery", resource.getAmountInDelivery());
        return entry;
    }

    private static void rejectResources(ServerPlayer player, String requestId, String code) {
        JsonObject result = base(requestId);
        result.addProperty("query", "resources");
        result.addProperty("readOnly", true);
        result.addProperty("ok", false);
        result.addProperty("code", code);
        send(player, result);
    }

    private static void handleResources(ServerPlayer player, JsonObject query, String requestId, IColony colony) {
        int offset;
        int limit;
        BlockPos position;
        try {
            offset = ColonyResourcePage.integer(query, "offset", 0);
            limit = ColonyResourcePage.integer(query, "limit", ColonyResourcePage.DEFAULT_LIMIT);
            JsonObject target = query.getAsJsonObject("buildingPosition");
            position = new BlockPos(ColonyResourcePage.integer(target, "x", null),
                    ColonyResourcePage.integer(target, "y", null), ColonyResourcePage.integer(target, "z", null));
            if (offset < 0 || limit < 1 || limit > ColonyResourcePage.MAX_LIMIT) {
                rejectResources(player, requestId, "invalid_resource_page"); return;
            }
        } catch (RuntimeException invalid) {
            rejectResources(player, requestId, "invalid_resource_query"); return;
        }
        if (colony == null || !colony.getPermissions().isColonyMember(player)) {
            rejectResources(player, requestId, "not_colony_member"); return;
        }
        // Do not load chunks for remote inspection or look up another dimension/colony.
        if (!player.level().isLoaded(position)) {
            rejectResources(player, requestId, "building_not_loaded"); return;
        }
        IBuilding building = IColonyManager.getInstance().getBuilding(player.level(), position);
        if (!(building instanceof AbstractBuildingStructureBuilder builder)
                || building.getTileEntity() == null || building.getColony().getID() != colony.getID()) {
            rejectResources(player, requestId, "resource_builder_missing_or_wrong_colony"); return;
        }
        List<JsonObject> rows = new ArrayList<>();
        for (BuildingBuilderResource resource : builder.getNeededResources().values()) {
            if (!resource.getItemStack().isEmpty()) {
                JsonObject fact = resourceFact(player, resource);
                fact.addProperty("availableInBuildingProvider", stockCount(building, resource.getItemStack()));
                fact.addProperty("providerSource", PROVIDER_SOURCE);
                rows.add(fact);
            }
        }
        JsonObject result = base(requestId);
        result.addProperty("playerUuid", player.getUUID().toString()); // Include this in the exact byte budget.
        result.addProperty("query", "resources");
        result.addProperty("readOnly", true);
        result.addProperty("source", "native_builder_needed_resources");
        result.addProperty("providerSource", PROVIDER_SOURCE);
        result.addProperty("colonyId", colony.getID());
        result.add("buildingPosition", pos(position));
        result.addProperty("hasWorkOrder", builder.hasWorkOrder());
        send(player, ColonyResourcePage.apply(result, rows, offset, limit));
    }

    private static void handle(ServerPlayer player, String raw) {
        String requestId = "invalid";
        try {
            JsonObject query = JsonParser.parseString(raw).getAsJsonObject();
            requestId = query.get("requestId").getAsString();
            if (!requestId.matches("[A-Za-z0-9:_-]{1,64}")) return;
            String kind = query.get("kind").getAsString();
            if (query.get("schemaVersion").getAsInt() != 1
                    || !(kind.equals("status") || kind.equals("capabilities") || kind.equals("resources"))) {
                reject(player, requestId, "unsupported_query"); return;
            }
            int now = player.getServer().getTickCount();
            Integer last = LAST_QUERY_TICK.get(player.getUUID());
            if (last != null && now - last < 10) { reject(player, requestId, "rate_limited"); return; }
            LAST_QUERY_TICK.put(player.getUUID(), now);
            IColony colony = playerColony(player);
            if (kind.equals("resources")) {
                handleResources(player, query, requestId, colony);
                return;
            }
            JsonObject options = constructionOptions(player, colony);
            if (kind.equals("capabilities")) {
                send(player, capabilitiesResult(requestId, options, colony == null ? null : colonyMetadata(player, colony)));
                return;
            }
            JsonObject result = base(requestId);
            result.add("constructionOptions", options);
            if (colony == null) {
                result.addProperty("ok", false);
                result.addProperty("code", "no_nearby_or_owned_colony");
                send(player, result); return;
            }
            result.addProperty("ok", true);
            result.add("colony", colonyMetadata(player, colony));

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
                if (colony.getPermissions().isColonyMember(player)) {
                    row.addProperty("paused", citizen.isPaused());
                    row.addProperty("asleep", citizen.isAsleep());
                    row.addProperty("saturation", citizen.getSaturation());
                    row.addProperty("maxSaturation", ICitizenData.MAX_SATURATION);
                    if (citizen.getJobStatus() != null) row.addProperty("jobStatus", citizen.getJobStatus().name().toLowerCase());
                    var entity = citizen.getEntity();
                    row.addProperty("loaded", entity.isPresent());
                    if (entity.isPresent()) {
                        row.addProperty("health", entity.get().getHealth());
                        row.addProperty("maxHealth", entity.get().getMaxHealth());
                    }
                    var job = citizen.getJob();
                    if (job != null && job.getWorkerAI() != null && job.getWorkerAI().getState() instanceof Enum<?> state) {
                        row.addProperty("aiState", state.name().toLowerCase());
                    }
                }
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
                    row.addProperty("maxLevel", building.getMaxBuildingLevel());
                    row.addProperty("structurePack", limit(building.getStructurePack(), 100));
                    row.addProperty("blueprintPath", limit(building.getBlueprintPath(), 240));
                    if (colony.getPermissions().isColonyMember(player)) {
                        JsonArray workers = new JsonArray();
                        var modules = building.getModules();
                        int workerModuleCount = 0;
                        for (int moduleId = 0; moduleId < modules.size(); moduleId++) {
                            if (!(modules.get(moduleId) instanceof IAssignsJob worker)) continue;
                            workerModuleCount++;
                            if (workers.size() >= 4) continue;
                            JsonObject module = new JsonObject();
                            module.addProperty("moduleId", moduleId);
                            module.addProperty("capacity", worker.getModuleMax());
                            module.addProperty("full", worker.isFull());
                            module.addProperty("hiringMode", worker.getHiringMode().name().toLowerCase(java.util.Locale.ROOT));
                            var assigned = worker.getAssignedCitizen();
                            JsonArray ids = new JsonArray();
                            for (ICitizenData citizen : assigned) {
                                if (ids.size() >= 4) break;
                                ids.add(citizen.getId());
                            }
                            module.add("assignedCitizenIds", ids);
                            module.addProperty("assignedCitizenCount", assigned.size());
                            module.addProperty("assignedCitizensTruncated", assigned.size() > ids.size());
                            workers.add(module);
                        }
                        row.add("workerModules", workers);
                        row.addProperty("workerModulesTruncated", workerModuleCount > workers.size());
                    }
                    if (colony.getPermissions().isColonyMember(player) && building.getTileEntity() != null) {
                        Map<String, Integer> stock = new TreeMap<>();
                        // The native insertion provider includes associated racks before
                        // the hut itself; getAllContent() only counts this single rack.
                        var provider = buildingProvider(building);
                        for (int slot = 0; slot < provider.getSlots(); slot++) {
                            ItemStack item = provider.getStackInSlot(slot);
                            if (!item.isEmpty()) {
                                String id = BuiltInRegistries.ITEM.getKey(item.getItem()).toString();
                                stock.merge(id, item.getCount(), Integer::sum);
                            }
                        }
                        JsonArray summary = new JsonArray();
                        for (var item : stock.entrySet()) {
                            if (summary.size() >= 12) break;
                            JsonObject amount = new JsonObject();
                            amount.addProperty("id", item.getKey());
                            amount.addProperty("count", item.getValue());
                            summary.add(amount);
                        }
                        row.add("stock", summary);
                        row.addProperty("stockSource", PROVIDER_SOURCE);
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
                            row.addProperty("resourcesQuery", "resources");
                            row.addProperty("resourcesPageLimit", ColonyResourcePage.MAX_LIMIT);
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
                workOrders.add(workOrder(order));
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
        var receipts = ACTION_RECEIPTS.get(player.getUUID());
        if (receipts != null) receipts.complete(body.get("requestId").getAsString(), text);
        if (player.connection != null && player.connection.hasChannel(State.TYPE)) {
            PacketDistributor.sendToPlayer(player, new State(text));
        }
    }

    private static void actionReject(ServerPlayer player, String requestId, String action, String code) {
        JsonObject result = base(requestId);
        result.addProperty("action", action);
        result.addProperty("ok", false);
        result.addProperty("code", code);
        result.addProperty("accepted", 0);
        actionReply(player, result);
    }

    private static void actionReject(ServerPlayer player, String requestId, String code) {
        actionReject(player, requestId, "deliver", code);
    }

    private static net.neoforged.neoforge.items.IItemHandler buildingProvider(IBuilding building) {
        // Read the same unsided native CombinedItemHandler used by insertion.
        // Reading every side would count shared underlying inventories repeatedly.
        var provider = building.getTileEntity().getItemHandlerCap((Direction) null);
        if (provider == null) throw new IllegalStateException("building provider unavailable");
        return provider;
    }

    private static int stockCount(IBuilding building, ItemStack item) {
        int count = 0;
        var provider = buildingProvider(building);
        for (int slot = 0; slot < provider.getSlots(); slot++) {
            ItemStack stored = provider.getStackInSlot(slot);
            if (!stored.isEmpty() && ItemStack.isSameItemSameComponents(stored, item)) count += stored.getCount();
        }
        return count;
    }

    /** The Builder GUI's resource arrow can stock required materials without a request token. */
    private static void handleStockResource(ServerPlayer player, JsonObject input, String requestId) {
        final String action = "stock_resource";
        boolean transferStarted = false;
        try {
            if (input.get("schemaVersion").getAsInt() != 1) {
                actionReject(player, requestId, action, "unsupported_action"); return;
            }
            JsonObject target = input.getAsJsonObject("buildingPosition");
            BlockPos pos = new BlockPos(target.get("x").getAsInt(), target.get("y").getAsInt(), target.get("z").getAsInt());
            if (!player.level().isLoaded(pos) || player.distanceToSqr(pos.getX() + .5, pos.getY() + .5, pos.getZ() + .5) > 64) {
                actionReject(player, requestId, action, "building_not_reachable"); return;
            }
            IBuilding building = IColonyManager.getInstance().getBuilding(player.level(), pos);
            if (!(building instanceof AbstractBuildingStructureBuilder builder)
                    || building.getTileEntity() == null || !builder.hasWorkOrder()) {
                actionReject(player, requestId, action, "builder_without_active_work_order"); return;
            }
            if (!building.getColony().getPermissions().isColonyMember(player)) {
                actionReject(player, requestId, action, "not_colony_member"); return;
            }
            int slot = input.get("inventorySlot").getAsInt();
            int quantity = input.get("quantity").getAsInt();
            if (slot < 0 || slot >= 36 || quantity < 1 || quantity > 64) {
                actionReject(player, requestId, action, "invalid_slot_or_quantity"); return;
            }
            ItemStack held = player.getInventory().getItem(slot);
            if (held.isEmpty() || held.getCount() < quantity) {
                actionReject(player, requestId, action, "inventory_item_missing"); return;
            }
            if (!held.saveOptional(player.registryAccess()).toString().equals(input.get("expectedSnbt").getAsString())) {
                actionReject(player, requestId, action, "inventory_components_changed"); return;
            }
            BuildingBuilderResource required = null;
            for (BuildingBuilderResource candidate : builder.getNeededResources().values()) {
                if (candidate.getAmount() > 0 && ItemStack.isSameItemSameComponents(candidate.getItemStack(), held)) {
                    required = candidate;
                    break;
                }
            }
            if (required == null) {
                actionReject(player, requestId, action, "item_not_needed_for_construction"); return;
            }
            int stockBefore = stockCount(building, held);
            int remaining = Math.max(0, required.getAmount() - stockBefore);
            if (quantity > remaining) {
                actionReject(player, requestId, action, "quantity_exceeds_remaining_need"); return;
            }

            transferStarted = true;
            ItemStack leftover = InventoryUtils.addItemStackToProviderWithResult(
                    building.getTileEntity(), held.copyWithCount(quantity));
            int accepted = quantity - (leftover.isEmpty() ? 0 : leftover.getCount());
            if (accepted <= 0) {
                actionReject(player, requestId, action, "building_storage_full"); return;
            }
            ItemStack removed = player.getInventory().removeItem(slot, accepted);
            if (removed.getCount() != accepted) throw new IllegalStateException("inventory changed on server thread");
            building.getTileEntity().setChanged();
            player.getInventory().setChanged();
            player.containerMenu.broadcastChanges();
            boolean resolutionError = false;
            try { building.overruleNextOpenRequestWithStack(removed); }
            catch (RuntimeException error) { resolutionError = true; }

            JsonObject result = base(requestId);
            result.addProperty("action", action);
            result.addProperty("ok", true);
            result.addProperty("code", "construction_material_stored");
            result.add("buildingPosition", pos(pos));
            result.addProperty("itemId", BuiltInRegistries.ITEM.getKey(removed.getItem()).toString());
            result.addProperty("accepted", accepted);
            result.addProperty("inventorySlot", slot);
            result.addProperty("inventoryRemaining", player.getInventory().getItem(slot).getCount());
            result.addProperty("neededAtValidation", required.getAmount());
            result.addProperty("stockBefore", stockBefore);
            result.addProperty("stockAfter", stockCount(building, removed));
            result.addProperty("stockSource", PROVIDER_SOURCE);
            result.addProperty("resolutionError", resolutionError);
            actionReply(player, result);
        } catch (RuntimeException error) {
            if (transferStarted) LOGGER.error("Colony stock outcome unknown for player {} request {}", player.getUUID(), requestId, error);
            if (!transferStarted) actionReject(player, requestId, action, "colony_stock_failed");
            else {
                JsonObject result = base(requestId);
                result.addProperty("action", action);
                result.addProperty("ok", false);
                result.addProperty("code", "stock_outcome_unknown_check_inventory");
                result.add("accepted", null);
                actionReply(player, result);
            }
        }
    }

    /** Mirrors MineColonies' own TransferItemsRequestMessage storage path with explicit player preconditions. */
    private static void handleAction(ServerPlayer player, String raw) {
        String requestId = "invalid";
        String actionKind = "unknown";
        boolean receiptReserved = false;
        boolean transferStarted = false;
        try {
            JsonObject input = JsonParser.parseString(raw).getAsJsonObject();
            requestId = input.get("requestId").getAsString();
            if (!requestId.matches("[A-Za-z0-9:_-]{1,64}")) return;
            String kind = input.get("kind").getAsString();
            actionKind = kind;
            var replay = ACTION_RECEIPTS.computeIfAbsent(player.getUUID(), ignored -> new ColonyActionReplay()).begin(requestId, input);
            if (replay.outcome() == ColonyActionReplay.Outcome.REPLAY) {
                if (player.connection != null && player.connection.hasChannel(State.TYPE)) {
                    PacketDistributor.sendToPlayer(player, new State(replay.response()));
                }
                return;
            }
            if (replay.outcome() != ColonyActionReplay.Outcome.NEW) {
                JsonObject result = base(requestId);
                result.addProperty("action", kind);
                result.addProperty("ok", false);
                boolean conflict = replay.outcome() == ColonyActionReplay.Outcome.CONFLICT;
                result.addProperty("code", conflict ? "request_id_conflict" : "request_outcome_unknown_check_world");
                result.addProperty("accepted", 0);
                result.addProperty("knownNotApplied", true);
                result.addProperty("retryAutomatically", false);
                // This is about the new attempt; never overwrite the original receipt/fingerprint.
                send(player, result);
                return;
            }
            receiptReserved = true;
            if (kind.equals("found") || kind.equals("place_builder") || kind.equals("place_hut") || kind.equals("request_build")) {
                handleConstruction(player, input, requestId, kind);
                return;
            }
            if (kind.equals("stock_resource")) {
                handleStockResource(player, input, requestId);
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
            if (!receiptReserved) {
                JsonObject result = base(requestId);
                result.addProperty("action", actionKind);
                result.addProperty("ok", false);
                result.addProperty("code", "invalid_action_payload");
                result.addProperty("accepted", 0);
                result.addProperty("knownNotApplied", true);
                result.addProperty("retryAutomatically", false);
                send(player, result);
                return;
            }
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
     * It handles the initial town hall, a fixed original hut list, and native next-level build requests.
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
                // BlockPos.ZERO means automatic builder selection in the original API.
                if (builderPos.equals(BlockPos.ZERO)) {
                    constructionReject(player, requestId, kind, "builder_origin_not_selectable"); return;
                }
                Set<Integer> before = new HashSet<>(colony.getWorkManager().getWorkOrders().keySet());
                for (IServerWorkOrder existing : colony.getWorkManager().getWorkOrders().values()) {
                    if (existing instanceof WorkOrderBuilding && existing.getLocation().equals(pos)) {
                        constructionReject(player, requestId, kind, "construction_already_pending"); return;
                    }
                }
                mutationStarted = true;
                building.requestUpgrade(player, builderPos);
                List<ColonyConstructionRules.Order> evidence = new ArrayList<>();
                for (IServerWorkOrder order : colony.getWorkManager().getWorkOrders().values()) {
                    if (order instanceof WorkOrderBuilding) evidence.add(orderEvidence(order));
                }
                var confirmed = ColonyConstructionRules.confirm(before, evidence, point(pos), point(builderPos));
                if (confirmed.order() == null) {
                    constructionReject(player, requestId, kind, confirmed.code()); return;
                }
                IServerWorkOrder order = colony.getWorkManager().getWorkOrders().get(confirmed.order().id());
                JsonObject result = base(requestId);
                result.addProperty("action", kind);
                result.addProperty("ok", true);
                result.addProperty("code", "build_requested");
                result.add("buildingPosition", pos(pos));
                result.add("builderPosition", pos(builderPos));
                result.addProperty("colonyId", colony.getID());
                result.add("workOrder", workOrder(order));
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
            if (input.has("structurePack") || input.has("blueprintPath") || input.has("style")
                    || input.has("rotation") || input.has("mirror")) {
                constructionReject(player, requestId, kind, "custom_blueprint_or_transform_unsupported"); return;
            }
            var spec = founding ? ColonyConstructionRules.TOWN_HALL
                    : ColonyConstructionRules.hut(kind.equals("place_builder") ? "builder" : input.get("hutType").getAsString());
            if (spec == null) {
                constructionReject(player, requestId, kind, "unsupported_hut_type"); return;
            }
            Block hut = hutBlock(spec.type());
            String blueprint = spec.blueprintPath();
            if (hut == null || !BuiltInRegistries.BLOCK.getKey(hut).toString().equals(spec.itemId())
                    || !BuiltInRegistries.ITEM.getKey(hut.asItem()).toString().equals(spec.itemId())) {
                constructionReject(player, requestId, kind, "hut_registry_mismatch"); return;
            }
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
            var pack = StructurePacks.getStructurePack(ColonyConstructionRules.PACK);
            if (pack == null) { constructionReject(player, requestId, kind, "structure_pack_unavailable"); return; }
            if (!blueprintAvailable(blueprint)) {
                constructionReject(player, requestId, kind, "blueprint_unavailable"); return;
            }
            var loadedBlueprint = StructurePacks.getBlueprint(ColonyConstructionRules.PACK, blueprint, player.registryAccess());
            if (loadedBlueprint == null || loadedBlueprint.getPrimaryBlockOffset() == null
                    || loadedBlueprint.getBlockState(loadedBlueprint.getPrimaryBlockOffset()).getBlock() != hut) {
                constructionReject(player, requestId, kind, "blueprint_hut_mismatch"); return;
            }

            mutationStarted = true;
            if (!level.setBlockAndUpdate(pos, hut.defaultBlockState())
                    || !(level.getBlockEntity(pos) instanceof TileEntityColonyBuilding tile)) {
                throw new IllegalStateException("hut placement did not create tile");
            }
            tile.setStructurePack(pack);
            tile.setBlueprintPath(blueprint);
            if (founding) {
                colony = manager.createColony(level, pos, player, input.get("name").getAsString().strip(),
                        ColonyConstructionRules.PACK);
                if (colony == null) throw new IllegalStateException("native colony creation failed");
            } else {
                colony = manager.getColonyByPosFromWorld(level, pos);
            }
            hut.setPlacedBy(level, pos, level.getBlockState(pos), player, held.copyWithCount(1));
            IBuilding building = manager.getBuilding(level, pos);
            if (building == null) throw new IllegalStateException("native hut registration failed");
            building.setStructurePack(ColonyConstructionRules.PACK);
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
            result.addProperty("code", founding ? "colony_founded" : kind.equals("place_builder") ? "builder_placed" : "hut_placed");
            result.addProperty("colonyId", colony.getID());
            result.add("position", pos(pos));
            result.addProperty("itemId", BuiltInRegistries.ITEM.getKey(removed.getItem()).toString());
            result.addProperty("hutType", spec.type());
            result.addProperty("structurePack", ColonyConstructionRules.PACK);
            result.addProperty("blueprintPath", blueprint);
            result.addProperty("level", building.getBuildingLevel());
            result.addProperty("built", building.isBuilt());
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
