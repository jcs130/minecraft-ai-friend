package dev.qiandeng.maw;

import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.Companions;
import com.dwinovo.numen.entity.NumenPlayer;
import com.hollingsworth.arsnouveau.api.mana.IManaCap;
import com.hollingsworth.arsnouveau.api.registry.SpellCasterRegistry;
import com.hollingsworth.arsnouveau.api.spell.AbstractCaster;
import com.hollingsworth.arsnouveau.api.spell.Spell;
import com.hollingsworth.arsnouveau.common.items.SpellBook;
import com.hollingsworth.arsnouveau.setup.registry.CapabilityRegistry;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.Vec3;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

import java.util.UUID;

/** Server-only, identity-neutral entry point for Numen bodies in My Agent World. */
@Mod("maw_agent_bridge")
public final class AgentBridge {
    private static final String PREFIX = "MAW_AGENT ";
    public AgentBridge(IEventBus eventBus, ModContainer container) {
        TlmMinecoloniesBurningCompat.register(eventBus);
        NeoForge.EVENT_BUS.addListener(AgentBridge::register);
        PlayerMenuBridge.register(eventBus);
        PlayerWorldBridge.register(eventBus);
        DomumCutterBridge.register(eventBus);
        PlayerColonyBridge.register(eventBus);
        PlayerSpellBridge.register(eventBus);
        PlayerMaidBridge.register(eventBus);
        ModOperationsBridge.register(eventBus);
    }

    private static void register(RegisterCommandsEvent event) {
        CommandDispatcher<CommandSourceStack> dispatcher = event.getDispatcher();
        dispatcher.register(Commands.literal("maw_agent")
                .requires(source -> source.hasPermission(4))
                .then(Commands.literal("commands").executes(AgentBridge::commands))
                .then(Commands.literal("list").executes(AgentBridge::list))
                .then(NumenBodyBridge.operationsNode())
                .then(NumenBodyBridge.luaNode())
                .then(NumenBodyBridge.restoreNode())
                .then(NumenBodyBridge.dormantNode())
                .then(Commands.literal("summon")
                        .then(Commands.argument("owner", StringArgumentType.word())
                                .then(Commands.argument("name", StringArgumentType.string())
                                        .executes(AgentBridge::summon))))
                .then(Commands.literal("invoke")
                        .then(Commands.argument("bodyUuid", StringArgumentType.word())
                                .then(Commands.argument("tool", StringArgumentType.word())
                                        .then(Commands.argument("args", StringArgumentType.greedyString())
                                                .executes(AgentBridge::invoke)))))
                .then(Commands.literal("receipt")
                        .then(Commands.argument("bodyUuid", StringArgumentType.word())
                                .then(Commands.argument("callId", StringArgumentType.word())
                                        .executes(AgentBridge::receipt))))
                .then(Commands.literal("spell")
                        .then(Commands.literal("list")
                                .then(Commands.argument("bodyUuid", StringArgumentType.word())
                                        .executes(AgentBridge::listSpells)))
                        .then(Commands.literal("explain")
                                .then(Commands.argument("bodyUuid", StringArgumentType.word())
                                        .then(Commands.argument("spellId", StringArgumentType.greedyString())
                                                .executes(AgentBridge::explainSpell))))
                        .then(Commands.literal("cast")
                                .then(Commands.argument("bodyUuid", StringArgumentType.word())
                                        .then(Commands.argument("spellId", StringArgumentType.greedyString())
                                                .executes(AgentBridge::castSpell)))))
                .then(Commands.literal("dismiss")
                        .then(Commands.argument("bodyUuid", StringArgumentType.word())
                                .executes(AgentBridge::dismiss))));
    }

