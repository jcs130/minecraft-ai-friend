package dev.qiandeng.maw;

import com.google.gson.*;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.*;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import java.time.Instant;
import java.util.*;
import java.util.function.Consumer;

/** Human chants/controller menus and Agents all use the existing skill transaction. */
final class SystemCallBridge {
    static final SystemCallSyntax SYNTAX = new SystemCallSyntax(RpgMigrationBridge.load("/maw-system-call-catalog.json"));
    static void register() { NeoForge.EVENT_BUS.addListener(SystemCallBridge::commands); }
    static String skillId(String input) { return SYNTAX.skillId(input); }

    static JsonObject formula(ServerPlayer p, SystemCallSyntax.Formula f) {
        JsonObject row = new JsonObject();
        row.addProperty("id", f.id()); row.addProperty("skillId", f.skillId());
        row.addProperty("name", RpgSkills.definition(f.skillId()).get("title").getAsString());
        row.addProperty("chant", f.chant()); row.addProperty("description", f.description());
        row.addProperty("level", RpgSkills.level(p, f.skillId()));
        row.addProperty("cooldownRemainingMs", RpgSkills.remaining(p, f.skillId()));
        row.addProperty("castOperation", "skill.cast");
        JsonObject args = new JsonObject(); args.addProperty("skillId", f.skillId()); row.add("castArgs", args);
        row.addProperty("gameAdaptation", true);
        return row;
    }

    static JsonObject catalogue(ServerPlayer p) {
        PlayerAuthBridge.requireAuthenticated(p);
        JsonObject out = new JsonObject(); JsonArray formulas = new JsonArray();
        for (var f : SYNTAX.formulas()) formulas.add(formula(p, f));
        out.addProperty("schemaVersion", 1); out.addProperty("bodyId", p.getUUID().toString());
        out.addProperty("gameAdaptation", true); out.add("formulas", formulas);
        out.addProperty("learnOperation", "skill.learn"); out.addProperty("bindOperation", "skill.bind");
        out.addProperty("castOperation", "skill.cast");
        out.addProperty("checkScope", "syntax_and_body_prerequisites_only_target_and_effect_revalidated_on_cast");
        return out;
    }

    static JsonObject check(ServerPlayer p, String input) {
        PlayerAuthBridge.requireAuthenticated(p);
        var f = SYNTAX.parse(input); JsonObject out = formula(p, f);
        out.addProperty("syntaxValid", true); out.addProperty("targetValidated", false);
        out.addProperty("effectApplied", false); out.addProperty("manaSpent", 0);
        try { RpgSkills.ready(p, f.skillId()); out.addProperty("prerequisitesReady", true); out.addProperty("code", "prerequisites_ready_target_checked_on_cast"); }
        catch (IllegalArgumentException failure) { out.addProperty("prerequisitesReady", false); out.addProperty("code", failure.getMessage()); }
        return out;
    }

