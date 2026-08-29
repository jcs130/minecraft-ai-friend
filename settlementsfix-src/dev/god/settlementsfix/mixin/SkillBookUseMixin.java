package dev.god.settlementsfix.mixin;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.Filterable;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.WrittenBookItem;
import net.minecraft.world.item.component.CustomData;
import net.minecraft.world.item.component.WrittenBookContent;
import net.minecraft.world.level.Level;
import net.minecraft.nbt.CompoundTag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * godfix 书卷交互重铸 · godfix.5（2026-08-29 造物主谕）。
 *
 * 取代旧 WrittenBookItemMixin（其右键一律拦截施法、状态书只写 jsonl 等文本回执，
 * 玩家没有任何"翻开看书"的途径）。新交互矩阵（2026-08-29 定稿）：
 *
 *   技能书（custom_data.skillbook=<id>）：
 *     右键        = 施法（写 spell-requests.jsonl，世界侧 mc_npc spell_loop 消费）
 *     潜行+右键   = 打开书本阅读（原版书 UI：书页即技能说明/口诀）
 *
 *   空白造物卷合书（custom_data.craftreq=true）：
 *     右键        = 呈造物（书页全文写 jsonl，白名单直给/超纲呈神）
 *     潜行+右键   = 打开阅读（看自己写了什么）
 *
 *   命格书（custom_data.statusbook=true）：
 *     右键        = 动态重写书页（读 magic-state.json + magic-atoms.json：
 *                   境界/法力/天命/已习法术/被动）→ 直接打开书 UI。
 *                   每次右键都是最新状态，与書本展示页一致。
 *
 * 旧 WrittenBookItemMixin 从 mixins.json 移除，避免 use 双重注入重复写请求。
 * require=0：无书场景静默失效，不炸服。
 */
@Mixin(WrittenBookItem.class)
public class SkillBookUseMixin {

    private static final Logger GODFIX = LoggerFactory.getLogger("godfix-book");
    /** 连点节流：同一玩家 800ms 内只写一次施法请求。 */
    private static final Map<UUID, Long> LAST_USE = new ConcurrentHashMap<>();

    @Inject(
        method = "use(Lnet/minecraft/world/level/Level;Lnet/minecraft/world/entity/player/Player;Lnet/minecraft/world/InteractionHand;)Lnet/minecraft/world/InteractionResultHolder;",
        at = @At("HEAD"),
        cancellable = true,
        require = 0
    )
    private void settlementsfix$bookUse(Level level, Player player, InteractionHand hand,
                                        CallbackInfoReturnable<InteractionResultHolder<ItemStack>> cir) {
        try {
            ItemStack stack = player.getItemInHand(hand);
            boolean serverSide = !level.isClientSide;

            // ── ⓪ 宝箱技能面板（2026-08-30 docs/skill-chest-design.md）：
            //    任意物品带 custom_data.skillbox=true → 右键=开技能面板（手柄十字键
            //    选格子+RT 确认，5 岁萌萌零识字可施法）。优先级最高，先于各书判定。
            //    潜行+右键 = 放行原版行为（保留物品本来用途）。 ──
            {
                CustomData panelTag = stack.get(DataComponents.CUSTOM_DATA);
                if (panelTag != null && !panelTag.isEmpty()
                        && panelTag.copyTag().getBoolean("skillbox")
                        && !player.isShiftKeyDown()) {
                    if (serverSide && player instanceof ServerPlayer sp) {
                        dev.god.settlementsfix.chest.SkillChestCommands.openFor(sp, 0);
                    }
                    cir.setReturnValue(InteractionResultHolder.sidedSuccess(stack, level.isClientSide));
                    return;
                }
            }

            CompoundTag cd = customData(stack);

            // ── ① 命格书：右键=动态重写书页并打开；潜行+右键=开技能面板
            //    （2026-08-30 造物主谕「操作界面找不到」——书即钥匙，不用另发物品）──
            if (cd.getBoolean("statusbook")) {
                if (serverSide && player instanceof ServerPlayer sp) {
                    if (player.isShiftKeyDown()) {
                        dev.god.settlementsfix.chest.SkillChestCommands.openFor(sp, 0);
                    } else {
                        regenerateStatusBook(sp, stack);
                        sp.openItemGui(stack, hand);
                    }
                }
                cir.setReturnValue(InteractionResultHolder.sidedSuccess(stack, level.isClientSide));
                return;
            }

            boolean isSkill = cd.contains("skillbook");
            boolean isCraft = cd.getBoolean("craftreq");
            if (!isSkill && !isCraft) {
                return; // 其他 custom_data 书：放行
            }

            // ── 潜行+右键 = 阅读说明（放行原版打开） ──
            if (player.isShiftKeyDown()) {
                return;
            }

            // ── 右键 = 施法/呈造物（拦下，写请求） ──
            if (serverSide) {
                long now = System.currentTimeMillis();
                Long last = LAST_USE.get(player.getUUID());
                if (last == null || now - last >= 800L) {
                    LAST_USE.put(player.getUUID(), now);
                    String speaker = player.getName().getString();
                    String skill = isSkill ? cd.getString("skillbook") : "";
                    String text = isSkill ? "" : bookPagesText(stack);
                    appendSpellLine(speaker, skill, text);
                    player.displayClientMessage(Component.literal("✦ 卷轴灵光闪动，法力涌动中…"), true);
                }
            }
            cir.setReturnValue(InteractionResultHolder.sidedSuccess(stack, level.isClientSide));
        } catch (Exception e) {
            GODFIX.warn("[book] use hook failed: {}", e.toString());
        }
    }