    private static NumenPlayer find(MinecraftServer server, UUID bodyUuid) {
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            if (player instanceof NumenPlayer body && player.getUUID().equals(bodyUuid)) {
                return body;
            }
        }
        return null;
    }

    private static int respond(CommandSourceStack source, JsonObject body) {
        body.addProperty("schemaVersion", 1);
        source.sendSuccess(() -> Component.literal(PREFIX + body), false);
        return body.has("ok") && !body.get("ok").getAsBoolean() ? 0 : 1;
    }

    private static int reject(CommandSourceStack source, String code) {
        JsonObject body = new JsonObject();
        body.addProperty("ok", false);
        body.addProperty("code", code);
        body.addProperty("retryAutomatically", false);
        return respond(source, body);
    }

    private static int list(CommandContext<CommandSourceStack> context) {
        JsonArray bodies = new JsonArray();
        for (ServerPlayer player : context.getSource().getServer().getPlayerList().getPlayers()) {
            if (player instanceof NumenPlayer body) {
                JsonObject entry = new JsonObject();
                entry.addProperty("name", body.getGameProfile().getName());
                entry.addProperty("bodyUuid", body.getUUID().toString());
                entry.addProperty("ownerUuid", body.getOwnerUuid().toString());
                entry.addProperty("dimension", body.level().dimension().location().toString());
                entry.addProperty("x", body.getX());
                entry.addProperty("y", body.getY());
                entry.addProperty("z", body.getZ());
                entry.addProperty("health", body.getHealth());
                entry.addProperty("maxHealth", body.getMaxHealth());
                bodies.add(entry);
            }
        }
        JsonObject result = new JsonObject();
        result.addProperty("ok", true);
        result.add("bodies", bodies);
        return respond(context.getSource(), result);
    }

    private static int commands(CommandContext<CommandSourceStack> context) {
        JsonObject result = new JsonObject();
        result.addProperty("ok", true);
        JsonArray entries = new JsonArray();
        for (String usage : new String[]{
                "maw_agent list",
                "maw_agent summon <ownerUuid> <name>",
                "maw_agent operations [group]",
                "maw_agent lua <bodyUuid> <actionId> <luaProgram>",
                "maw_agent restore <bodyUuid>",
                "maw_agent dormant <bodyUuid>",
                "maw_agent receipt <bodyUuid> <callId>",
                "maw_agent spell list <bodyUuid>",
                "maw_agent spell explain <bodyUuid> <spellId>",
                "maw_agent spell cast <bodyUuid> <spellId>",
                "maw_agent dismiss <bodyUuid>"}) {
            entries.add(usage);
        }
        result.add("commands", entries);
        result.addProperty("scope", "operator_level_4");
        result.addProperty("legacyMycliParity", false);
        return respond(context.getSource(), result);
    }

    private static int summon(CommandContext<CommandSourceStack> context) {
        CommandSourceStack source = context.getSource();
        String name = StringArgumentType.getString(context, "name");
        if (name.isBlank() || name.length() > 16) {
            return reject(source, "invalid_name");
        }
        UUID owner;
        try {
            owner = UUID.fromString(StringArgumentType.getString(context, "owner"));
        } catch (IllegalArgumentException error) {
            return reject(source, "invalid_owner_uuid");
        }
        // The current official roster is keyed by (owner UUID, name); use body
        // UUIDs for control so different owners never share a same-name body.
        var level = source.getServer().overworld();
        NumenPlayer body = Companions.summon(source.getServer(), owner, name,
                level, Vec3.atCenterOf(level.getSharedSpawnPos()));
        if (body == null) {
            return reject(source, "summon_failed");
        }
        JsonObject result = new JsonObject();
        result.addProperty("ok", true);
        result.addProperty("name", name);
        result.addProperty("bodyUuid", body.getUUID().toString());
        result.addProperty("ownerUuid", owner.toString());
        return respond(source, result);
    }

    private static int invoke(CommandContext<CommandSourceStack> context) {
        return reject(context.getSource(), "numen_0_1_3_tool_retired_use_lua_or_official_mcp");
    }

    private static int receipt(CommandContext<CommandSourceStack> context) {
        return NumenBodyBridge.receipt(context);
    }

    private static NumenPlayer spellBody(CommandContext<CommandSourceStack> context) {
        try {
            return find(context.getSource().getServer(),
                    UUID.fromString(StringArgumentType.getString(context, "bodyUuid")));
        } catch (IllegalArgumentException error) {
            return null;
        }
    }

    /** Report only the recipes already configured in this body's held Ars book. */
    private static int listSpells(CommandContext<CommandSourceStack> context) {
        CommandSourceStack source = context.getSource();
        NumenPlayer body = spellBody(context);
        if (body == null) return reject(source, "body_offline_or_invalid_uuid");
        ItemStack held = body.getMainHandItem();
        JsonObject result = new JsonObject();
        result.addProperty("ok", true);
        result.addProperty("bodyUuid", body.getUUID().toString());
        result.addProperty("heldItem", BuiltInRegistries.ITEM.getKey(held.getItem()).toString());
        result.addProperty("casterEquipped", held.getItem() instanceof SpellBook);
        IManaCap mana = CapabilityRegistry.getMana(body);
        if (mana != null) {
            JsonObject amount = new JsonObject();
            amount.addProperty("current", mana.getCurrentMana());
            amount.addProperty("max", mana.getMaxMana());
            result.add("mana", amount);
        }
        JsonArray spells = new JsonArray();
        if (held.getItem() instanceof SpellBook) {
            AbstractCaster<?> caster = SpellCasterRegistry.from(held);
            if (caster != null) {
                int limit = Math.min(caster.getMaxSlots(), 32);
                result.addProperty("truncated", caster.getMaxSlots() > limit);
                for (int slot = 0; slot < limit; slot++) {
                    Spell spell = caster.getSpell(slot);
                    if (spell == null || !spell.isValid()) continue;
                    spells.add(spellInfo(caster, slot, spell));
                }
            }
        }
        result.add("spells", spells);
        return respond(source, result);
    }

    private static JsonObject spellInfo(AbstractCaster<?> caster, int slot, Spell spell) {
        JsonObject entry = new JsonObject();
        entry.addProperty("id", "ars_nouveau:slot_" + slot);
        entry.addProperty("slot", slot);
        entry.addProperty("name", caster.getSpellName(slot));
        entry.addProperty("recipe", spell.getDisplayString());
        entry.addProperty("manaCost", spell.getCost());
        JsonArray glyphs = new JsonArray();
        for (var glyph : spell.serializeRecipe()) glyphs.add(glyph.toString());
        entry.add("glyphs", glyphs);
        return entry;
    }

    private static int explainSpell(CommandContext<CommandSourceStack> context) {
        CommandSourceStack source = context.getSource();
        NumenPlayer body = spellBody(context);
        if (body == null) return reject(source, "body_offline_or_invalid_uuid");
        ItemStack held = body.getMainHandItem();
        if (!(held.getItem() instanceof SpellBook)) return reject(source, "ars_spellbook_not_held");
        AbstractCaster<?> caster = SpellCasterRegistry.from(held);
        if (caster == null) return reject(source, "ars_spellbook_unconfigured");
        String spellId = StringArgumentType.getString(context, "spellId");
        if (!spellId.matches("ars_nouveau:slot_(0|[1-9][0-9]?)")) {
            return reject(source, "invalid_spell_id");
        }
        int slot = Integer.parseInt(spellId.substring("ars_nouveau:slot_".length()));
        if (slot >= caster.getMaxSlots()) return reject(source, "spell_slot_out_of_range");
        Spell spell = caster.getSpell(slot);
        if (spell == null || !spell.isValid()) return reject(source, "spell_slot_empty_or_invalid");
        JsonObject result = spellInfo(caster, slot, spell);
        result.addProperty("ok", true);
        result.addProperty("bodyUuid", body.getUUID().toString());
        return respond(source, result);
    }

    /** Invoke Ars's own server-side cast path; never grant a book, recipe or mana. */
    private static int castSpell(CommandContext<CommandSourceStack> context) {
        CommandSourceStack source = context.getSource();
        NumenPlayer body = spellBody(context);
        if (body == null) return reject(source, "body_offline_or_invalid_uuid");
        String spellId = StringArgumentType.getString(context, "spellId");
        if (!spellId.matches("ars_nouveau:slot_(0|[1-9][0-9]?)")) {
            return reject(source, "invalid_spell_id");
        }
        ItemStack held = body.getMainHandItem();
        if (!(held.getItem() instanceof SpellBook)) return reject(source, "ars_spellbook_not_held");
        AbstractCaster<?> caster = SpellCasterRegistry.from(held);
        if (caster == null) return reject(source, "ars_spellbook_unconfigured");
        int slot = Integer.parseInt(spellId.substring("ars_nouveau:slot_".length()));
        if (slot >= caster.getMaxSlots()) return reject(source, "spell_slot_out_of_range");
        Spell spell = caster.getSpell(slot);
        if (spell == null || !spell.isValid()) return reject(source, "spell_slot_empty_or_invalid");
        IManaCap mana = CapabilityRegistry.getMana(body);
        if (mana == null) return reject(source, "ars_mana_unavailable");
        double before = mana.getCurrentMana();
        String nativeResult;
        try {
            nativeResult = caster.castSpell(body.level(), body, InteractionHand.MAIN_HAND, null, spell)
                    .getResult().name();
        } catch (RuntimeException error) {
            return reject(source, "ars_native_cast_failed");
        }
        double after = mana.getCurrentMana();
        boolean manaSpent = after < before;
        JsonObject result = new JsonObject();
        result.addProperty("ok", manaSpent);
        if (!manaSpent) result.addProperty("code", "ars_cast_not_confirmed");
        result.addProperty("bodyUuid", body.getUUID().toString());
        result.addProperty("spellId", spellId);
        result.addProperty("name", caster.getSpellName(slot));
        result.addProperty("manaBefore", before);
        result.addProperty("manaAfter", after);
        result.addProperty("manaSpent", before - after);
        result.addProperty("nativeInteraction", nativeResult);
        result.addProperty("effectVerified", false);
        result.addProperty("retryAutomatically", false);
        return respond(source, result);
    }

    private static int dismiss(CommandContext<CommandSourceStack> context) {
        CommandSourceStack source = context.getSource();
        UUID bodyUuid;
        try {
            bodyUuid = UUID.fromString(StringArgumentType.getString(context, "bodyUuid"));
        } catch (IllegalArgumentException error) {
            return reject(source, "invalid_body_uuid");
        }
        NumenPlayer body = find(source.getServer(), bodyUuid);
        if (body == null) {
            return reject(source, "body_offline");
        }
        String name = body.getGameProfile().getName();
        String bodyId = body.getUUID().toString();
        Companions.dismiss(source.getServer(), body);
        JsonObject result = new JsonObject();
        result.addProperty("ok", true);
        result.addProperty("name", name);
        result.addProperty("bodyUuid", bodyId);
        return respond(source, result);
    }
}
