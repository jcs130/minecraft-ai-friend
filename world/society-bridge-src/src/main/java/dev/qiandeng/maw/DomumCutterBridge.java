package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.ldtteam.domumornamentum.block.IMateriallyTexturedBlock;
import com.ldtteam.domumornamentum.block.ModBlocks;
import com.ldtteam.domumornamentum.client.model.data.MaterialTextureData;
import com.ldtteam.domumornamentum.container.ArchitectsCutterContainer;
import com.ldtteam.domumornamentum.recipe.ModRecipeTypes;
import com.ldtteam.domumornamentum.recipe.architectscutter.ArchitectsCutterRecipeInput;
import net.minecraft.core.BlockPos;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.inventory.ContainerLevelAccess;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.BlockItemStateProperties;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;

import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Only discovers and selects the player's real cutter menu; taking output stays a native slot click. */
final class DomumCutterBridge {
    private static final int MAX_BYTES = 16384;
    private static final Map<UUID, ColonyActionReplay> RECEIPTS = new HashMap<>();
    private static final Map<UUID, Integer> LAST_QUERY = new HashMap<>();
    private record Location(ServerLevel level, BlockPos position) {}
    private static final class Denied extends RuntimeException {
        final String code;
        Denied(String code) { this.code = code; }
    }
    private record Query(String json) implements CustomPacketPayload {
        static final Type<Query> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "domum_query"));
        static final StreamCodec<RegistryFriendlyByteBuf, Query> CODEC = StreamCodec.of((buf, p) -> write(buf, p.json), buf -> new Query(read(buf)));
        @Override public Type<Query> type() { return TYPE; }
    }
    private record Action(String json) implements CustomPacketPayload {
        static final Type<Action> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "domum_action"));
        static final StreamCodec<RegistryFriendlyByteBuf, Action> CODEC = StreamCodec.of((buf, p) -> write(buf, p.json), buf -> new Action(read(buf)));
        @Override public Type<Action> type() { return TYPE; }
    }
    private record State(String json) implements CustomPacketPayload {
        static final Type<State> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "domum_state"));
        static final StreamCodec<RegistryFriendlyByteBuf, State> CODEC = StreamCodec.of((buf, p) -> write(buf, p.json), buf -> new State(read(buf)));
        @Override public Type<State> type() { return TYPE; }
    }
    static void register(IEventBus bus) {
        bus.addListener(DomumCutterBridge::registerPayloads);
        NeoForge.EVENT_BUS.addListener(DomumCutterBridge::logout);
    }
    private static void logout(PlayerEvent.PlayerLoggedOutEvent event) {
        RECEIPTS.remove(event.getEntity().getUUID()); LAST_QUERY.remove(event.getEntity().getUUID());
    }
    private static void registerPayloads(RegisterPayloadHandlersEvent event) {
        var r = event.registrar("1").optional();
        r.playToClient(State.TYPE, State.CODEC, (payload, context) -> {});
        r.playToServer(Query.TYPE, Query.CODEC, (payload, context) -> {
            if (context.player() instanceof ServerPlayer player) context.enqueueWork(() -> query(player, payload.json));
        });
        r.playToServer(Action.TYPE, Action.CODEC, (payload, context) -> {
            if (context.player() instanceof ServerPlayer player) context.enqueueWork(() -> select(player, payload.json));
        });
    }
    private static void write(RegistryFriendlyByteBuf buf, String text) {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new IllegalArgumentException("domum payload too large");
        buf.writeBytes(bytes);
    }
    private static String read(RegistryFriendlyByteBuf buf) {
        if (buf.readableBytes() > MAX_BYTES) throw new IllegalArgumentException("domum payload too large");
        byte[] bytes = new byte[buf.readableBytes()]; buf.readBytes(bytes); return new String(bytes, StandardCharsets.UTF_8);
    }
    private static int bytes(JsonObject body) { return body.toString().getBytes(StandardCharsets.UTF_8).length; }
    private static JsonObject base(ServerPlayer player, String id) {
        JsonObject body = new JsonObject(); body.addProperty("schemaVersion", 1); body.addProperty("kind", "domum_receipt");
        body.addProperty("playerUuid", player.getUUID().toString()); body.addProperty("requestId", id);
        body.addProperty("retryAutomatically", false); return body;
    }
    private static JsonObject point(BlockPos p) {
        JsonObject pos = new JsonObject(); pos.addProperty("x", p.getX()); pos.addProperty("y", p.getY()); pos.addProperty("z", p.getZ()); return pos;
    }
    private static String snbt(ServerPlayer player, ItemStack stack) {
        return stack == null || stack.isEmpty() ? "" : stack.saveOptional(player.registryAccess()).toString();
    }
    private static JsonObject item(ServerPlayer player, ItemStack stack) {
        JsonObject value = new JsonObject(); boolean empty = stack == null || stack.isEmpty();
        value.addProperty("id", empty ? "minecraft:air" : BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
        value.addProperty("count", empty ? 0 : stack.getCount()); value.addProperty("snbt", snbt(player, stack));
        if (!empty) value.addProperty("name", stack.getHoverName().getString()); return value;
    }
    private static Location location(ArchitectsCutterContainer menu) {
        try {
            // Locked 1.0.231 has no public location accessor. Read its actual access object;
            // never overwrite it or infer a block from a client-supplied coordinate.
            Field field = ArchitectsCutterContainer.class.getDeclaredField("worldPosCallable");
            if (!field.trySetAccessible()) throw new Denied("native_menu_location_unavailable");
            ContainerLevelAccess access = (ContainerLevelAccess) field.get(menu);
            return access.evaluate((level, pos) -> {
                if (!(level instanceof ServerLevel server)) throw new Denied("native_menu_location_unavailable");
                return new Location(server, pos.immutable());
            }).orElseThrow(() -> new Denied("native_menu_location_unavailable"));
        } catch (ReflectiveOperationException | SecurityException invalid) { throw new Denied("native_menu_location_unavailable"); }
    }
    private static ArchitectsCutterContainer menu(ServerPlayer player) {
        if (!(player.containerMenu instanceof ArchitectsCutterContainer cutter)) throw new Denied("architects_cutter_menu_not_open");
        Location target = location(cutter);
        if (target.level != player.serverLevel() || !target.level.isLoaded(target.position)) throw new Denied("cutter_not_loaded");
        if (player.distanceToSqr(target.position.getCenter()) > 64) throw new Denied("cutter_not_reachable");
        if (player.isSpectator() || !target.level.mayInteract(player, target.position) || !cutter.stillValid(player)) throw new Denied("cutter_access_denied");
        return cutter;
    }
    private static JsonObject snapshot(ServerPlayer player, ArchitectsCutterContainer cutter) {
        JsonObject state = new JsonObject(); state.addProperty("schemaVersion", 1); state.addProperty("playerUuid", player.getUUID().toString());
        state.addProperty("source", "same_player_native_architects_cutter"); state.addProperty("windowId", cutter.containerId);
        state.addProperty("stateId", cutter.getStateId()); state.add("position", point(location(cutter).position));
        state.addProperty("creative", player.isCreative());
        state.add("currentGroup", cutter.getCurrentGroup() == null ? JsonNull.INSTANCE : new com.google.gson.JsonPrimitive(cutter.getCurrentGroup().toString()));
        state.add("currentVariant", item(player, cutter.getCurrentVariant())); state.add("carried", item(player, cutter.getCarried()));
        state.addProperty("outputSlot", cutter.slots.indexOf(cutter.outputInventorySlot));
        state.add("output", item(player, cutter.outputInventorySlot.getItem()));
        JsonArray inputs = new JsonArray();
        for (int index = 0; index < cutter.inputInventory.getContainerSize(); index++) {
            JsonObject row = new JsonObject(); row.addProperty("slot", index); row.add("item", item(player, cutter.inputInventory.getItem(index))); inputs.add(row);
        }
        state.add("inputs", inputs);
        JsonArray groups = new JsonArray(); int index = 0;
        for (var entry : ModBlocks.getInstance().getOrComputeItemGroups().entrySet()) {
            JsonObject group = new JsonObject(); group.addProperty("groupId", entry.getKey().toString()); group.addProperty("buttonId", index++);
            group.addProperty("variantCount", entry.getValue().size()); groups.add(group);
        }
        state.add("groups", groups);
        // Original ArchitectsCutterScreen displays ten group/variant previews.
        // These are copied templates, never inventory slots or granted items.
        JsonArray groupPreviews = new JsonArray(); index = 0;
        for (var entry : ModBlocks.getInstance().getOrComputeItemGroups().entrySet()) {
            if (index >= 10) break;
            JsonObject preview = new JsonObject(); preview.addProperty("buttonId", index++);
            preview.addProperty("groupId", entry.getKey().toString());
            preview.add("item", item(player, entry.getValue().isEmpty() ? ItemStack.EMPTY : entry.getValue().getFirst()));
            groupPreviews.add(preview);
        }
        state.add("groupPreviews", groupPreviews);
        JsonArray variantPreviews = new JsonArray();
        // A newly opened native container has no group until the Java screen
        // clicks its remembered first group. Do not query a null map key or
        // silently perform that client-side selection for an Agent.
        var currentGroup = cutter.getCurrentGroup();
        var templates = currentGroup == null ? null : ModBlocks.getInstance().getOrComputeItemGroups().get(currentGroup);
        int selectedIndex = templates == null ? -1 : templates.indexOf(cutter.getCurrentVariant());
        state.addProperty("currentVariantIndex", selectedIndex);
        state.addProperty("variantPreviewTotal", templates == null ? 0 : templates.size());
        if (templates != null) for (index = 0; index < Math.min(10, templates.size()); index++) {
            ItemStack previewStack = templates.get(index).copy();
            if (cutter.outputInventorySlot.hasItem() && previewStack.getItem() instanceof BlockItem blockItem
                    && blockItem.getBlock() instanceof IMateriallyTexturedBlock textured) {
                // Same original material operation as texturizeVariantUsingCurrentInput.
                var materials = MaterialTextureData.builder(); int componentIndex = 0;
                for (var component : textured.getComponents()) {
                    var inputItem = cutter.inputInventory.getItem(componentIndex++).getItem();
                    if (inputItem instanceof BlockItem material) materials.setComponent(component.getId(), material.getBlock());
                }
                materials.writeToItemStack(previewStack);
            }
            JsonObject preview = new JsonObject(); preview.addProperty("variantIndex", index);
            preview.add("item", item(player, previewStack)); variantPreviews.add(preview);
        }
        state.add("variantPreviews", variantPreviews); state.addProperty("previewOffset", 0);
        state.addProperty("previewSource", "Domum_1.0.231_original_templates_current_materials");
        JsonArray recipes = new JsonArray(); int total = 0;
        var variant = cutter.getCurrentVariant();
        if (variant != null && !variant.isEmpty()) {
            for (var holder : player.serverLevel().getRecipeManager().getRecipesFor(ModRecipeTypes.ARCHITECTS_CUTTER.get(),
                    new ArchitectsCutterRecipeInput(cutter.inputInventory), player.serverLevel())) {
                ItemStack template = holder.value().getResultItem(player.registryAccess());
                if (template.getItem() != variant.getItem()
                        || !template.getOrDefault(DataComponents.BLOCK_STATE, BlockItemStateProperties.EMPTY)
                        .equals(variant.getOrDefault(DataComponents.BLOCK_STATE, BlockItemStateProperties.EMPTY))) continue;
                total++; if (recipes.size() < 24) recipes.add(holder.id().toString());
            }
        }
        state.add("matchingRecipeIds", recipes); state.addProperty("matchingRecipeCount", total); state.addProperty("matchingRecipesTruncated", total > recipes.size());
        return state;
    }
    private static String bounded(JsonObject body) {
        if (bytes(body) > MAX_BYTES) {
            body.remove("state"); body.remove("choices");
            body.addProperty("stateUnavailable", true); body.addProperty("stateError", "domum_state_too_large");
            if (body.has("readOnly") && body.get("readOnly").getAsBoolean()) { body.addProperty("ok", false); body.addProperty("code", "domum_state_too_large"); }
        }
        return body.toString();
    }
    private static void send(ServerPlayer player, String text) {
        if (player.connection != null && player.connection.hasChannel(State.TYPE)) PacketDistributor.sendToPlayer(player, new State(text));
    }
    private static void query(ServerPlayer player, String text) {
        String id = "invalid", kind = "invalid";
        JsonObject result = base(player, id);
        try {
            JsonObject input = JsonParser.parseString(text).getAsJsonObject(); id = DomumCutterRules.string(input, "requestId");
            if (!id.matches("[A-Za-z0-9:_-]{1,64}")) return;
            kind = DomumCutterRules.string(input, "kind"); result = base(player, id); result.addProperty("query", kind); result.addProperty("readOnly", true);
            if (DomumCutterRules.integer(input, "schemaVersion") != 1 || !(kind.equals("state") || kind.equals("choices"))) throw new Denied("unsupported_query");
            int tick = player.getServer().getTickCount(); Integer last = LAST_QUERY.get(player.getUUID());
            if (last != null && tick - last < 10) throw new Denied("rate_limited"); LAST_QUERY.put(player.getUUID(), tick);
            var cutter = menu(player); result.addProperty("ok", true); result.addProperty("code", "ok"); result.add("state", snapshot(player, cutter));
            if (kind.equals("choices")) choices(player, input, result);
        } catch (RuntimeException error) {
            result = base(player, id); result.addProperty("query", kind); result.addProperty("readOnly", true);
            result.addProperty("ok", false); result.addProperty("code", error instanceof Denied denied ? denied.code : "invalid_or_failed_query"); result.addProperty("stateUnavailable", true);
        }
        send(player, bounded(result));
    }
    private static void choices(ServerPlayer player, JsonObject input, JsonObject result) {
        String groupId = DomumCutterRules.groupId(input);
        int offset = input.has("offset") ? DomumCutterRules.integer(input, "offset") : 0;
        int limit = input.has("limit") ? DomumCutterRules.integer(input, "limit") : 12;
        if (offset < 0 || limit < 1 || limit > 24) throw new Denied("invalid_choice_page");
        var groups = ModBlocks.getInstance().getOrComputeItemGroups();
        var group = ResourceLocation.tryParse(groupId); if (group == null || !groups.containsKey(group)) throw new Denied("group_not_available");
        List<ItemStack> variants = groups.get(group); if (offset > variants.size()) throw new Denied("invalid_choice_offset");
        result.addProperty("groupId", groupId); result.addProperty("offset", offset); result.addProperty("limit", limit); result.addProperty("total", variants.size());
        JsonArray rows = new JsonArray(); result.add("choices", rows); page(result, offset, rows.size(), variants.size());
        for (int index = offset; index < variants.size() && rows.size() < limit; index++) {
            ItemStack variant = variants.get(index); JsonObject row = new JsonObject(); row.addProperty("variantIndex", index);
            row.addProperty("buttonId", groups.size() + index); row.add("variant", item(player, variant)); JsonArray components = new JsonArray();
            if (variant.getItem() instanceof BlockItem block && block.getBlock() instanceof IMateriallyTexturedBlock textured) {
                int slot = 0;
                for (var component : textured.getComponents()) {
                    JsonObject value = new JsonObject(); value.addProperty("inputSlot", slot++); value.addProperty("componentId", component.getId().toString());
                    value.addProperty("validSkinsTag", component.getValidSkins().location().toString()); value.addProperty("optional", component.isOptional());
                    value.addProperty("defaultBlockId", BuiltInRegistries.BLOCK.getKey(component.getDefault()).toString()); value.addProperty("consumedPerCraft", 1); components.add(value);
                }
            }
            row.add("components", components); rows.add(row); page(result, offset, rows.size(), variants.size());
            if (bytes(result) <= MAX_BYTES) continue;
            rows.remove(rows.size() - 1); page(result, offset, rows.size(), variants.size());
            if (rows.isEmpty()) { result.addProperty("ok", false); result.addProperty("code", "choice_item_too_large"); result.addProperty("blockedOffset", index); }
            break;
        }
    }
    private static void page(JsonObject body, int offset, int returned, int total) {
        body.addProperty("returned", returned); body.addProperty("truncated", offset + returned < total);
        body.add("nextOffset", offset + returned < total ? new com.google.gson.JsonPrimitive(offset + returned) : JsonNull.INSTANCE);
    }
    private static void select(ServerPlayer player, String text) {
        String id = "invalid"; boolean started = false; ColonyActionReplay ledger = null; JsonObject result = base(player, id);
        try {
            JsonObject input = JsonParser.parseString(text).getAsJsonObject(); id = DomumCutterRules.string(input, "requestId");
            if (!id.matches("[A-Za-z0-9:_-]{1,64}")) return;
            result = base(player, id); result.addProperty("action", "select");
            var candidate = RECEIPTS.computeIfAbsent(player.getUUID(), ignored -> new ColonyActionReplay()); var lookup = candidate.begin(id, input);
            if (lookup.outcome() == ColonyActionReplay.Outcome.REPLAY) { send(player, lookup.response()); return; }
            if (lookup.outcome() == ColonyActionReplay.Outcome.CONFLICT) throw new Denied("request_id_conflict");
            if (lookup.outcome() == ColonyActionReplay.Outcome.IN_PROGRESS) {
                result.addProperty("ok", false); result.addProperty("code", "action_outcome_unknown"); result.addProperty("outcomeKnown", false);
                result.addProperty("outcomeUnknown", true); result.add("changed", JsonNull.INSTANCE); send(player, bounded(result)); return;
            }
            ledger = candidate;
            if (DomumCutterRules.integer(input, "schemaVersion") != 1 || !DomumCutterRules.string(input, "kind").equals("select")) throw new Denied("unsupported_action");
            ArchitectsCutterContainer cutter = menu(player); JsonObject before = snapshot(player, cutter);
            String denial = DomumCutterRules.check(input, before); if (denial != null) throw new Denied(denial);
            String selection = DomumCutterRules.string(input, "selection"), groupId = DomumCutterRules.groupId(input);
            var groups = ModBlocks.getInstance().getOrComputeItemGroups(); ResourceLocation group = ResourceLocation.tryParse(groupId);
            if (group == null || !groups.containsKey(group)) throw new Denied("group_not_available");
            int buttonId;
            ItemStack choice = null;
            if (selection.equals("group")) buttonId = new ArrayList<>(groups.keySet()).indexOf(group);
            else if (selection.equals("variant")) {
                if (!group.equals(cutter.getCurrentGroup())) throw new Denied("select_group_first");
                int variantIndex = DomumCutterRules.integer(input, "variantIndex");
                if (variantIndex < 0 || variantIndex > 4095 || variantIndex >= groups.get(group).size()) throw new Denied("variant_not_available");
                choice = groups.get(group).get(variantIndex);
                if (!snbt(player, choice).equals(DomumCutterRules.string(input, "choiceSnbt"))) throw new Denied("choice_components_changed");
                buttonId = groups.size() + variantIndex;
            } else throw new Denied("unsupported_selection");
            started = true;
            cutter.clickMenuButton(player, buttonId); // Original selection builds its own result; no direct output or inventory writes here.
            cutter.broadcastChanges();
            JsonObject after = snapshot(player, cutter);
            if (player.containerMenu != cutter || !group.equals(cutter.getCurrentGroup())
                    || (choice != null && !ItemStack.matches(choice, cutter.getCurrentVariant()))
                    || !before.get("inputs").equals(after.get("inputs")) || !before.get("carried").equals(after.get("carried"))) {
                throw new IllegalStateException("native selection invariant changed");
            }
            result.addProperty("ok", true); result.addProperty("code", "selected"); result.addProperty("changed", !before.equals(after));
            result.addProperty("outcomeKnown", true); result.addProperty("outcomeUnknown", false); result.add("state", after);
        } catch (RuntimeException error) {
            result = base(player, id); result.addProperty("action", "select"); result.addProperty("ok", false);
            result.addProperty("code", started ? "action_outcome_unknown" : error instanceof Denied denied ? denied.code : "invalid_or_failed_action");
            result.addProperty("outcomeKnown", !started); result.addProperty("outcomeUnknown", started);
            result.add("changed", started ? JsonNull.INSTANCE : new com.google.gson.JsonPrimitive(false)); result.addProperty("stateUnavailable", true);
        }
        String response = bounded(result); if (ledger != null) ledger.complete(id, response); send(player, response);
    }
}
