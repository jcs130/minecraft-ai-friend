package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.hollingsworth.arsnouveau.api.mana.IManaCap;
import com.hollingsworth.arsnouveau.api.event.SpellCastEvent;
import com.hollingsworth.arsnouveau.api.event.SpellCostCalcEvent;
import com.hollingsworth.arsnouveau.api.registry.SpellCasterRegistry;
import com.hollingsworth.arsnouveau.api.spell.AbstractCaster;
import com.hollingsworth.arsnouveau.api.spell.Spell;
import com.hollingsworth.arsnouveau.common.items.SpellBook;
import com.hollingsworth.arsnouveau.setup.registry.CapabilityRegistry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Ars operations on the authenticated connection's actual player and held book. */
final class PlayerSpellBridge {
    private static final int MAX_PAYLOAD = 65536;
    private static final int MAX_RECEIPTS = 64;
    private static final Set<String> QUERY_FIELDS = Set.of("schemaVersion", "kind", "requestId", "spellId", "offset", "limit");
    private static final Set<String> ACTION_FIELDS = Set.of("schemaVersion", "kind", "requestId", "spellId",
            "expectedHeldSnbt", "expectedHotbarSlot", "slot", "glyphs", "name");
    // Retain reconnect receipts during this process. They are not a persistent ledger.
    private static final Map<UUID, LinkedHashMap<String, Cached>> RECEIPTS = new LinkedHashMap<>();
    private record Cached(String fingerprint, String receipt) {}
    private static final ThreadLocal<CastEvidence> ACTIVE_CAST = new ThreadLocal<>();
    private static final class CastEvidence {
        final ServerPlayer player;
        SpellCastEvent attempt;
        SpellCostCalcEvent.Post expenditure;
        CastEvidence(ServerPlayer player) { this.player = player; }
    }
    private static void observeCast(SpellCastEvent event) {
        var active = ACTIVE_CAST.get();
        if (active != null && active.attempt == null && event.getEntity() == active.player) active.attempt = event;
    }
    private static void observeExpenditure(SpellCostCalcEvent.Post event) {
        var active = ACTIVE_CAST.get();
        if (active != null && active.attempt != null && event.context == active.attempt.context) active.expenditure = event;
    }