    // ────────────────────────── helpers ──────────────────────────

    private static CompoundTag customData(ItemStack stack) {
        if (stack == null || !stack.is(net.minecraft.world.item.Items.WRITTEN_BOOK)) {
            return null;
        }
        CustomData cd = stack.get(DataComponents.CUSTOM_DATA);
        if (cd == null || cd.isEmpty()) {
            return null;
        }
        return cd.copyTag();
    }

    /** 造物卷：书页全文（Component → 纯文本，\n 连接）。 */
    private static String bookPagesText(ItemStack stack) {
        WrittenBookContent c = stack.get(DataComponents.WRITTEN_BOOK_CONTENT);
        if (c == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (Component p : c.getPages(false)) {
            if (sb.length() > 0) {
                sb.append('\n');
            }
            sb.append(p.getString());
        }
        return sb.toString();
    }

    private static void appendSpellLine(String speaker, String skill, String text) {
        try {
            String prop = System.getProperty("settlementsfix.spellFile", "/mcdata/spell-requests.jsonl");
            String line = "{\"ts\":" + System.currentTimeMillis()
                    + ",\"speaker\":\"" + esc(speaker)
                    + "\",\"skill\":\"" + esc(skill)
                    + "\",\"text\":\"" + esc(text) + "\"}";
            Path p = Path.of(prop);
            Path parent = p.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            Files.writeString(p, line + System.lineSeparator(), StandardCharsets.UTF_8,
                    java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
        } catch (Exception e) {
            GODFIX.warn("[book] append spell failed: {}", e.toString());
        }
    }

    private static String esc(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\r", "").replace("\n", "\\n");
    }

    // ────────────────── 命格书：动态状态页 ──────────────────

    private static void regenerateStatusBook(ServerPlayer sp, ItemStack stack) {
        String name = sp.getName().getString();
        List<Filterable<Component>> pages = new ArrayList<>();
        try {
            String statePath = System.getProperty("settlementsfix.magicStateFile", "/mcdata/magic-state.json");
            String atomsPath = System.getProperty("settlementsfix.magicAtomsFile", "/mcdata/magic-atoms.json");
            JsonObject me = null;
            JsonArray learned = null;
            JsonArray passives = null;
            try (var fr = Files.newBufferedReader(Path.of(statePath), StandardCharsets.UTF_8)) {
                JsonObject root = JsonParser.parseReader(fr).getAsJsonObject();
                JsonObject players = root.getAsJsonObject("players");
                if (players != null) {
                    me = players.getAsJsonObject(name);
                }
            } catch (Exception ignore) {
                // 文件缺失/玩家未入册 → 下方兜底页
            }
            if (me == null) {
                pages.add(Filterable.passThrough(Component.literal(
                        "§7《命格书》§r\n\n§f" + name + " §7的命格尚未启封。\n\n"
                                + "§8向天神祈祷，命格自会显现。")));
            } else {
                int lv = optInt(me, "level", 1);
                int exp = optInt(me, "exp", 0);
                int mana = optInt(me, "mana", 0);
                int maxMana = optInt(me, "maxMana", 0);
                String innate = optStr(me, "innateSkill", "");
                learned = me.getAsJsonArray("learned");
                passives = me.getAsJsonArray("passives");

                StringBuilder p1 = new StringBuilder();
                p1.append("§6❖ 命 格 书 ❖§r\n\n");
                p1.append("§f").append(name).append("§r\n\n");
                p1.append("§7境界：§eLv ").append(lv).append("§7（悟性 §f").append(exp).append("§7）§r\n");
                p1.append("§7法力：§9").append(mana).append(" §7/ §9").append(maxMana).append("§r\n");
                if (!innate.isEmpty()) {
                    p1.append("§7天命：§d").append(atomName(atomsPath, innate)).append("§r\n");
                }
                p1.append("\n§8—— 已习法术 ——§r");
                // 2026-08-30 造物主谕「操作界面找不到」：首页直接给技能面板入口
                // （点击开宝箱面板，手柄十字键选格子；/skillchest self 人人可跑）。
                Component page1 = Component.empty()
                        .append(Component.literal(p1.toString()))
                        .append(Component.literal("\n\n§e【✦ 打开技能面板】§r§8（点这行）§r")
                                .withStyle(s -> s.withClickEvent(new ClickEvent(
                                        ClickEvent.Action.RUN_COMMAND, "/skillchest self"))));
                pages.add(Filterable.passThrough(page1));

                // 已习法术：每页一个技能，点击整页即施法（2026-08-29 造物主令
                // 「每页一技，这样就可以施法」——书页 clickEvent run_command /mycli cast，
                // 与《魔导书》同机制；萌萌不识字也能「翻到页就点」）。
                if (learned != null && learned.size() > 0) {
                    for (JsonElement el : learned) {
                        String id = el.getAsString();
                        JsonObject meta = atomMeta(atomsPath, id);
                        String n = meta == null ? id : optStr(meta, "name", id);
                        JsonObject cost = (meta != null && meta.has("cost") && meta.get("cost").isJsonObject())
                                ? meta.getAsJsonObject("cost") : null;
                        int spellMana = cost == null ? 0 : optInt(cost, "mana", 0);
                        int spellLv = meta == null ? 0 : optInt(meta, "requiredLevel", 0);
                        // 2026-08-29 造物主设计「命格书=技能仓库」：每技能页两个动作——
                        // ▶ 点击释放（直接放）；✦ 领取技能书（give 成书，拿手上右键施法，
                        // 手柄正道）。书丢了随时翻页再领，背包只留要用的。
                        Component page = Component.empty()
                                .append(Component.literal(
                                        "§6❖ " + n + " ❖§r\n\n"
                                        + (spellLv > 0 ? "§7需要 Lv" + spellLv + "§r\n" : "")
                                        + (spellMana > 0 ? "§7魔力 §b" + spellMana + "§r\n" : "")
                                        + "\n"))
                                .append(Component.literal("§a▶▶ 点击释放 ◀◀§r\n\n")
                                        .withStyle(s -> s.withClickEvent(new ClickEvent(
                                                ClickEvent.Action.RUN_COMMAND, "/mycli cast " + n))))
                                .append(Component.literal("§e【✦ 领取技能书】§r§8（拿手上右键放）§r")
                                        .withStyle(s -> s.withClickEvent(new ClickEvent(
                                                ClickEvent.Action.RUN_COMMAND, "/mycli 领书 " + n))));
                        pages.add(Filterable.passThrough(page));
                    }
                } else {
                    pages.add(Filterable.passThrough(Component.literal("§7尚未习得任何法术。\n\n§8向书商购卷，或求女神开蒙。§r")));
                }

                // 传送阵页（2026-08-29 造物主设计「设置传送点+说数字就传」）：shared 前
                // + personal 后，行序 = 公屏数字序号（同一份 waypoints.json，序号铁律）。
                // 每行点击传送；页尾【记住这里】把脚下记为个人点（自动名「藏宝点N」）。
                try {
                    String wpPath = System.getProperty("settlementsfix.waypointsFile", "/mcdata/waypoints.json");
                    JsonObject wroot = JsonParser.parseReader(Files.newBufferedReader(Path.of(wpPath), StandardCharsets.UTF_8)).getAsJsonObject();
                    JsonArray shared = wroot.has("shared") ? wroot.getAsJsonArray("shared") : new JsonArray();
                    JsonObject wpPlayers = wroot.has("players") ? wroot.getAsJsonObject("players") : new JsonObject();
                    JsonArray personal = (wpPlayers.has(name) && wpPlayers.get(name).isJsonArray())
                            ? wpPlayers.getAsJsonArray(name) : new JsonArray();
                    if (shared.size() + personal.size() > 0) {
                        MutableComponent tp = Component.empty()
                                .append(Component.literal("§d—— 传送阵 ——§r\n§8点行即达，或公屏说数字§r\n"));
                        int[] idx = { 0 };
                        for (JsonArray arr : new JsonArray[]{ shared, personal }) {
                            for (JsonElement wel : arr) {
                                JsonObject w = wel.getAsJsonObject();
                                idx[0]++;
                                String wn = optStr(w, "name", "?");
                                String label = String.format("§b【%d】§f%s§r", idx[0], wn);
                                tp = tp.append(Component.literal("\n" + label)
                                        .withStyle(s -> s.withClickEvent(new ClickEvent(
                                                ClickEvent.Action.RUN_COMMAND, "/mycli 传送去 " + idx[0]))));
                            }
                        }
                        tp = tp.append(Component.literal("\n\n§a【记住这里】§r§8脚下记为传送点§r")
                                .withStyle(s -> s.withClickEvent(new ClickEvent(
                                        ClickEvent.Action.RUN_COMMAND, "/mycli 传送点 记 藏宝点"))));
                        pages.add(Filterable.passThrough(tp));
                    }
                } catch (Exception ignore) {
                    // waypoints.json 缺失/损坏 → 不出传送页（技能页不受影响）
                }

                // 被动天赋页
                StringBuilder pb = new StringBuilder();
                pb.append("§8—— 身负异禀 ——§r\n");
                if (passives != null && passives.size() > 0) {
                    for (JsonElement el : passives) {
                        pb.append("§b· §f").append(passiveName(el.getAsString())).append("§r\n");
                    }
                } else {
                    pb.append("§7尚无异禀。§r");
                }
                pages.add(Filterable.passThrough(Component.literal(pb.toString())));
            }
            pages.add(Filterable.passThrough(Component.literal(
                    "§8§o神谕：法术页点击即施法；技能书右键也施法；传送阵点行即达，或公屏说数字。§r")));
        } catch (Exception e) {
            GODFIX.warn("[book] status regenerate failed: {}", e.toString());
            pages.clear();
            pages.add(Filterable.passThrough(Component.literal("§7命格书被雾气笼罩，暂不可读。§r")));
        }
        WrittenBookContent wbc = new WrittenBookContent(
                Filterable.passThrough("命格书"), "天神", 0, pages, true);
        stack.set(DataComponents.WRITTEN_BOOK_CONTENT, wbc);
    }

    private static int optInt(JsonObject o, String k, int dft) {
        try {
            return o.has(k) ? o.get(k).getAsInt() : dft;
        } catch (Exception e) {
            return dft;
        }
    }

    private static String optStr(JsonObject o, String k, String dft) {
        try {
            return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : dft;
        } catch (Exception e) {
            return dft;
        }
    }

    /** 技能 id → atom 对象（读 magic-atoms.json；缺失返回 null）。 */
    private static JsonObject atomMeta(String atomsPath, String id) {
        try (var fr = Files.newBufferedReader(Path.of(atomsPath), StandardCharsets.UTF_8)) {
            JsonObject root = JsonParser.parseReader(fr).getAsJsonObject();
            JsonArray atoms = root.getAsJsonArray("atoms");
            if (atoms != null) {
                for (JsonElement el : atoms) {
                    JsonObject a = el.getAsJsonObject();
                    if (id.equals(optStr(a, "id", ""))) {
                        return a;
                    }
                }
            }
        } catch (Exception ignore) {
            // 回退 null
        }
        return null;
    }

    /** 技能 id → 中文名（读 magic-atoms.json，缺失回退 id）。 */
    private static String atomName(String atomsPath, String id) {
        JsonObject a = atomMeta(atomsPath, id);
        return a == null ? id : optStr(a, "name", id);
    }

    /** 常见被动 id → 中文名（表驱动，缺失回退 id）。 */
    private static String passiveName(String id) {
        return switch (id) {
            case "bloodrage" -> "血怒";
            case "bulwark" -> "壁垒";
            case "fortitude" -> "坚韧";
            case "survival" -> "求生";
            case "greenthumb" -> "绿指";
            case "nightowl" -> "夜枭";
            case "ironstomach" -> "铁胃";
            default -> id;
        };
    }
}
