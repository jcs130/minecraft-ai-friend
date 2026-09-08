package dev.qiandeng.irons;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import io.redspace.ironsspellbooks.api.item.IScroll;
import io.redspace.ironsspellbooks.api.magic.MagicData;
import io.redspace.ironsspellbooks.api.magic.SpellSelectionManager;
import io.redspace.ironsspellbooks.api.registry.AttributeRegistry;
import io.redspace.ironsspellbooks.api.spells.AbstractSpell;
import io.redspace.ironsspellbooks.api.spells.CastResult;
import io.redspace.ironsspellbooks.api.spells.CastSource;
import io.redspace.ironsspellbooks.api.spells.ISpellContainer;
import io.redspace.ironsspellbooks.api.spells.SpellData;
import io.redspace.ironsspellbooks.api.util.Utils;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.Holder;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.contents.TranslatableContents;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.ai.attributes.Attribute;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.item.ItemStack;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.ModList;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Server-only adapter. Native Iron's Spellbooks remains the casting authority. */
@Mod(QiandengIronsBridge.MOD_ID)
public final class QiandengIronsBridge {
    public static final String MOD_ID = "qiandeng_irons_bridge";
    public static final String PREFIX = "QD_SPELL_JSON ";
    private static final int MAX_LIST = 256;

    public QiandengIronsBridge() {
        NeoForge.EVENT_BUS.addListener(this::registerCommands);
    }

    private void registerCommands(RegisterCommandsEvent event) {
        var root = Commands.literal("qdspell");
        var self = Commands.literal("self").requires(s -> s.getEntity() instanceof ServerPlayer);
        for (String action : List.of("status", "list", "cancel", "menu", "cast", "progression")) {
            LiteralArgumentBuilder<CommandSourceStack> selfAction = Commands.literal(action);
            if (action.equals("cast")) {
                // Terminal greedy argument accepts ':'; validation still permits one ID only.
                selfAction.then(Commands.argument("spell", StringArgumentType.greedyString())
                    .executes(c -> run(c.getSource(), action, null, StringArgumentType.getString(c, "spell"))));
            } else selfAction.executes(c -> run(c.getSource(), action, null, null));
            self.then(selfAction);
            {
                var actor = Commands.argument("actor", StringArgumentType.string());
                if (action.equals("cast")) {
                    actor.then(Commands.argument("spell", StringArgumentType.greedyString())
                        .executes(c -> run(c.getSource(), action, StringArgumentType.getString(c, "actor"),
                            StringArgumentType.getString(c, "spell"))));
                } else actor.executes(c -> run(c.getSource(), action, StringArgumentType.getString(c, "actor"), null));
                root.then(Commands.literal(action).requires(s -> s.hasPermission(2)).then(actor));
            }
        }
        root.then(self);
        event.getDispatcher().register(root);
        WaypointTravel.register(event.getDispatcher());
        TradeBridge.register(event.getDispatcher());
        WorldMenuBridge.register(event.getDispatcher());
        WorldScanBridge.register(event.getDispatcher());
    }

    private static int run(CommandSourceStack source, String action, String actorQuery, String spellId) {
        JsonObject result;
        ServerPlayer actor = null;
        try {
            actor = actorQuery == null ? source.getPlayerOrException() : resolve(source.getServer(), actorQuery);
            result = switch (action) {
                case "status", "list" -> describe(actor, action);
                case "cast" -> cast(actor, spellId);
                case "cancel" -> cancel(actor);
                case "menu" -> openMenu(actor);
                case "progression" -> progression(actor);
                default -> throw new BridgeFailure("unknown_action", "未知操作");
            };
        } catch (BridgeFailure e) {
            result = response(actor, action, false, e.code, e.getMessage());
        } catch (Exception e) {
            // Do not replay a failed native action: its execution may already have begun.
            result = response(actor, action, false, "bridge_error", "施法结果待核实，请查询状态，不要自动重发");
            result.addProperty("errorType", e.getClass().getSimpleName());
        }
        JsonObject finalResult = result;
        source.sendSuccess(() -> Component.literal(PREFIX + finalResult), false);
        return result.get("ok").getAsBoolean() ? 1 : 0;
    }