    static JsonObject stacia(ServerPlayer p) {
        PlayerAuthBridge.requireAuthenticated(p);
        JsonObject out = new JsonObject();
        out.addProperty("schemaVersion", 1); out.addProperty("bodyId", p.getUUID().toString());
        out.addProperty("sampledAt", Instant.now().toString()); out.addProperty("sampledTick", p.getServer().getTickCount());
        out.addProperty("dimension", p.level().dimension().location().toString());
        JsonObject pos = new JsonObject(); pos.addProperty("x", p.getX()); pos.addProperty("y", p.getY()); pos.addProperty("z", p.getZ()); out.add("position", pos);
        JsonObject life = new JsonObject(); life.addProperty("current", p.getHealth()); life.addProperty("max", p.getMaxHealth());
        life.addProperty("absorption", p.getAbsorptionAmount()); life.addProperty("alive", p.isAlive()); out.add("life", life);
        out.add("mana", PlayerSpellBridge.manaState(p)); out.addProperty("food", p.getFoodData().getFoodLevel());
        out.addProperty("saturation", p.getFoodData().getSaturationLevel()); out.addProperty("air", p.getAirSupply());
        out.addProperty("experienceLevel", p.experienceLevel); out.addProperty("availableSkillPoints", RpgSkills.points(p));
        out.addProperty("profession", RpgStore.player(p).get("profession").getAsString());
        JsonArray equipment = new JsonArray();
        for (EquipmentSlot slot : List.of(EquipmentSlot.MAINHAND, EquipmentSlot.OFFHAND, EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET)) {
            ItemStack stack = p.getItemBySlot(slot); JsonObject row = new JsonObject(); row.addProperty("slot", slot.getName());
            row.addProperty("itemId", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
            row.addProperty("name", stack.isEmpty() ? "空" : stack.getHoverName().getString()); row.addProperty("count", stack.getCount());
            if (stack.isDamageableItem()) { JsonObject durability = new JsonObject(); durability.addProperty("current", Math.max(0, stack.getMaxDamage() - stack.getDamageValue())); durability.addProperty("max", stack.getMaxDamage()); row.add("life", durability); }
            else row.add("life", JsonNull.INSTANCE);
            equipment.add(row);
        }
        out.add("equipment", equipment);
        out.addProperty("objectControlAuthority", "ordinary_player_permissions_unchanged");
        out.add("objectControlRank", JsonNull.INSTANCE); out.add("sacredArtsRank", JsonNull.INSTANCE);
        return out;
    }

    static void open(ServerPlayer p, String menu) {
        PlayerAuthBridge.requireAuthenticated(p);
        SimpleContainer c = new SimpleContainer(27); Map<Integer, Consumer<ServerPlayer>> buttons = new HashMap<>();
        String title;
        if (menu.equals("stacia")) {
            title = "Stacia Window · 天命"; JsonObject actual = stacia(p), life = actual.getAsJsonObject("life");
            RpgMigrationBridge.add(c, buttons, 0, Items.APPLE, "天命 " + life.get("current") + "/" + life.get("max"), q -> open(q, "stacia"), "实际服务器生命值；点击刷新", "饱食度 " + actual.get("food") + " · 氧气 " + actual.get("air"));
            RpgMigrationBridge.add(c, buttons, 2, Items.AMETHYST_SHARD, "神圣术 · 实际魔力", q -> open(q, "systemcall"), actual.get("mana").toString(), "使用现有 Ars 魔力，不另造魔力池");
            int slot = 9;
            for (JsonElement e : actual.getAsJsonArray("equipment")) {
                JsonObject row = e.getAsJsonObject();
                RpgMigrationBridge.add(c, buttons, slot++, Items.ANVIL, row.get("slot").getAsString() + " · " + row.get("name").getAsString(), q -> open(q, "stacia"), row.get("life").isJsonNull() ? "没有耐久属性" : "装备天命 " + row.getAsJsonObject("life").get("current") + "/" + row.getAsJsonObject("life").get("max"));
            }
            RpgMigrationBridge.add(c, buttons, 18, Items.COMPASS, "当前绝对坐标", q -> open(q, "stacia"), actual.get("dimension").getAsString(), actual.get("position").toString());
            RpgMigrationBridge.add(c, buttons, 20, Items.EXPERIENCE_BOTTLE, "技能点 " + actual.get("availableSkillPoints"), q -> RpgMigrationBridge.open(q, "skills", 1), "学习与熟练升级仍使用现有技能规则");
        } else if (menu.equals("systemcall")) {
            title = "System Call · 神圣术目录"; int slot = 0;
            for (var f : SYNTAX.formulas()) RpgMigrationBridge.add(c, buttons, slot++, Items.ENCHANTED_BOOK,
                RpgSkills.definition(f.skillId()).get("title").getAsString() + " Lv" + RpgSkills.level(p, f.skillId()),
                q -> RpgMigrationBridge.skillDetail(q, f.skillId()), f.description(), "术式 " + f.id(), "点击学习、绑定或施放；不要求手柄输入英文");
            RpgMigrationBridge.add(c, buttons, 22, Items.NAME_TAG, "查看本人天命", q -> open(q, "stacia"));
        } else throw new IllegalArgumentException("unknown_system_call_menu");
        RpgMigrationBridge.add(c, buttons, 26, Items.COMPASS, "返回命格书", q -> RpgMigrationBridge.open(q, "guide", 1));
        RpgMigrationBridge.show(p, title, c, buttons);
    }

    private static int command(ServerPlayer p, String raw) {
        try {
            PlayerAuthBridge.requireAuthenticated(p);
            String[] parts = raw.isBlank() ? new String[]{"menu"} : raw.trim().split(" +", 2);
            String arg = parts.length == 2 ? parts[1] : ""; JsonObject result;
            switch (parts[0]) {
                case "menu" -> { open(p, "systemcall"); return 1; }
                case "list" -> result = catalogue(p);
                case "explain" -> result = formula(p, SYNTAX.parse(arg));
                case "check" -> result = check(p, arg);
                case "cast" -> result = RpgSkills.cast(p, SYNTAX.parse(arg).skillId());
                default -> throw new IllegalArgumentException("systemcall menu|list|explain <id>|check <id-or-chant>|cast <id-or-chant>");
            }
            result.addProperty("bodyId", p.getUUID().toString());
            RpgMigrationBridge.hint(p, "MC_SYSTEM_CALL " + result); return 1;
        } catch (IllegalArgumentException failure) { RpgMigrationBridge.hint(p, failure.getMessage()); return 0; }
    }

    private static void commands(RegisterCommandsEvent event) {
        var root = Commands.literal("mycli").requires(s -> s.getEntity() instanceof ServerPlayer p && PlayerAuthBridge.authenticated(p));
        root.then(Commands.literal("systemcall").executes(c -> command(c.getSource().getPlayerOrException(), ""))
            .then(Commands.argument("arguments", StringArgumentType.greedyString()).executes(c -> command(c.getSource().getPlayerOrException(), StringArgumentType.getString(c, "arguments")))));
        root.then(Commands.literal("stacia").executes(c -> { open(c.getSource().getPlayerOrException(), "stacia"); return 1; }));
        event.getDispatcher().register(root);
    }
}
