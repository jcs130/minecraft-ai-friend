package dev.god.settlementsfix.magic;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.SwordItem;
import net.minecraft.world.item.TridentItem;
import net.minecraft.world.item.AxeItem;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Files;
import java.nio.file.Path;

/**
 * 自助技能附魔（2026-08-30 造物主钦点「玩家自己附魔；武器吃主动技能、装备吃被动光环」）：
 *
 * /skillenchant <player> <skill_id>  OP：主手武器附主动技能（custom_data.skill_enchant）
 *   —— 白名单：rasengan/fireburst/chain_lightning；须先学会（mcdata/magic-state learned）
 * /auraenchant <player> <aura_id>    OP：主手盔甲附被动光环（custom_data.aura）
 *   —— 白名单：bloodlust（嗜血：攻击吸血）/healing（治愈：缓速回血）；须先学会
 *
 * 附魔后的装备可交易/传承——装备本身即凭证（学会只是附上去的门票）。
 * 触发逻辑见 WeaponSkillMixin / AuraTickMixin。
 */
public final class SkillEnchantCommand {
    private static final Logger GODFIX = LoggerFactory.getLogger("godfix-enchant");

    private static final java.util.Set<String> WEAPON_SKILLS = java.util.Set.of("rasengan", "fireburst", "chain_lightning");
    private static final java.util.Set<String> AURAS = java.util.Set.of("bloodlust", "healing");
    private static final java.util.Map<String, String> NAMES = java.util.Map.of(
            "rasengan", "螺旋丸", "fireburst", "炎爆", "chain_lightning", "闪电链",
            "bloodlust", "嗜血光环", "healing", "治愈光环");

    private SkillEnchantCommand() {}

    public static LiteralArgumentBuilder<CommandSourceStack> root() {
        LiteralArgumentBuilder<CommandSourceStack> root = Commands.literal("skillenchant");
        root.requires(src -> src.hasPermission(2));
        root.then(Commands.argument("player", StringArgumentType.word())
                .then(Commands.argument("skill", StringArgumentType.word())
                        .executes(ctx -> enchant(ctx.getSource(), StringArgumentType.getString(ctx, "player"),
                                StringArgumentType.getString(ctx, "skill"), true))));
        root.then(Commands.literal("aura")
                .then(Commands.argument("player", StringArgumentType.word())
                        .then(Commands.argument("aura", StringArgumentType.word())
                                .executes(ctx -> enchant(ctx.getSource(), StringArgumentType.getString(ctx, "player"),
                                        StringArgumentType.getString(ctx, "aura"), false)))));
        return root;
    }

    private static int enchant(CommandSourceStack source, String name, String id, boolean weapon) {
        ServerPlayer sp = source.getServer().getPlayerList().getPlayerByName(name);
        if (sp == null) return 0;
        boolean valid = weapon ? WEAPON_SKILLS.contains(id) : AURAS.contains(id);
        if (!valid) {
            sp.sendSystemMessage(Component.literal("§7「" + id + "」不可附魔。武器可附：" + String.join("/", WEAPON_SKILLS) + "；装备可附：" + String.join("/", AURAS)));
            return 0;
        }
        if (!hasLearned(name, weapon ? id : "aura_" + id)) {
            sp.sendSystemMessage(Component.literal("§7你还没学会「" + NAMES.get(id) + "」——先参悟该技能，才能把它附到装备上。"));
            return 0;
        }
        ItemStack hand = sp.getMainHandItem();
        if (hand.isEmpty()) {
            sp.sendSystemMessage(Component.literal("§7手上空空——把要附魔的" + (weapon ? "武器" : "盔甲") + "拿在主手。"));
            return 0;
        }
        boolean okItem = weapon
                ? (hand.getItem() instanceof SwordItem || hand.getItem() instanceof AxeItem || hand.getItem() instanceof TridentItem)
                : hand.getItem() instanceof ArmorItem;
        if (!okItem) {
            sp.sendSystemMessage(Component.literal("§7主手这不是" + (weapon ? "武器" : "盔甲") + "——技能要附在对的家伙上。"));
            return 0;
        }
        var tag = hand.getOrDefault(DataComponents.CUSTOM_DATA, net.minecraft.world.item.component.CustomData.EMPTY).copyTag();
        if (weapon) tag.putString("skill_enchant", id); else tag.putString("aura", id);
        hand.set(DataComponents.CUSTOM_DATA, net.minecraft.world.item.component.CustomData.of(tag));
        String display = (hand.has(net.minecraft.core.component.DataComponents.CUSTOM_NAME)
                ? hand.getHoverName().getString() : hand.getHoverName().getString());
        sp.sendSystemMessage(Component.literal("§b✦ " + display + " 附上了「" + NAMES.get(id) + "」"
                + (weapon ? "——攻击时有机率触发。" : "——穿戴即生效。")));
        GODFIX.info("[enchant] {} enchanted {}'s item with {}", name, weapon ? "skill" : "aura", id);
        return 1;
    }

    /** 已学校验：读 /mcdata/magic-state.json（世界进程正本镜像）。 */
    private static boolean hasLearned(String player, String id) {
        try {
            String raw = Files.readString(Path.of("/mcdata/magic-state.json"));
            JsonObject root = JsonParser.parseString(raw).getAsJsonObject();
            JsonObject p = root.getAsJsonObject("players").getAsJsonObject(player);
            if (p == null) return false;
            JsonArray learned = p.getAsJsonArray("learned");
            if (learned != null) for (var e : learned) if (e.getAsString().equals(id)) return true;
            String innate = p.has("innateSkill") && !p.get("innateSkill").isJsonNull() ? p.get("innateSkill").getAsString() : null;
            return id.equals(innate);
        } catch (Exception e) {
            GODFIX.warn("[enchant] learned check failed for {}: {}", player, e.toString());
            return false;
        }
    }
}
