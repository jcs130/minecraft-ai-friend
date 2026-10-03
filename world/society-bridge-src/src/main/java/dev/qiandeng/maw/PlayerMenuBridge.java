package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerContainerEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Per-connection, server-authoritative menu snapshots and native clicks for Agent players. */
final class PlayerMenuBridge {
    private static final Map<UUID, String> LAST_STATE = new HashMap<>();
    private static final Map<UUID, LinkedHashMap<String, String>> RECEIPTS = new HashMap<>();
    private static final int MAX_PAYLOAD = 65536;

    private record State(String json) implements CustomPacketPayload {
        static final Type<State> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "menu_state"));
        static final StreamCodec<RegistryFriendlyByteBuf, State> CODEC = StreamCodec.of(
                (buf, payload) -> writeJson(buf, payload.json), buf -> new State(readJson(buf)));

        @Override public Type<State> type() { return TYPE; }
    }

    private record Action(String json) implements CustomPacketPayload {
        static final Type<Action> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "menu_action"));
        static final StreamCodec<RegistryFriendlyByteBuf, Action> CODEC = StreamCodec.of(
                (buf, payload) -> writeJson(buf, payload.json), buf -> new Action(readJson(buf)));

        @Override public Type<Action> type() { return TYPE; }
    }

    private static void writeJson(RegistryFriendlyByteBuf buf, String json) {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_PAYLOAD) throw new IllegalArgumentException("menu JSON too large");
        buf.writeBytes(bytes);
    }

    private static String readJson(RegistryFriendlyByteBuf buf) {
        int size = buf.readableBytes();
        if (size > MAX_PAYLOAD) throw new IllegalArgumentException("menu JSON too large");
        byte[] bytes = new byte[size];
        buf.readBytes(bytes);
        return new String(bytes, StandardCharsets.UTF_8);
    }

    static void register(IEventBus modBus) {
        modBus.addListener(PlayerMenuBridge::registerPayloads);
        NeoForge.EVENT_BUS.addListener(PlayerMenuBridge::onOpen);
        NeoForge.EVENT_BUS.addListener(PlayerMenuBridge::onClose);
        NeoForge.EVENT_BUS.addListener(PlayerMenuBridge::onLogout);
        NeoForge.EVENT_BUS.addListener(PlayerMenuBridge::onTick);
    }

    private static void registerPayloads(RegisterPayloadHandlersEvent event) {
        var registrar = event.registrar("1").optional();
        registrar.playToClient(State.TYPE, State.CODEC, (payload, context) -> {});
        registrar.playToServer(Action.TYPE, Action.CODEC, (payload, context) -> {
            if (context.player() instanceof ServerPlayer player) {
                context.enqueueWork(() -> handleAction(player, payload.json));
            }
        });
    }

    private static boolean canSend(ServerPlayer player) {
        return player.connection != null && player.connection.hasChannel(State.TYPE);
    }

    private static void send(ServerPlayer player, JsonObject body) {
        if (canSend(player)) PacketDistributor.sendToPlayer(player, new State(body.toString()));
    }

    private static JsonObject item(ServerPlayer player, ItemStack stack) {
        if (stack.isEmpty()) return null;
        JsonObject value = new JsonObject();
        value.addProperty("id", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
        value.addProperty("count", stack.getCount());
        // Full native components are retained as SNBT. The proxy item shown by
        // Mineflayer is only a visual approximation and must never be treated as identity.
        value.addProperty("snbt", stack.saveOptional(player.registryAccess()).toString());
        return value;
    }

    private static JsonObject snapshot(ServerPlayer player) {
        AbstractContainerMenu menu = player.containerMenu;
        JsonObject state = new JsonObject();
        state.addProperty("schemaVersion", 1);
        state.addProperty("kind", "menu_state");
        state.addProperty("playerUuid", player.getUUID().toString());
        state.addProperty("windowId", menu.containerId);
        state.addProperty("stateId", menu.getStateId());
        state.addProperty("selectedHotbarSlot", player.getInventory().selected);
        String menuType;
        try {
            menuType = BuiltInRegistries.MENU.getKey(menu.getType()).toString();
        } catch (RuntimeException error) {
            menuType = "minecraft:inventory";
        }
        state.addProperty("menuType", menuType);
        JsonArray slots = new JsonArray();
        JsonArray mayPickup = new JsonArray();
        for (int i = 0; i < menu.slots.size(); i++) {
            JsonObject entry = item(player, menu.getSlot(i).getItem());
            if (entry == null) slots.add((String) null);
            else slots.add(entry);
            mayPickup.add(menu.getSlot(i).mayPickup(player));
        }
        state.add("slots", slots);
        state.add("mayPickup", mayPickup);
        if (menuType.equals("farmersdelight:cooking_pot")) {
            JsonArray roles = new JsonArray();
            for (int i = 0; i < menu.slots.size(); i++) {
                roles.add(i < 6 ? "ingredient" : i == 6 ? "cooked_meal_buffer" :
                        i == 7 ? "serving_container" : i == 8 ? "served_output" : "player_inventory");
            }
            state.add("slotRoles", roles);
        }
        JsonObject carried = item(player, menu.getCarried());
        if (carried == null) state.add("carried", null);
        else state.add("carried", carried);
        return state;
    }

    private static void publishIfChanged(ServerPlayer player) {
        if (!canSend(player)) return;
        JsonObject state = snapshot(player);
        String json = state.toString();
        if (json.equals(LAST_STATE.get(player.getUUID()))) return;
        if (json.getBytes(StandardCharsets.UTF_8).length > 60000) {
            JsonObject error = new JsonObject();
            error.addProperty("schemaVersion", 1);
            error.addProperty("kind", "menu_state_error");
            error.addProperty("windowId", player.containerMenu.containerId);
            error.addProperty("code", "menu_state_too_large");
            if (!error.toString().equals(LAST_STATE.get(player.getUUID()))) {
                LAST_STATE.put(player.getUUID(), error.toString());
                send(player, error);
            }
            return;
        }
        LAST_STATE.put(player.getUUID(), json);
        send(player, state);
    }

    private static void onOpen(PlayerContainerEvent.Open event) {
        if (event.getEntity() instanceof ServerPlayer player) publishIfChanged(player);
    }

    private static void onClose(PlayerContainerEvent.Close event) {
        if (event.getEntity() instanceof ServerPlayer player) LAST_STATE.remove(player.getUUID());
    }

    private static void onLogout(PlayerEvent.PlayerLoggedOutEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) {
            LAST_STATE.remove(player.getUUID());
            RECEIPTS.remove(player.getUUID());
        }
    }

    private static void onTick(ServerTickEvent.Post event) {
        if (event.getServer().getTickCount() % 5 != 0) return;
        for (ServerPlayer player : event.getServer().getPlayerList().getPlayers()) {
            if (canSend(player)) publishIfChanged(player);
        }
    }

    private static void reply(ServerPlayer player, String requestId, boolean ok, String code, boolean changed) {
        JsonObject result = new JsonObject();
        result.addProperty("schemaVersion", 1);
        result.addProperty("kind", "action_receipt");
        result.addProperty("requestId", requestId);
        result.addProperty("ok", ok);
        result.addProperty("code", code);
        result.addProperty("changed", changed);
        result.addProperty("retryAutomatically", false);
        result.add("state", snapshot(player));
        String text = result.toString();
        if (text.getBytes(StandardCharsets.UTF_8).length > 60000) {
            // A click may already have happened. Keep its outcome, but make it
            // impossible for the client to continue from its stale snapshot.
            result.remove("state");
            result.addProperty("stateUnavailable", true);
            result.addProperty("stateError", "menu_state_too_large");
            text = result.toString();
        }
        var playerReceipts = RECEIPTS.computeIfAbsent(player.getUUID(), ignored -> new LinkedHashMap<>());
        playerReceipts.put(requestId, text);
        while (playerReceipts.size() > 32) playerReceipts.remove(playerReceipts.keySet().iterator().next());
        send(player, result);
    }

    private static void handleAction(ServerPlayer player, String text) {
        String requestId = "invalid";
        try {
            JsonObject input = JsonParser.parseString(text).getAsJsonObject();
            requestId = input.get("requestId").getAsString();
            if (!requestId.matches("[A-Za-z0-9:_-]{1,64}")) return;
            String cached = RECEIPTS.getOrDefault(player.getUUID(), new LinkedHashMap<>()).get(requestId);
            if (cached != null) {
                if (canSend(player)) PacketDistributor.sendToPlayer(player, new State(cached));
                return;
            }
            int windowId = input.get("windowId").getAsInt();
            int slot = input.get("slot").getAsInt();
            int button = input.get("button").getAsInt();
            AbstractContainerMenu menu = player.containerMenu;
            if (menu.containerId != windowId) { reply(player, requestId, false, "stale_window", false); return; }
            if (slot < 0 || slot >= menu.slots.size() || (button != 0 && button != 1)) {
                reply(player, requestId, false, "invalid_slot_or_button", false); return;
            }
            if (!menu.stillValid(player)) { reply(player, requestId, false, "menu_not_valid", false); return; }
            ItemStack before = menu.getSlot(slot).getItem().copy();
            if (!input.has("expectedItemId") || !input.has("expectedCount") || !input.has("expectedSnbt") ||
                    !input.has("expectedCarriedSnbt")) {
                reply(player, requestId, false, "missing_slot_precondition", false); return;
            }
            if (input.has("expectedItemId") &&
                    !input.get("expectedItemId").getAsString().equals(
                            before.isEmpty() ? "minecraft:air" : BuiltInRegistries.ITEM.getKey(before.getItem()).toString())) {
                reply(player, requestId, false, "slot_changed", false); return;
            }
            if (input.has("expectedCount") && input.get("expectedCount").getAsInt() != before.getCount()) {
                reply(player, requestId, false, "slot_changed", false); return;
            }
            String actualSnbt = before.isEmpty() ? "" : before.saveOptional(player.registryAccess()).toString();
            if (!input.get("expectedSnbt").getAsString().equals(actualSnbt)) {
                reply(player, requestId, false, "slot_components_changed", false); return;
            }
            ItemStack carried = menu.getCarried().copy();
            String carriedSnbt = carried.isEmpty() ? "" : carried.saveOptional(player.registryAccess()).toString();
            if (!input.get("expectedCarriedSnbt").getAsString().equals(carriedSnbt)) {
                reply(player, requestId, false, "cursor_changed", false); return;
            }
            menu.clicked(slot, button, ClickType.PICKUP, player);
            menu.broadcastChanges();
            boolean changed = !ItemStack.matches(before, menu.getSlot(slot).getItem()) ||
                    !ItemStack.matches(carried, menu.getCarried());
            publishIfChanged(player);
            reply(player, requestId, true, changed ? "clicked" : "no_change", changed);
        } catch (RuntimeException error) {
            reply(player, requestId, false, "invalid_or_failed_action", false);
        }
    }
}