    private record Query(String json) implements CustomPacketPayload {
        static final Type<Query> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "spell_query"));
        static final StreamCodec<RegistryFriendlyByteBuf, Query> CODEC = StreamCodec.of(
                (buf, payload) -> write(buf, payload.json), buf -> new Query(read(buf)));
        @Override public Type<Query> type() { return TYPE; }
    }
    private record Action(String json) implements CustomPacketPayload {
        static final Type<Action> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "spell_action"));
        static final StreamCodec<RegistryFriendlyByteBuf, Action> CODEC = StreamCodec.of(
                (buf, payload) -> write(buf, payload.json), buf -> new Action(read(buf)));
        @Override public Type<Action> type() { return TYPE; }
    }
    private record State(String json) implements CustomPacketPayload {
        static final Type<State> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("maw_agent", "spell_state"));
        static final StreamCodec<RegistryFriendlyByteBuf, State> CODEC = StreamCodec.of(
                (buf, payload) -> write(buf, payload.json), buf -> new State(read(buf)));
        @Override public Type<State> type() { return TYPE; }
    }

    private static void write(RegistryFriendlyByteBuf buf, String json) {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_PAYLOAD) throw new IllegalArgumentException("spell JSON too large");
        buf.writeBytes(bytes);
    }
    private static String read(RegistryFriendlyByteBuf buf) {
        if (buf.readableBytes() > MAX_PAYLOAD) throw new IllegalArgumentException("spell JSON too large");
        byte[] bytes = new byte[buf.readableBytes()];
        buf.readBytes(bytes);
        return new String(bytes, StandardCharsets.UTF_8);
    }
    static void register(IEventBus modBus) {
        modBus.addListener(PlayerSpellBridge::registerPayloads);
        NeoForge.EVENT_BUS.addListener(PlayerSpellBridge::observeCast);
        NeoForge.EVENT_BUS.addListener(PlayerSpellBridge::observeExpenditure);
    }
    private static void registerPayloads(RegisterPayloadHandlersEvent event) {
        var registrar = event.registrar("1").optional();
        registrar.playToClient(State.TYPE, State.CODEC, (payload, context) -> {});
        registrar.playToServer(Query.TYPE, Query.CODEC, (payload, context) -> {
            if (context.player() instanceof ServerPlayer player)
                context.enqueueWork(() -> handle(player, payload.json, false));
        });
        registrar.playToServer(Action.TYPE, Action.CODEC, (payload, context) -> {
            if (context.player() instanceof ServerPlayer player)
                context.enqueueWork(() -> handle(player, payload.json, true));
        });
    }

    private static JsonObject base(ServerPlayer player, String requestId, String action) {
        JsonObject result = new JsonObject();
        result.addProperty("schemaVersion", 1);
        result.addProperty("kind", "spell_receipt");
        result.addProperty("engine", "ars_nouveau");
        result.addProperty("playerUuid", player.getUUID().toString());
        result.addProperty("requestId", requestId);
        result.addProperty("action", action);
        result.addProperty("retryAutomatically", false);
        result.addProperty("effectVerified", false);
        result.addProperty("outcomeKnown", true);
        result.addProperty("receiptScope", "server_process_recent_64_per_player");
        return result;
    }
    private static void send(ServerPlayer player, String json) {
        if (player.connection != null && player.connection.hasChannel(State.TYPE))
            PacketDistributor.sendToPlayer(player, new State(json));
    }
    private static JsonObject failed(JsonObject result, String code) {
        result.addProperty("ok", false);
        result.addProperty("code", code);
        return result;
    }
    private static String snbt(ServerPlayer player, ItemStack stack) {
        return stack.isEmpty() ? "" : stack.saveOptional(player.registryAccess()).toString();
    }
    private static JsonObject cooldown(ServerPlayer player, ItemStack held) {
        JsonObject result = new JsonObject();
        result.addProperty("active", player.getCooldowns().isOnCooldown(held.getItem()));
        result.addProperty("fraction", player.getCooldowns().getCooldownPercent(held.getItem(), 0));
        // ItemCooldowns has no public total/remaining tick API in the pinned version.
        result.add("totalTicks", JsonNull.INSTANCE);
        result.add("remainingTicks", JsonNull.INSTANCE);
        return result;
    }
    private static JsonObject observation(ServerPlayer player) {
        ItemStack held = player.getMainHandItem();
        JsonObject state = new JsonObject();
        state.addProperty("playerUuid", player.getUUID().toString());
        state.addProperty("heldItem", BuiltInRegistries.ITEM.getKey(held.getItem()).toString());
        state.addProperty("heldSnbt", snbt(player, held));
        state.addProperty("selectedHotbarSlot", player.getInventory().selected);
        state.addProperty("casterEquipped", held.getItem() instanceof SpellBook);
        state.addProperty("health", player.getHealth());
        state.addProperty("maxHealth", player.getMaxHealth());
        state.add("cooldown", cooldown(player, held));
        IManaCap mana = CapabilityRegistry.getMana(player);
        if (mana == null) state.add("mana", JsonNull.INSTANCE);
        else {
            JsonObject amount = new JsonObject();
            amount.addProperty("current", mana.getCurrentMana());
            amount.addProperty("max", mana.getMaxMana());
            state.add("mana", amount);
        }
        return state;
    }
    private static JsonObject spellInfo(AbstractCaster<?> caster, int slot, Spell spell) {
        JsonObject result = new JsonObject();
        result.addProperty("id", "ars_nouveau:slot_" + slot);
        result.addProperty("slot", slot);
        result.addProperty("name", caster.getSpellName(slot));
        result.addProperty("recipe", spell.getDisplayString());
        result.addProperty("manaCost", spell.getCost());
        result.addProperty("manaCostIsBase", true);
        JsonArray glyphs = new JsonArray();
        for (var glyph : spell.serializeRecipe()) glyphs.add(glyph.toString());
        result.add("glyphs", glyphs);
        return result;
    }
    private static String fingerprint(JsonObject input) {
        JsonObject normalized = new JsonObject();
        input.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(e -> normalized.add(e.getKey(), e.getValue()));
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(normalized.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    private static void cache(ServerPlayer player, String requestId, String fingerprint, String receipt) {
        var rows = RECEIPTS.computeIfAbsent(player.getUUID(), ignored -> new LinkedHashMap<>());
        rows.put(requestId, new Cached(fingerprint, receipt));
        while (rows.size() > MAX_RECEIPTS) rows.remove(rows.keySet().iterator().next());
    }

    private static void handle(ServerPlayer player, String raw, boolean mutation) {
        String requestId = "invalid";
        String action = mutation ? "cast" : "query";
        String fingerprint = null;
        boolean nativeStarted = false;
        JsonObject result = null;
        try {
            JsonObject input = JsonParser.parseString(raw).getAsJsonObject();
            requestId = input.get("requestId").getAsString();
            if (!requestId.matches("[A-Za-z0-9:_-]{1,64}")) return;
            action = input.get("kind").getAsString();
            result = base(player, requestId, action);
            Set<String> allowed = mutation ? ACTION_FIELDS : QUERY_FIELDS;
            if (input.keySet().stream().anyMatch(field -> !allowed.contains(field))) {
                send(player, failed(result, "unsupported_request_field").toString()); return;
            }
            if (!input.get("schemaVersion").isJsonPrimitive() ||
                    !input.get("schemaVersion").getAsJsonPrimitive().isNumber() ||
                    input.get("schemaVersion").getAsDouble() != 1 ||
                    (mutation ? !(action.equals("cast") || ArsOperations.ACTIONS.contains(action)) : !(Set.of("list", "explain").contains(action) || ArsOperations.QUERIES.contains(action)))) {
                send(player, failed(result, "unsupported_spell_action").toString()); return;
            }
            if (mutation) {
                if (!input.has("expectedHotbarSlot") || !input.get("expectedHotbarSlot").isJsonPrimitive() ||
                        !input.get("expectedHotbarSlot").getAsJsonPrimitive().isNumber() ||
                        input.get("expectedHotbarSlot").getAsDouble() != input.get("expectedHotbarSlot").getAsInt() ||
                        input.get("expectedHotbarSlot").getAsInt() < 0 || input.get("expectedHotbarSlot").getAsInt() > 8 ||
                        !input.has("expectedHeldSnbt") || !input.get("expectedHeldSnbt").isJsonPrimitive() ||
                        !input.get("expectedHeldSnbt").getAsJsonPrimitive().isString()) {
                    send(player, failed(result, "missing_or_invalid_book_precondition").toString()); return;
                }
                fingerprint = fingerprint(input);
                Cached cached = RECEIPTS.getOrDefault(player.getUUID(), new LinkedHashMap<>()).get(requestId);
                if (cached != null) {
                    if (cached.fingerprint.equals(fingerprint)) send(player, cached.receipt);
                    else send(player, failed(result, "request_id_conflict").toString());
                    return;
                }
                // Reserve before native work; a throwing native callback cannot cause a replay.
                JsonObject reserved = failed(base(player, requestId, action), "ars_cast_outcome_unknown");
                reserved.addProperty("outcomeKnown", false);
                cache(player, requestId, fingerprint, reserved.toString());
            }
            result.add("state", observation(player));
            ItemStack held = player.getMainHandItem();
            AbstractCaster<?> caster = held.getItem() instanceof SpellBook ? SpellCasterRegistry.from(held) : null;
            if (ArsOperations.QUERIES.contains(action) || ArsOperations.ACTIONS.contains(action)) {
                ArsOperations.handle(player, input, result);
                result.add("state", observation(player));
            } else if (action.equals("list")) {
                JsonArray spells = new JsonArray();
                if (caster != null) {
                    int limit = Math.min(caster.getMaxSlots(), 32);
                    result.addProperty("truncated", caster.getMaxSlots() > limit);
                    for (int slot = 0; slot < limit; slot++) {
                        Spell spell = caster.getSpell(slot);
                        if (spell != null && spell.isValid()) spells.add(spellInfo(caster, slot, spell));
                    }
                }
                result.add("spells", spells);
                result.addProperty("ok", true);
            } else if (!(held.getItem() instanceof SpellBook)) failed(result, "ars_spellbook_not_held");
            else if (caster == null) failed(result, "ars_spellbook_unconfigured");
            else {
                String spellId = input.get("spellId").getAsString();
                if (!spellId.matches("ars_nouveau:slot_(0|[1-9][0-9]?)")) failed(result, "invalid_spell_id");
                else {
                    int slot = Integer.parseInt(spellId.substring("ars_nouveau:slot_".length()));
                    Spell spell = slot < caster.getMaxSlots() ? caster.getSpell(slot) : null;
                    if (slot >= caster.getMaxSlots()) failed(result, "spell_slot_out_of_range");
                    else if (spell == null || !spell.isValid()) failed(result, "spell_slot_empty_or_invalid");
                    else {
                        result.add("spell", spellInfo(caster, slot, spell));
                        if (!mutation) result.addProperty("ok", true);
                        else if (!player.isAlive() || player.isSpectator()) failed(result, "player_not_active");
                        else if (input.get("expectedHotbarSlot").getAsInt() != player.getInventory().selected ||
                                !input.get("expectedHeldSnbt").getAsString().equals(snbt(player, held)))
                            failed(result, "held_spellbook_changed");
                        else if (player.getCooldowns().isOnCooldown(held.getItem())) failed(result, "ars_item_on_cooldown");
                        else {
                            IManaCap mana = CapabilityRegistry.getMana(player);
                            if (mana == null) failed(result, "ars_mana_unavailable");
                            else {
                                nativeStarted = true;
                                // Ars 5.13.2 SpellBook.use on ServerPlayer updates the book tier
                                // and known-glyph mana bonus, syncs the capability, and returns
                                // PASS. Only its client branch sends PacketCastSpell, so this
                                // server-side call cannot perform a second cast.
                                String bookUse = held.getItem().use(player.level(), player,
                                        InteractionHand.MAIN_HAND).getResult().name();
                                result.addProperty("nativeBookUseInteraction", bookUse);
                                // Native use can update player state. Re-read the actual book,
                                // capability and recipe, retaining every mutation precondition.
                                held = player.getMainHandItem();
                                caster = held.getItem() instanceof SpellBook ? SpellCasterRegistry.from(held) : null;
                                mana = CapabilityRegistry.getMana(player);
                                result.add("state", observation(player));
                                if (!player.isAlive() || player.isSpectator()) failed(result, "player_not_active");
                                else if (input.get("expectedHotbarSlot").getAsInt() != player.getInventory().selected ||
                                        !input.get("expectedHeldSnbt").getAsString().equals(snbt(player, held)))
                                    failed(result, "held_spellbook_changed");
                                else if (!(held.getItem() instanceof SpellBook)) failed(result, "ars_spellbook_not_held");
                                else if (caster == null) failed(result, "ars_spellbook_unconfigured");
                                else if (slot >= caster.getMaxSlots()) failed(result, "spell_slot_out_of_range");
                                else if (player.getCooldowns().isOnCooldown(held.getItem())) failed(result, "ars_item_on_cooldown");
                                else if (mana == null) failed(result, "ars_mana_unavailable");
                                else {
                                    spell = caster.getSpell(slot);
                                    if (spell == null || !spell.isValid()) failed(result, "spell_slot_empty_or_invalid");
                                    else {
                                        result.add("spell", spellInfo(caster, slot, spell));
                                        double before = mana.getCurrentMana();
                                        float healthBefore = player.getHealth();
                                        result.addProperty("manaBefore", before);
                                        result.addProperty("healthBefore", healthBefore);
                                        var evidence = new CastEvidence(player);
                                        String nativeResult;
                                        ACTIVE_CAST.set(evidence);
                                        try {
                                            nativeResult = caster.castSpell(player.level(), player, InteractionHand.MAIN_HAND,
                                                    null, spell).getResult().name();
                                        } finally { ACTIVE_CAST.remove(); }
                                        double after = mana.getCurrentMana();
                                        boolean spent = before - after > 0.000001;
                                        // Ars emits Post only in the actual SUCCESS -> expendMana path,
                                        // including zero-cost casts. CONSUME alone is unconditional.
                                        boolean confirmed = spent || evidence.expenditure != null;
                                        boolean ambiguous = !confirmed && evidence.attempt != null && !evidence.attempt.isCanceled();
                                        result.addProperty("nativeInteraction", nativeResult);
                                        result.addProperty("manaAfter", after);
                                        result.addProperty("manaSpent", before - after);
                                        result.addProperty("healthAfter", player.getHealth());
                                        result.addProperty("healthChanged", player.getHealth() != healthBefore);
                                        result.addProperty("castConfirmed", confirmed);
                                        result.addProperty("nativeCastAttemptObserved", evidence.attempt != null);
                                        result.addProperty("nativeCastCanceled", evidence.attempt != null && evidence.attempt.isCanceled());
                                        result.add("nativeExpendedCost", evidence.expenditure == null ? JsonNull.INSTANCE : new com.google.gson.JsonPrimitive(Math.max(0, evidence.expenditure.currentCost)));
                                        result.addProperty("castEvidence", evidence.expenditure != null ? "native_expenditure_event" : spent ? "native_mana_debit" : "none");
                                        result.addProperty("ok", confirmed);
                                        result.addProperty("outcomeKnown", !ambiguous);
                                        result.addProperty("code", confirmed ? "ars_cast_confirmed" : ambiguous ? "ars_cast_outcome_unknown" : "ars_cast_not_confirmed");
                                        // Confirmation is casting, not arbitrary target effects.
                                        result.add("state", observation(player));
                                        player.containerMenu.broadcastChanges();
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (RuntimeException error) {
            if (result == null) result = base(player, requestId, action);
            failed(result, nativeStarted ? "ars_cast_outcome_unknown" : "invalid_spell_request");
            result.addProperty("outcomeKnown", !nativeStarted);
        }
        if (result == null) return;
        String json = result.toString();
        if (json.getBytes(StandardCharsets.UTF_8).length > 60000) {
            // Preserve already executed mutation evidence while removing oversized state.
            result.remove("state");
            result.remove("spells");
            result.remove("spell");
            result.addProperty("stateUnavailable", true);
            result.addProperty("stateError", "spell_state_too_large");
            if (!mutation) failed(result, "spell_state_too_large");
            json = result.toString();
        }
        if (mutation && fingerprint != null) cache(player, requestId, fingerprint, json);
        send(player, json);
    }
}