    static ServerPlayer resolve(MinecraftServer server, String query) {
        var all = new ArrayList<ServerPlayer>(server.getPlayerList().getPlayers());
        for (var level : server.getAllLevels()) {
            for (var entity : level.getAllEntities()) {
                if (entity instanceof ServerPlayer player) all.add(player);
            }
        }
        var found = ActorLookup.resolve(query, all, ServerPlayer::getUUID, p -> p.getGameProfile().getName());
        if (found.actor() == null) throw new BridgeFailure(found.code(),
            found.code().equals("ambiguous_actor") ? "同名角色不唯一，请使用 UUID" : "未找到已加载的玩家角色");
        return found.actor();
    }

    static JsonObject response(ServerPlayer actor, String action, boolean ok, String code, String summary) {
        var out = new JsonObject();
        out.addProperty("schema", 1);
        out.addProperty("engine", "irons_spellbooks");
        out.addProperty("ok", ok);
        out.addProperty("code", code);
        out.addProperty("action", action);
        out.addProperty("actor", actor == null ? "" : actor.getGameProfile().getName());
        out.addProperty("actorUuid", actor == null ? "" : actor.getStringUUID());
        out.addProperty("summary", summary);
        return out;
    }

    static JsonObject describe(ServerPlayer player, String action) {
        var out = response(player, action, true, "ok", action.equals("list") ? "已装备的原生法术" : "原生施法状态");
        addStatus(out, player);
        if (action.equals("list")) {
            var all = options(player);
            var spells = new JsonArray();
            for (var option : all.subList(0, Math.min(all.size(), MAX_LIST))) spells.add(spellJson(player, option));
            out.add("spells", spells);
            out.addProperty("total", all.size());
            out.addProperty("truncated", all.size() > MAX_LIST);
            out.addProperty("readiness", "preflight_only; target checks and native events run when casting");
        }
        return out;
    }

    private static JsonObject progression(ServerPlayer player) {
        if (!ModList.get().isLoaded("puffish_skills")) {
            var out = response(player, "progression", false, "mod_unavailable", "未加载原生成长模组");
            out.add("categories", new JsonArray());
            return out;
        }
        return ProgressionReader.read(player);
    }

    static void addStatus(JsonObject out, ServerPlayer player) {
        var data = MagicData.getPlayerMagicData(player);
        out.addProperty("mana", data.getMana());
        out.addProperty("maxMana", attribute(player, AttributeRegistry.MAX_MANA));
        out.addProperty("level", player.experienceLevel);
        var attrs = new JsonObject();
        attrs.addProperty("maxMana", attribute(player, AttributeRegistry.MAX_MANA));
        attrs.addProperty("manaRegen", attribute(player, AttributeRegistry.MANA_REGEN));
        attrs.addProperty("spellPower", attribute(player, AttributeRegistry.SPELL_POWER));
        attrs.addProperty("spellResist", attribute(player, AttributeRegistry.SPELL_RESIST));
        attrs.addProperty("cooldownReduction", attribute(player, AttributeRegistry.COOLDOWN_REDUCTION));
        attrs.addProperty("castTimeReduction", attribute(player, AttributeRegistry.CAST_TIME_REDUCTION));
        attrs.addProperty("maxHealth", attribute(player, Attributes.MAX_HEALTH));
        attrs.addProperty("health", player.getHealth());
        out.add("attributes", attrs);
        out.add("casting", castingJson(data));
    }

    private static double attribute(ServerPlayer player, Holder<Attribute> key) {
        var attr = player.getAttribute(key);
        return attr == null ? 0 : attr.getValue();
    }

