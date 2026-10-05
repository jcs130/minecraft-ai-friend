package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.DataSlot;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerContainerEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import vectorwing.farmersdelight.common.block.entity.container.CookingPotMenu;
import net.minecraft.world.food.FoodProperties;
import com.mojang.serialization.JsonOps;
import net.minecraft.resources.RegistryOps;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.List;
import java.lang.reflect.Field;
import java.util.UUID;

/** Per-connection, server-authoritative menu snapshots and native clicks for Agent players. */
final class PlayerMenuBridge {
    private static final Map<UUID, String> LAST_STATE = new HashMap<>();
    private static final Map<UUID, LinkedHashMap<String, String>> RECEIPTS = new HashMap<>();
    private static final int MAX_PAYLOAD = 65536;
    private static JsonObject renderRegistryData;
    // Locked 1.21.1's private list contains the same DataSlots that the menu
    // sends to its vanilla listener. Read values only; never broadcast or set
    // them to manufacture a progress bar. An unavailable member stays unknown.
    private static final Field MENU_DATA_SLOTS = menuDataSlotsField();

    private static Field menuDataSlotsField() {
        try {
            Field field = AbstractContainerMenu.class.getDeclaredField("dataSlots");
            if (!List.class.isAssignableFrom(field.getType())) return null;
            field.setAccessible(true);
            return field;
        } catch (ReflectiveOperationException | RuntimeException error) { return null; }
    }

