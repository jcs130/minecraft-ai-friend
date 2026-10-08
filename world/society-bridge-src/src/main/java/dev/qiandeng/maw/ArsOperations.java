package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.hollingsworth.arsnouveau.api.ArsNouveauAPI;
import com.hollingsworth.arsnouveau.api.registry.GlyphRegistry;
import com.hollingsworth.arsnouveau.api.registry.SpellCasterRegistry;
import com.hollingsworth.arsnouveau.api.spell.AbstractSpellPart;
import com.hollingsworth.arsnouveau.api.spell.Spell;
import com.hollingsworth.arsnouveau.common.items.Glyph;
import com.hollingsworth.arsnouveau.common.items.SpellBook;
import com.hollingsworth.arsnouveau.common.network.PacketUpdateCaster;
import com.hollingsworth.arsnouveau.common.network.PacketSetCasterSlot;
import com.hollingsworth.arsnouveau.common.spell.validation.GlyphMaxTierValidator;
import com.hollingsworth.arsnouveau.common.spell.validation.GlyphKnownValidator;
import com.hollingsworth.arsnouveau.setup.config.Config;
import com.hollingsworth.arsnouveau.setup.config.ServerConfig;
import com.hollingsworth.arsnouveau.setup.registry.CapabilityRegistry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.Set;