    private static JsonObject castingJson(MagicData data) {
        var cast = new JsonObject();
        boolean active = data.isCasting();
        cast.addProperty("active", active);
        cast.addProperty("id", active ? data.getCastingSpellId() : "");
        cast.addProperty("level", active ? data.getCastingSpellLevel() : 0);
        cast.addProperty("castType", active ? data.getCastType().name().toLowerCase(Locale.ROOT) : "none");
        cast.addProperty("remainingTicks", active ? data.getCastDurationRemaining() : 0);
        cast.addProperty("totalTicks", active ? data.getCastDuration() : 0);
        cast.addProperty("progress", active ? data.getCastCompletionPercent() : 0);
        return cast;
    }

    record Option(SpellData data, CastSource source, String slot, int index, InteractionHand hand) {
        String id() { return data.getSpell().getSpellId(); }
    }

    static List<Option> options(ServerPlayer player) {
        var choices = new ArrayList<Option>();
        for (var option : new SpellSelectionManager(player).getAllSpells()) {
            if (validSpell(option.spellData)) choices.add(new Option(option.spellData, option.getCastSource(),
                option.slot, option.globalIndex, null));
        }
        // Scrolls must be in the actual hand; inventory scrolls are not silently equipped.
        for (var hand : InteractionHand.values()) {
            ItemStack held = player.getItemInHand(hand);
            if (held.getItem() instanceof IScroll && ISpellContainer.isSpellContainer(held)) {
                var data = ISpellContainer.get(held).getSpellAtIndex(0);
                if (validSpell(data)) choices.add(new Option(data, CastSource.SCROLL,
                    hand == InteractionHand.MAIN_HAND ? SpellSelectionManager.MAINHAND : SpellSelectionManager.OFFHAND,
                    -1, hand));
            }
        }
        return choices;
    }

    private static boolean validSpell(SpellData data) {
        return data != null && data != SpellData.EMPTY && data.getLevel() > 0 && data.getSpell() != null;
    }

    static JsonObject spellJson(ServerPlayer player, Option option) {
        AbstractSpell spell = option.data().getSpell();
        int level = spell.getLevelFor(option.data().getLevel(), player);
        var data = MagicData.getPlayerMagicData(player);
        var check = spell.canBeCastedBy(level, option.source(), data, player);
        var out = new JsonObject();
        out.addProperty("id", option.id());
        out.addProperty("name", spell.getDisplayName(player).getString());
        out.addProperty("nameKey", spell.getComponentId());
        out.addProperty("level", level);
        out.addProperty("mana", option.source().consumesMana() ? spell.getManaCost(level) : 0);
        var cooldown = data.getPlayerCooldowns().getSpellCooldowns().get(option.id());
        out.addProperty("cooldownMs", option.source().respectsCooldown() && cooldown != null
            ? Math.max(0, cooldown.getCooldownRemaining()) * 50L : 0L);
        out.addProperty("castTimeTicks", spell.getEffectiveCastTime(level, player));
        out.addProperty("castType", spell.getCastType().name().toLowerCase(Locale.ROOT));
        out.addProperty("source", option.source().name().toLowerCase(Locale.ROOT));
        out.addProperty("sourceSlot", option.slot());
        out.addProperty("index", option.index());
        out.addProperty("ready", !data.isCasting() && player.isAlive() && !player.isSpectator() && check.isSuccess());
        if (data.isCasting()) out.addProperty("reasonKey", "busy");
        else if (!player.isAlive() || player.isSpectator()) out.addProperty("reasonKey", "actor_unavailable");
        else if (!check.isSuccess()) out.addProperty("reasonKey", reasonKey(check));
        return out;
    }

    private static String reasonKey(CastResult check) {
        if (check.message != null && check.message.getContents() instanceof TranslatableContents translatable) {
            return translatable.getKey();
        }
        return "native_denied";
    }

    private static String failureCode(String key) {
        if (key.contains("cooldown")) return "cooldown";
        if (key.contains("mana")) return "mana";
        if (key.contains("learn")) return "unlearned";
        return "native_denied";
    }

