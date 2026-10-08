package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.simibubi.create.AllItems;
import com.simibubi.create.foundation.blockEntity.SmartBlockEntity;
import com.simibubi.create.foundation.blockEntity.behaviour.ValueSettingsBehaviour;
import com.simibubi.create.foundation.blockEntity.behaviour.filtering.FilteringBehaviour;
import com.simibubi.create.foundation.blockEntity.behaviour.scrollValue.ScrollValueBehaviour;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.capabilities.Capabilities;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import top.theillusivec4.curios.api.CuriosApi;
import top.theillusivec4.curios.common.inventory.CurioSlot;
import top.theillusivec4.curios.common.inventory.container.CuriosContainer;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Only allowlisted native UI operations, always on the requesting player's connection. */
final class ModOperationsBridge {
    private static final int MAX_BYTES = 65536;
    private static final Map<UUID, ColonyActionReplay> RECEIPTS = new HashMap<>();
    private static final Set<String> READS = Set.of("create_settings", "create_fluids", "curios_state");
    private static final Set<String> WRITES = Set.of("create_value", "create_filter", "curios_open", "curios_page", "world_interact");
    private record Query(String json) implements CustomPacketPayload {
        static final Type<Query> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "mod_query"));
        static final StreamCodec<RegistryFriendlyByteBuf, Query> CODEC = StreamCodec.of((b, p) -> write(b, p.json), b -> new Query(read(b)));
        @Override public Type<Query> type() { return TYPE; }
    }
    private record Action(String json) implements CustomPacketPayload {
        static final Type<Action> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "mod_action"));
        static final StreamCodec<RegistryFriendlyByteBuf, Action> CODEC = StreamCodec.of((b, p) -> write(b, p.json), b -> new Action(read(b)));
        @Override public Type<Action> type() { return TYPE; }
    }
    private record State(String json) implements CustomPacketPayload {
        static final Type<State> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "mod_state"));
        static final StreamCodec<RegistryFriendlyByteBuf, State> CODEC = StreamCodec.of((b, p) -> write(b, p.json), b -> new State(read(b)));
        @Override public Type<State> type() { return TYPE; }
    }
    private static void write(RegistryFriendlyByteBuf b, String json) {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new IllegalArgumentException("mod payload too large"); b.writeBytes(bytes);
    }
    private static String read(RegistryFriendlyByteBuf b) {
        if (b.readableBytes() > MAX_BYTES) throw new IllegalArgumentException("mod payload too large");
        byte[] bytes = new byte[b.readableBytes()]; b.readBytes(bytes); return new String(bytes, StandardCharsets.UTF_8);
    }
    static void register(IEventBus modBus) { modBus.addListener(ModOperationsBridge::registerPayloads); }
    private static void registerPayloads(RegisterPayloadHandlersEvent event) {
        var registrar = event.registrar("1").optional();
        registrar.playToClient(State.TYPE, State.CODEC, (payload, context) -> {});
        registrar.playToServer(Query.TYPE, Query.CODEC, (payload, context) -> {
            if (context.player() instanceof ServerPlayer player) context.enqueueWork(() -> handle(player, payload.json, false));
        });
        registrar.playToServer(Action.TYPE, Action.CODEC, (payload, context) -> {
            if (context.player() instanceof ServerPlayer player) context.enqueueWork(() -> handle(player, payload.json, true));
        });
    }
    private static void send(ServerPlayer player, String json) {
        if (player.connection != null && player.connection.hasChannel(State.TYPE)) PacketDistributor.sendToPlayer(player, new State(json));
    }
    private static JsonObject base(ServerPlayer player, String id, String action) {
        JsonObject r = new JsonObject(); r.addProperty("schemaVersion", 1); r.addProperty("kind", "mod_receipt");
        r.addProperty("playerUuid", player.getUUID().toString()); r.addProperty("requestId", id); r.addProperty("action", action);
        r.addProperty("outcomeKnown", true); r.addProperty("retryAutomatically", false);
        r.addProperty("receiptScope", "server_process_recent_32_per_player"); return r;
    }
    private static BlockHitResult visible(ServerPlayer player, JsonObject input, boolean mutation) {
        BlockPos p = ModRequest.position(input, "position");
        if (!player.level().isLoaded(p) || !player.canInteractWithBlock(p, 1)) ModRequest.fail("machine_not_reachable");
        var hit = player.level().clip(new ClipContext(player.getEyePosition(), ModRequest.aim(input, p), ClipContext.Block.OUTLINE, ClipContext.Fluid.NONE, player));
        if (hit.getType() != HitResult.Type.BLOCK || !hit.getBlockPos().equals(p)) ModRequest.fail("machine_not_visible");
        if (mutation) {
            ModRequest.active(player);
            if (player.gameMode.getGameModeForPlayer() == net.minecraft.world.level.GameType.ADVENTURE || !player.level().mayInteract(player, p)) ModRequest.fail("machine_interaction_denied");
            // MineColonies claim permissions are also enforced for ordinary Agent machine use.
            var colony = com.minecolonies.api.colony.IColonyManager.getInstance().getColonyByPosFromWorld(player.level(), p);
            if (colony != null && !colony.getPermissions().hasPermission(player, com.minecolonies.api.colony.permissions.Action.ACCESS_HUTS)) ModRequest.fail("colony_machine_access_denied");
            if (!BuiltInRegistries.BLOCK.getKey(player.level().getBlockState(p).getBlock()).toString().equals(ModRequest.text(input, "expectedBlockId", 256))) ModRequest.fail("machine_block_changed");
        }
        return hit;
    }
    private static SmartBlockEntity machine(ServerPlayer player, BlockHitResult hit) {
        var be = player.level().getBlockEntity(hit.getBlockPos());
        if (!(be instanceof SmartBlockEntity)) ModRequest.fail("create_machine_required");
        return (SmartBlockEntity) be;
    }
    private static ValueSettingsBehaviour behaviour(SmartBlockEntity be, JsonObject input) {
        int id = ModRequest.integer(input, "behaviourIndex", 0, 65535);
        String type = ModRequest.text(input, "expectedBehaviour", 256);
        var rows = be.getAllBehaviours().stream().filter(b -> b instanceof ValueSettingsBehaviour v && v.netId() == id && b.getClass().getName().equals(type)).toList();
        if (rows.size() != 1) ModRequest.fail("machine_behaviour_missing_or_ambiguous");
        return (ValueSettingsBehaviour) rows.getFirst();
    }
    private static JsonObject setting(ServerPlayer player, ValueSettingsBehaviour v, BlockHitResult hit) {
        JsonObject row = new JsonObject(); row.addProperty("behaviourIndex", v.netId()); row.addProperty("behaviour", v.getClass().getName());
        row.addProperty("active", v.isActive()); row.addProperty("mayInteract", v.mayInteract(player));
        row.addProperty("acceptsValueSettings", v.acceptsValueSettings()); row.addProperty("requiresWrench", v.onlyVisibleWithWrench());
        var value = v.getValueSettings(); row.addProperty("row", value.row()); row.addProperty("value", value.value());
        var board = v.createBoard(player, hit); row.addProperty("title", board.title().getString()); row.addProperty("maxValue", board.maxValue());
        JsonArray names = new JsonArray(); board.rows().forEach(c -> names.add(c.getString())); row.add("rows", names);
        if (v instanceof FilteringBehaviour filter) row.addProperty("filterSnbt", ModRequest.snbt(player, filter.getFilter(hit.getDirection())));
        return row;
    }
    private static JsonObject settings(ServerPlayer player, BlockHitResult hit) {
        var be = machine(player, hit); JsonObject result = new JsonObject(); JsonArray rows = new JsonArray();
        result.add("position", ModRequest.position(be.getBlockPos())); result.addProperty("blockId", BuiltInRegistries.BLOCK.getKey(be.getBlockState().getBlock()).toString());
        for (var b : be.getAllBehaviours()) if (b instanceof ValueSettingsBehaviour value) {
            if (rows.size() >= 24) break; rows.add(setting(player, value, hit));
        }
        result.add("settings", rows); return result;
    }
    private static JsonObject curios(ServerPlayer player) {
        var handler = CuriosApi.getCuriosInventory(player).orElse(null);
        if (handler == null) ModRequest.fail("curios_inventory_unavailable");
        JsonObject result = new JsonObject(); JsonArray slots = new JsonArray();
        for (var entry : handler.getCurios().entrySet().stream().sorted(Map.Entry.comparingByKey()).toList()) {
            var stacks = entry.getValue().getStacks();
            for (int i = 0; i < stacks.getSlots(); i++) {
                if (slots.size() >= 48) break;
                JsonObject row = new JsonObject(); row.addProperty("identifier", entry.getKey()); row.addProperty("index", i);
                row.addProperty("snbt", ModRequest.snbt(player, stacks.getStackInSlot(i))); slots.add(row);
            }
        }
        result.add("slots", slots); result.addProperty("menuOpen", player.containerMenu instanceof CuriosContainer);
        if (player.containerMenu instanceof CuriosContainer menu) {
            result.addProperty("containerId", menu.containerId); result.addProperty("stateId", menu.getStateId());
            result.addProperty("page", menu.currentPage); result.addProperty("totalPages", menu.totalPages);
            JsonArray menuSlots = new JsonArray();
            for (int i = 0; i < menu.slots.size(); i++) if (menu.slots.get(i) instanceof CurioSlot slot) {
                JsonObject row = new JsonObject(); row.addProperty("menuSlot", i); row.addProperty("identifier", slot.getIdentifier());
                row.addProperty("index", slot.getSlotIndex()); row.addProperty("cosmetic", slot.isCosmetic()); menuSlots.add(row);
            }
            result.add("menuSlots", menuSlots);
        }
        return result;
    }
    private static void handle(ServerPlayer player, String raw, boolean mutation) {
        String id = "invalid", kind = "unknown"; JsonObject result = null; boolean started = false, reserved = false;
        try {
            var input = JsonParser.parseString(raw).getAsJsonObject();
            id = ModRequest.text(input, "requestId", 64); if (!id.matches("[A-Za-z0-9:_-]{1,64}")) return;
            kind = ModRequest.text(input, "kind", 64); result = base(player, id, kind);
            if (!(mutation ? WRITES : READS).contains(kind)) ModRequest.fail("unsupported_mod_operation");
            if (mutation) {
                var replay = RECEIPTS.computeIfAbsent(player.getUUID(), ignored -> new ColonyActionReplay()).begin(id, input);
                if (replay.outcome() == ColonyActionReplay.Outcome.REPLAY) { send(player, replay.response()); return; }
                if (replay.outcome() != ColonyActionReplay.Outcome.NEW) ModRequest.fail(replay.outcome() == ColonyActionReplay.Outcome.CONFLICT ? "request_id_conflict" : "request_outcome_unknown_check_world");
                reserved = true; ModRequest.active(player);
            }
            if (kind.equals("world_interact")) {
                ModRequest.fields(input, "position", "aimOffset", "expectedBlockId", "expectedProperties", "expectedHeldSnbt", "expectedHotbarSlot");
                ModRequest.held(player, input);
                if (player.containerMenu != player.inventoryMenu || !player.containerMenu.getCarried().isEmpty()) ModRequest.fail("close_current_menu_and_clear_cursor_first");
                var hit = visible(player, input, true); var state = player.level().getBlockState(hit.getBlockPos());
                JsonObject properties = new JsonObject();
                state.getValues().forEach((key, value) -> properties.addProperty(key.getName(), property(key, value)));
                if (!properties.equals(input.get("expectedProperties"))) ModRequest.fail("block_properties_changed");
                result.addProperty("heldBefore", ModRequest.snbt(player, player.getMainHandItem()));
                result.addProperty("menuBefore", player.containerMenu.containerId);
                started = true;
                var interaction = player.gameMode.useItemOn(player, player.serverLevel(), player.getMainHandItem(), InteractionHand.MAIN_HAND, hit);
                player.containerMenu.broadcastChanges();
                result.addProperty("nativeInteraction", interaction.name()); result.addProperty("ok", interaction.consumesAction());
                result.addProperty("effectVerified", false);
                result.addProperty("code", interaction.consumesAction() ? "native_block_interaction_accepted_inspect_state" : "native_block_interaction_not_accepted");
                result.addProperty("heldAfter", ModRequest.snbt(player, player.getMainHandItem())); result.addProperty("menuAfter", player.containerMenu.containerId);
            } else if (kind.startsWith("create_")) {
                if (!mutation) ModRequest.fields(input, "position", "aimOffset");
                else if (kind.equals("create_value")) ModRequest.fields(input, "position", "aimOffset", "expectedBlockId", "behaviourIndex", "expectedBehaviour", "expectedRow", "expectedValue", "row", "value", "expectedHeldSnbt", "expectedHotbarSlot");
                else ModRequest.fields(input, "position", "aimOffset", "expectedBlockId", "behaviourIndex", "expectedBehaviour", "expectedFilterSnbt", "expectedHeldSnbt", "expectedHotbarSlot");
                var hit = visible(player, input, mutation);
                if (kind.equals("create_fluids")) {
                    var handler = player.level().getCapability(Capabilities.FluidHandler.BLOCK, hit.getBlockPos(), hit.getDirection());
                    if (handler == null) ModRequest.fail("fluid_handler_unavailable_on_visible_side");
                    JsonArray tanks = new JsonArray();
                    for (int i = 0; i < Math.min(24, handler.getTanks()); i++) {
                        var fluid = handler.getFluidInTank(i); JsonObject row = new JsonObject(); row.addProperty("tank", i);
                        row.addProperty("fluidId", BuiltInRegistries.FLUID.getKey(fluid.getFluid()).toString()); row.addProperty("amountMb", fluid.getAmount());
                        row.addProperty("capacityMb", handler.getTankCapacity(i)); tanks.add(row);
                    }
                    result.add("tanks", tanks); result.addProperty("tankCount", handler.getTanks()); result.addProperty("ok", true);
                } else if (!mutation) { result.add("state", settings(player, hit)); result.addProperty("ok", true); }
                else {
                    ModRequest.held(player, input); var be = machine(player, hit); var v = behaviour(be, input);
                    if (!v.isActive() || !v.mayInteract(player)) ModRequest.fail("machine_behaviour_inactive_or_denied");
                    if (v.onlyVisibleWithWrench() && !BuiltInRegistries.ITEM.getKey(player.getMainHandItem().getItem()).toString().equals("create:wrench")) ModRequest.fail("create_wrench_required");
                    result.add("before", setting(player, v, hit));
                    if (kind.equals("create_value")) {
                        if (!v.acceptsValueSettings()) ModRequest.fail("value_setting_not_supported");
                        var old = v.getValueSettings();
                        if (old.row() != ModRequest.integer(input, "expectedRow", 0, 65535) || old.value() != ModRequest.integer(input, "expectedValue", -1000000, 1000000)) ModRequest.fail("machine_setting_changed");
                        var board = v.createBoard(player, hit);
                        int row = ModRequest.integer(input, "row", 0, board.rows().size() - 1);
                        int value = ModRequest.integer(input, "value", 0, board.maxValue());
                        started = true; v.setValueSettings(player, new ValueSettingsBehaviour.ValueSettings(row, value), false);
                        result.addProperty("ok", v.getValueSettings().row() == row && v.getValueSettings().value() == value);
                    } else {
                        if (!(v instanceof FilteringBehaviour)) ModRequest.fail("filter_behaviour_required");
                        var filter = (FilteringBehaviour) v;
                        if (!ModRequest.snbt(player, filter.getFilter(hit.getDirection())).equals(ModRequest.text(input, "expectedFilterSnbt", 60000))) ModRequest.fail("machine_filter_changed");
                        if (!filter.canShortInteract(player.getMainHandItem())) ModRequest.fail("held_item_cannot_set_filter");
                        var expected = player.getMainHandItem().copy();
                        started = true;
                        // Native interaction consumes/refunds real FilterItems; setting a ghost filter is not item duplication.
                        filter.onShortInteract(player, InteractionHand.MAIN_HAND, hit.getDirection(), hit);
                        var after = filter.getFilter(hit.getDirection());
                        result.addProperty("ok", expected.isEmpty() ? after.isEmpty() : net.minecraft.world.item.ItemStack.isSameItemSameComponents(expected, after));
                    }
                    be.setChanged(); be.sendData(); player.containerMenu.broadcastChanges(); result.add("after", setting(player, v, hit));
                    result.addProperty("code", result.get("ok").getAsBoolean() ? "create_native_setting_verified" : "create_native_setting_not_applied");
                }
            } else if (kind.equals("curios_state")) { ModRequest.fields(input); result.add("state", curios(player)); result.addProperty("ok", true); }
            else if (kind.equals("curios_open")) {
                ModRequest.fields(input);
                if (player.containerMenu != player.inventoryMenu || !player.containerMenu.getCarried().isEmpty()) ModRequest.fail("close_current_menu_and_clear_cursor_first");
                curios(player); started = true;
                player.openMenu(new SimpleMenuProvider((window, inventory, owner) -> new CuriosContainer(window, inventory), Component.translatable("curios.container.curios")));
                result.add("state", curios(player)); result.addProperty("ok", player.containerMenu instanceof CuriosContainer);
            } else {
                ModRequest.fields(input, "page", "expectedContainerId", "expectedStateId");
                if (!(player.containerMenu instanceof CuriosContainer)) ModRequest.fail("curios_menu_not_open");
                var menu = (CuriosContainer) player.containerMenu;
                if (menu.containerId != ModRequest.integer(input, "expectedContainerId", 0, 255) || menu.getStateId() != ModRequest.integer(input, "expectedStateId", 0, 32767)) ModRequest.fail("curios_menu_changed");
                if (!menu.getCarried().isEmpty()) ModRequest.fail("clear_cursor_before_page_change");
                int page = ModRequest.integer(input, "page", 0, Math.max(0, menu.totalPages - 1));
                started = true; menu.setPage(page); menu.sendAllDataToRemote();
                result.add("state", curios(player)); result.addProperty("ok", menu.currentPage == page);
            }
        } catch (ModRequest.Invalid e) { if (result != null) { result.addProperty("ok", false); result.addProperty("code", e.getMessage()); } }
        catch (RuntimeException e) {
            if (result == null) result = base(player, id, kind);
            result.addProperty("ok", false); result.addProperty("code", started ? "mod_operation_outcome_unknown" : "invalid_mod_request"); result.addProperty("outcomeKnown", !started);
        }
        if (result == null) return;
        if (result.toString().getBytes(StandardCharsets.UTF_8).length > 60000) {
            result.remove("state"); result.remove("before"); result.remove("after");
            result.addProperty("stateUnavailable", true);
            if (!mutation) { result.addProperty("ok", false); result.addProperty("code", "mod_state_too_large"); }
        }
        String json = result.toString();
        if (reserved) RECEIPTS.get(player.getUUID()).complete(id, json);
        send(player, json);
    }
    @SuppressWarnings({"rawtypes", "unchecked"})
    private static String property(net.minecraft.world.level.block.state.properties.Property key, Comparable value) { return key.getName(value); }
}