    private static void menuData(AbstractContainerMenu menu, JsonObject state) {
        try {
            if (MENU_DATA_SLOTS == null) throw new IllegalStateException("unavailable");
            Object values = MENU_DATA_SLOTS.get(menu);
            if (!(values instanceof List<?> list) || list.size() > 64) throw new IllegalStateException("invalid");
            JsonArray data = new JsonArray();
            for (Object value : list) {
                if (!(value instanceof DataSlot slot)) throw new IllegalStateException("invalid");
                data.add(slot.get());
            }
            state.add("dataValues", data);
            state.addProperty("dataValuesSource", "server_menu_data_slots");
        } catch (ReflectiveOperationException | RuntimeException error) {
            state.add("dataValues", null);
            state.addProperty("dataValuesError", "native_menu_data_unavailable");
        }
    }

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
        value.addProperty("displayName", stack.getHoverName().getString());
        value.addProperty("descriptionId", stack.getDescriptionId());
        // Full native components are retained as SNBT. The proxy item shown by
        // Mineflayer is only a visual approximation and must never be treated as identity.
        value.addProperty("snbt", stack.saveOptional(player.registryAccess()).toString());
        var food = stack.get(DataComponents.FOOD);
        if (food == null) value.add("food", null);
        else {
            JsonObject properties = new JsonObject();
            properties.addProperty("nutrition", food.nutrition());
            properties.addProperty("saturation", food.saturation());
            properties.addProperty("canAlwaysEat", food.canAlwaysEat());
            properties.addProperty("eatSeconds", food.eatSeconds());
            properties.addProperty("source", "server_food_component");
            // saveOptional() contains the component patch, not necessarily the
            // item's default FOOD. Include the resolved component so defaults
            // such as rotten flesh's hunger chance remain observable.
            properties.add("nativeComponent", FoodProperties.DIRECT_CODEC.encodeStart(
                    RegistryOps.create(JsonOps.INSTANCE, player.registryAccess()), food).getOrThrow());
            properties.addProperty("additionalItemHooksDescribed", false);
            value.add("food", properties);
        }
        return value;
    }

    static JsonObject nativeItem(ServerPlayer player, ItemStack stack) { return item(player, stack); }

    private static JsonObject snapshot(ServerPlayer player) {
        AbstractContainerMenu menu = player.containerMenu;
        JsonObject state = new JsonObject();
        state.addProperty("schemaVersion", 1);
        state.addProperty("kind", "menu_state");
        state.addProperty("playerUuid", player.getUUID().toString());
        state.addProperty("windowId", menu.containerId);
        state.addProperty("stateId", menu.getStateId());
        state.addProperty("selectedHotbarSlot", player.getInventory().selected);
        if (renderRegistryData == null) {
            renderRegistryData = new JsonObject();
            renderRegistryData.addProperty("source", "server_builtin_registries");
            JsonArray types = new JsonArray();
            for (var value : BuiltInRegistries.VILLAGER_TYPE) {
                JsonObject row = new JsonObject();
                row.addProperty("id", BuiltInRegistries.VILLAGER_TYPE.getId(value));
                row.addProperty("name", BuiltInRegistries.VILLAGER_TYPE.getKey(value).toString());
                types.add(row);
            }
            renderRegistryData.add("villagerTypes", types);
            JsonArray professions = new JsonArray();
            for (var value : BuiltInRegistries.VILLAGER_PROFESSION) {
                JsonObject row = new JsonObject();
                row.addProperty("id", BuiltInRegistries.VILLAGER_PROFESSION.getId(value));
                row.addProperty("name", BuiltInRegistries.VILLAGER_PROFESSION.getKey(value).toString());
                professions.add(row);
            }
            renderRegistryData.add("villagerProfessions", professions);
        }
        JsonObject registries = renderRegistryData.deepCopy();
        registries.addProperty("playerUuid", player.getUUID().toString());
        state.add("renderRegistries", registries);
        // Snapshot the requesting body's actual values. These remain bound to
        // its connection, including while a mod container is open. Never use
        // a proxy item/attribute registry or default HUD health/armor values.
        JsonObject self = new JsonObject();
        self.addProperty("playerUuid", player.getUUID().toString());
        self.addProperty("health", player.getHealth());
        self.addProperty("maxHealth", player.getMaxHealth());
        self.addProperty("absorption", player.getAbsorptionAmount());
        self.addProperty("armor", player.getArmorValue());
        self.addProperty("food", player.getFoodData().getFoodLevel());
        self.addProperty("saturation", player.getFoodData().getSaturationLevel());
        self.addProperty("airSupply", player.getAirSupply());
        self.addProperty("maxAirSupply", player.getMaxAirSupply());
        self.addProperty("inWater", player.isUnderWater());
        self.addProperty("experienceLevel", player.experienceLevel);
        self.addProperty("experienceProgress", player.experienceProgress);
        self.addProperty("experiencePoints", player.totalExperience);
        self.addProperty("mainArm", player.getMainArm().name().toLowerCase(java.util.Locale.ROOT));
        self.addProperty("usingItem", player.isUsingItem());
        self.addProperty("useItemRemainingTicks", player.getUseItemRemainingTicks());
        self.addProperty("crouching", player.isCrouching());
        self.addProperty("isPassenger", player.isPassenger());
        self.addProperty("swimAmount", player.getSwimAmount(0));
        self.addProperty("fallFlying", player.isFallFlying());
        self.addProperty("spinAttack", player.isAutoSpinAttack());
        self.addProperty("swinging", player.swinging);
        self.addProperty("attackAnim", player.getAttackAnim(1));
        self.addProperty("attackStrengthScale", player.getAttackStrengthScale(1));
        self.addProperty("pose", player.getPose().name().toLowerCase(java.util.Locale.ROOT));
        JsonObject equipment = new JsonObject();
        for (EquipmentSlot slot : new EquipmentSlot[]{EquipmentSlot.MAINHAND, EquipmentSlot.OFFHAND,
                EquipmentSlot.FEET, EquipmentSlot.LEGS, EquipmentSlot.CHEST, EquipmentSlot.HEAD}) {
            equipment.add(slot.getName(), item(player, player.getItemBySlot(slot)));
        }
        self.add("equipment", equipment);
        self.add("ysm", PlayerYsmState.snapshot(player));
        self.add("motion", PlayerRenderMotion.snapshot(player));
        state.add("self", self);
        state.add("entityRenderStates", PlayerWorldBridge.maidRenderStates(player));
        String menuType;
        try {
            menuType = BuiltInRegistries.MENU.getKey(menu.getType()).toString();
        } catch (RuntimeException error) {
            menuType = "minecraft:inventory";
        }
        state.addProperty("menuType", menuType);
        JsonArray slots = new JsonArray();
        JsonArray mayPickup = new JsonArray();
        JsonArray layout = new JsonArray();
        for (int i = 0; i < menu.slots.size(); i++) {
            JsonObject entry = item(player, menu.getSlot(i).getItem());
            if (entry == null) slots.add((String) null);
            else slots.add(entry);
            mayPickup.add(menu.getSlot(i).mayPickup(player));
            JsonObject point = new JsonObject();
            point.addProperty("slot", i);
            point.addProperty("x", menu.getSlot(i).x);
            point.addProperty("y", menu.getSlot(i).y);
            layout.add(point);
        }
        state.add("slots", slots);
        state.add("mayPickup", mayPickup);
        state.add("slotLayout", layout);
        menuData(menu, state);
        // The canonical player menu preserves slot indices 0..45 even when a
        // chest/mod menu uses a different arrangement. This is explicit server
        // data, rather than inferring an inventory suffix from container size.
        if (menu != player.inventoryMenu) {
            JsonArray inventory = new JsonArray();
            for (var slot : player.inventoryMenu.slots) inventory.add(item(player, slot.getItem()));
            state.add("playerInventory", inventory);
        }
        if (menuType.equals("farmersdelight:cooking_pot")) {
            JsonArray roles = new JsonArray();
            for (int i = 0; i < menu.slots.size(); i++) {
                roles.add(i < 6 ? "ingredient" : i == 6 ? "cooked_meal_buffer" :
                        i == 7 ? "serving_container" : i == 8 ? "served_output" : "player_inventory");
            }
            state.add("slotRoles", roles);
        }
        if (menu instanceof CookingPotMenu pot) {
            JsonObject cooking = new JsonObject();
            cooking.addProperty("playerUuid", player.getUUID().toString());
            cooking.addProperty("source", "native_cooking_pot_menu");
            cooking.addProperty("isHeated", pot.isHeated());
            cooking.add("container", item(player, pot.blockEntity.getContainer()));
            state.add("cookingPot", cooking);
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