/** Server equivalents of learning a real glyph and editing/selecting a real spellbook. */
final class ArsOperations {
    static final Set<String> QUERIES = Set.of("glyphs");
    static final Set<String> ACTIONS = Set.of("learn_glyph", "configure", "select");
    static void handle(ServerPlayer player, JsonObject input, JsonObject result) {
        boolean started = false;
        try {
            String kind = input.get("kind").getAsString();
            var cap = CapabilityRegistry.getPlayerDataCap(player);
            if (cap == null) ModRequest.fail("ars_player_data_unavailable");
            if (kind.equals("glyphs")) {
                ModRequest.fields(input, "offset", "limit");
                int offset = input.has("offset") ? ModRequest.integer(input, "offset", 0, 10000) : 0;
                int limit = input.has("limit") ? ModRequest.integer(input, "limit", 1, 24) : 12;
                var all = GlyphRegistry.getSpellpartMap().values().stream().sorted(Comparator.comparing(g -> g.getRegistryName().toString())).toList();
                JsonArray rows = new JsonArray();
                for (int i = offset; i < Math.min(all.size(), offset + limit); i++) {
                    var glyph = all.get(i); JsonObject row = new JsonObject();
                    row.addProperty("id", glyph.getRegistryName().toString()); row.addProperty("name", glyph.getLocaleName());
                    row.addProperty("description", glyph.getBookDescLang().getString());
                    row.addProperty("tier", glyph.getConfigTier().value);
                    row.addProperty("enabled", Config.isGlyphEnabled(glyph.getRegistryName()));
                    row.addProperty("known", cap.knowsGlyph(glyph) || GlyphRegistry.getDefaultStartingSpells().contains(glyph));
                    row.addProperty("shownInBook", glyph.shouldShowInSpellBook());
                    rows.add(row);
                }
                result.add("glyphs", rows); result.addProperty("total", all.size()); result.addProperty("offset", offset);
                result.addProperty("hasMore", offset + rows.size() < all.size()); result.addProperty("ok", true); return;
            }
            ModRequest.fields(input, "expectedHeldSnbt", "expectedHotbarSlot", "slot", "glyphs", "name");
            ModRequest.held(player, input);
            var held = player.getMainHandItem();
            result.addProperty("heldBefore", ModRequest.snbt(player, held));
            if (kind.equals("learn_glyph")) {
                if (!(held.getItem() instanceof Glyph)) ModRequest.fail("glyph_item_not_held");
                Glyph glyph = (Glyph) held.getItem(); var part = glyph.spellPart;
                if (!Config.isGlyphEnabled(part.getRegistryName())) ModRequest.fail("glyph_disabled");
                if (cap.knowsGlyph(part) || GlyphRegistry.getDefaultStartingSpells().contains(part)) ModRequest.fail("glyph_already_known");
                result.addProperty("glyphId", part.getRegistryName().toString()); result.addProperty("itemCountBefore", held.getCount());
                started = true;
                // This native use unlocks, syncs mana/known glyphs and consumes ONE actual item.
                held.getItem().use(player.level(), player, InteractionHand.MAIN_HAND);
                result.addProperty("knownAfter", cap.knowsGlyph(part)); result.addProperty("itemCountAfter", player.getMainHandItem().getCount());
                result.addProperty("ok", cap.knowsGlyph(part));
            } else {
                if (!(held.getItem() instanceof SpellBook)) ModRequest.fail("ars_spellbook_not_held");
                var caster = SpellCasterRegistry.from(held);
                if (caster == null) ModRequest.fail("ars_spellbook_unconfigured");
                int slot = ModRequest.integer(input, "slot", 0, Math.min(99, caster.getMaxSlots() - 1));
                result.addProperty("selectedSlotBefore", caster.getCurrentSlot());
                if (kind.equals("configure")) {
                    var glyphIds = ModRequest.array(input, "glyphs", 32); var parts = new ArrayList<AbstractSpellPart>();
                    int maxGlyphs = 10 + caster.getBonusGlyphSlots() + (ServerConfig.INFINITE_SPELLS.get() ? ServerConfig.INF_SPELLS_LENGHT_MODIFIER.get() : 0);
                    if (glyphIds.size() == 0 || glyphIds.size() > maxGlyphs) ModRequest.fail("spell_glyph_count_out_of_range");
                    for (var glyphId : glyphIds) {
                        if (!glyphId.isJsonPrimitive() || !glyphId.getAsJsonPrimitive().isString()) ModRequest.fail("invalid_glyph_id");
                        var id = ResourceLocation.tryParse(glyphId.getAsString()); var part = id == null ? null : GlyphRegistry.getSpellPart(id);
                        if (part == null) ModRequest.fail("glyph_not_found");
                        if (!Config.isGlyphEnabled(id)) ModRequest.fail("glyph_disabled");
                        if (!part.shouldShowInSpellBook()) ModRequest.fail("glyph_not_available_in_book");
                        if (!cap.knowsGlyph(part) && !GlyphRegistry.getDefaultStartingSpells().contains(part)) ModRequest.fail("glyph_not_learned");
                        parts.add(part);
                    }
                    var errors = new ArrayList<>(ArsNouveauAPI.getInstance().getSpellCraftingSpellValidator().validate(parts));
                    errors.addAll(new GlyphMaxTierValidator(((SpellBook) held.getItem()).getTier().value).validate(parts));
                    errors.addAll(new GlyphKnownValidator(cap).validate(parts));
                    errors.addAll(ArsNouveauAPI.getInstance().getSpellCastingSpellValidator().validate(parts));
                    if (!errors.isEmpty()) {
                        JsonArray messages = new JsonArray(); errors.stream().limit(12).forEach(e -> messages.add(e.makeTextComponentExisting().getString()));
                        result.add("validationErrors", messages); ModRequest.fail("invalid_spell_recipe");
                    }
                    String name = ModRequest.text(input, "name", 64);
                    Spell spell = new Spell(parts, name);
                    result.addProperty("slotBefore", caster.getSpell(slot).toJson());
                    started = true;
                    new PacketUpdateCaster(spell, slot, name, true).onServerReceived(player.getServer(), player);
                    var after = SpellCasterRegistry.from(player.getMainHandItem());
                    result.addProperty("slotAfter", after.getSpell(slot).toJson());
                    result.addProperty("ok", after.getSpell(slot).serializeRecipe().equals(spell.serializeRecipe()) && after.getSpellName(slot).equals(name));
                } else if (kind.equals("select")) {
                    if (!caster.getSpell(slot).isValid()) ModRequest.fail("spell_slot_empty_or_invalid");
                    started = true;
                    new PacketSetCasterSlot(slot).onServerReceived(player.getServer(), player);
                    result.addProperty("ok", SpellCasterRegistry.from(player.getMainHandItem()).getCurrentSlot() == slot);
                } else ModRequest.fail("unsupported_spell_action");
                result.addProperty("selectedSlotAfter", SpellCasterRegistry.from(player.getMainHandItem()).getCurrentSlot());
            }
            result.addProperty("heldAfter", ModRequest.snbt(player, player.getMainHandItem()));
            player.containerMenu.broadcastChanges();
            result.addProperty("code", result.get("ok").getAsBoolean() ? "ars_native_operation_verified" : "ars_native_operation_not_applied");
        } catch (ModRequest.Invalid e) { result.addProperty("ok", false); result.addProperty("code", e.getMessage()); }
        catch (RuntimeException e) { result.addProperty("ok", false); result.addProperty("code", started ? "ars_operation_outcome_unknown" : "ars_operation_failed"); result.addProperty("outcomeKnown", !started); }
    }
}