    static JsonObject cast(ServerPlayer player, String skillId) {
        if (skillId == null || !skillId.contains(":") || ResourceLocation.tryParse(skillId) == null) {
            throw new BridgeFailure("invalid_skill_id", "请使用法术列表中的完整注册 ID");
        }
        var data = MagicData.getPlayerMagicData(player);
        if (data.isCasting()) {
            var out = response(player, "cast", false, "busy", "正在施法；请等待或显式取消");
            addStatus(out, player);
            return out;
        }
        if (!player.isAlive() || player.isSpectator()) {
            return response(player, "cast", false, "actor_unavailable", "当前角色状态不能施法");
        }
        // Native selection is first (book/imbued equipment), then held main/offhand scroll.
        // Rebuild now: a stale menu/CLI list cannot grant a removed or unequipped spell.
        var selected = options(player).stream().filter(o -> o.id().equals(skillId)).findFirst().orElse(null);
        if (selected == null) return response(player, "cast", false, "not_equipped", "请先装备含该法术的法术书、装备或手持卷轴");
        AbstractSpell spell = selected.data().getSpell();
        var check = spell.canBeCastedBy(spell.getLevelFor(selected.data().getLevel(), player), selected.source(), data, player);
        if (!check.isSuccess()) {
            var out = response(player, "cast", false, failureCode(reasonKey(check)),
                check.message == null ? "原生规则拒绝施法" : check.message.getString());
            out.addProperty("reasonKey", reasonKey(check));
            out.add("spell", spellJson(player, selected));
            addStatus(out, player);
            return out;
        }
        float before = data.getMana();
        boolean accepted;
        if (selected.hand() == null) {
            accepted = Utils.serverSideInitiateQuickCast(player, selected.index());
        } else {
            var stack = player.getItemInHand(selected.hand());
            var result = player.gameMode.useItem(player, player.serverLevel(), stack, selected.hand());
            // Native Scroll.use returns CONSUME iff attemptInitiateCast accepted.
            // Do not require isCasting: an instantaneous native/addon completion must
            // never be reported as rejection and inadvertently replayed by an agent.
            accepted = result.consumesAction();
        }
        var out = response(player, "cast", accepted, accepted ? "casting_started" : "native_denied",
            accepted ? "原生施法已开始；效果与消耗由原生施法流程处理" : "原生目标检查、装备或事件拒绝了施法");
        out.addProperty("accepted", accepted);
        out.addProperty("phase", accepted ? (data.isCasting() ? "casting" : "accepted") : "rejected");
        out.addProperty("acceptanceEvidence", selected.hand() == null ? "native_quick_cast" : "native_item_use");
        out.addProperty("manaBefore", before);
        out.addProperty("manaAfter", data.getMana());
        out.add("spell", spellJson(player, selected));
        addStatus(out, player);
        return out;
    }

    static JsonObject cancel(ServerPlayer player) {
        var data = MagicData.getPlayerMagicData(player);
        boolean wasCasting = data.isCasting();
        if (wasCasting) Utils.serverSideCancelCast(player);
        var out = response(player, "cancel", true, wasCasting ? "cancelled" : "idle",
            wasCasting ? "已请求原生取消施法" : "当前没有施法");
        addStatus(out, player);
        return out;
    }

    private static JsonObject openMenu(ServerPlayer player) {
        if (MagicData.getPlayerMagicData(player).isCasting()) {
            return response(player, "menu", false, "busy", "正在施法；请等待或先取消，避免打开界面中断施法");
        }
        var opened = player.openMenu(new SimpleMenuProvider((id, inventory, owner) ->
            new SpellMenu(id, inventory, player), Component.literal("千灯纪 · 原生法术")));
        return response(player, "menu", opened.isPresent(), opened.isPresent() ? "menu_opened" : "menu_unavailable",
            opened.isPresent() ? "已打开原生法术菜单" : "当前无法打开法术菜单");
    }

    static final class BridgeFailure extends RuntimeException {
        final String code;
        BridgeFailure(String code, String message) { super(message); this.code = code; }
    }
}
