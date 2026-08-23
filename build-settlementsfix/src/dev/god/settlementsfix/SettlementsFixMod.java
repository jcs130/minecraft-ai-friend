package dev.god.settlementsfix;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.CustomData;
import net.minecraft.world.item.component.WrittenBookContent;
import net.minecraft.world.entity.npc.Villager;
import net.minecraft.world.level.GameType;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;

/**
 * 右键村民 → 记事件文件（mc_npc.py interact_tail_loop 消费后让 NPC 说话）。
 *
 * 纯服务端：玩家右键我们的中文 NPC（CustomName 非空）时，把 {ts, player, npc} 追加到
 * interact-events.jsonl（每行一个 JSON）。sidecar 脚本 tail 该文件 → 对玩家说今日话题。
 * 路径可用 -Dsettlementsfix.interactFile=... 覆盖（发行版迁移用）；默认本机私服布局。
 *
 * 2026-08-23 技能书施法（造物主谕「真人靠技能书一键施法」）：
 *  - 右键 written_book 且 custom_data.skillbook=<id>（固定技能书：归乡/照明/圣愈/造物）
 *    → 写 spell-requests.jsonl {speaker, skill}；mc_npc.py spell_loop 消费执行（分级冷却）。
 *  - 右键 written_book 且 custom_data.craftreq=true（空白造物卷合书产物）
 *    → 写 spell-requests.jsonl {speaker, text=<全书页>}；mc_npc 白名单直给/超纲呈神。
 *  - 合书识别：合成产物 written_book 且输入含 custom_data.craftreq=true 的书与笔
 *    → 给产物打 custom_data.craftreq=true（空白造物卷链路：买书与笔 → 自写 → 合成 → 右键）。
 * 路径可用 -Dsettlementsfix.spellFile=... 覆盖；默认与 interactFile 同卷。
 *
 * 【2026-08-23 根因修复】原 onRightClickItem 监听 PlayerInteractEvent.RightClickItem，
 * 但 NeoForge 的 RightClickItem 事件只在 ServerPlayerGameMode.useItem（对着空气右键）fire；
 * 书右键打开 GUI 最常走 useItemOn（对着方块右键），该路径根本不 fire 此事件 → 书右键无反应。
 * 正确拦截点 = WrittenBookItem.use（书被使用的唯一统一入口，对空气/对方块右键都走这里），
 * 由 WrittenBookItemMixin @Inject HEAD 调用 {@link #handleSkillBookUse} 完成写盘。
 */
@Mod("settlementsfix")
public class SettlementsFixMod {

    private static final Path INTERACT_FILE = Paths.get(System.getProperty(
            "settlementsfix.interactFile",
            "C:\\Users\\lzl19\\.copaw\\workspaces\\default\\deepseek-harness\\scratch-plugin\\data\\village\\interact-events.jsonl"));

    private static final Path SPELL_FILE = Paths.get(System.getProperty(
            "settlementsfix.spellFile",
            "C:\\Users\\lzl19\\.copaw\\workspaces\\default\\deepseek-harness\\scratch-plugin\\data\\spell-requests.jsonl"));

    /** 状态书（神使手札）请求：右键 → 写 {ts, speaker} 到 status-requests.jsonl（mc-god 消费回执状态）。 */
    private static final Path STATUS_FILE = Paths.get(System.getProperty(
            "settlementsfix.statusFile",
            "C:\\Users\\lzl19\\.copaw\\workspaces\\default\\deepseek-harness\\scratch-plugin\\data\\status-requests.jsonl"));

    private static final Gson GSON = new Gson();

    private static final Logger LOGGER = LoggerFactory.getLogger("settlementsfix");

    public SettlementsFixMod(IEventBus modBus) {
        // PlayerInteractEvent / PlayerEvent 是游戏总线事件（非 mod 总线）；NeoForge.EVENT_BUS 注册
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::onEntityInteract);
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::onItemCrafted);
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::onPlayerLoggedIn);
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::onItemToss);
    }

    /**
     * 神使手札（状态书）不可丢弃（2026-08-23 造物主谕「状态书无法丢弃」）。
     * ItemTossEvent 在玩家丢出物品（Q 键 / 拖出背包 / 丢出快捷栏）时触发且可取消。
     * 技能书/空白造物卷不在保护内——它们是搜集品，可丢、可入箱、可送人。
     */
    private void onItemToss(net.neoforged.neoforge.event.entity.item.ItemTossEvent ev) {
        try {
            var itemEntity = ev.getEntity();
            if (itemEntity != null && isMarkedBook(itemEntity.getItem())) {
                ev.setCanceled(true);
            }
        } catch (Exception e) {
            // 事件 API 变动的兜底：不因监听失败影响游戏
        }
    }

    /**
     * 守护天使以观察者模式登录（2026-08-23，造物主谕「sys 并且登录模式是观察者」）。
     *
     * 守护天使 = 客户端侧 AI 陪玩实体，登录名固定 sys_<owner>（ASCII）。它应在世界旁边
     * 看护主人，而非参与生存：切 SPECTATOR 让它不破坏方块、不拾取掉落、不挨打、不占资源，
     * 只以「守望」姿态存在。配合两个隐形 mixin（实体层 + player_info 名单层），完整形态
     * 是「名单之外、世界之内、主人可见、旁人无感」的观察者。
     *
     * 时机：PlayerLoggedInEvent 在玩家完全加入玩家列表后触发，此时 setGameMode 会向客户端
     * 同步游戏模式包，mineflayer 客户端（守护天使）能正常处理，不影响登录握手。
     */
    private void onPlayerLoggedIn(PlayerEvent.PlayerLoggedInEvent ev) {
        if (ev.getEntity() instanceof ServerPlayer sp) {
            String name = sp.getScoreboardName();
            if (name != null && name.startsWith("sys_")) {
                sp.setGameMode(GameType.SPECTATOR);
            }
        }
    }

    private void onEntityInteract(PlayerInteractEvent.EntityInteract ev) {
        if (!(ev.getTarget() instanceof Villager v)) {
            return;
        }
        var custom = v.getCustomName();
        if (custom == null || custom.getString().isEmpty()) {
            return; // 只记录我们的中文 NPC（铁匠·岳山、神官·静水…），不碰原版村民
        }
        try {
            Path parent = INTERACT_FILE.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            JsonObject o = new JsonObject();
            o.addProperty("ts", System.currentTimeMillis());
            o.addProperty("player", ev.getEntity().getName().getString());
            o.addProperty("npc", custom.getString());
            Files.writeString(INTERACT_FILE, GSON.toJson(o) + System.lineSeparator(),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            // 写盘失败不打断游戏（sidecar 不在线时静默丢弃）
        }
    }

    /**
     * 技能书施法统一入口（2026-08-23 根因修复）。
     *
     * 由 WrittenBookItemMixin @Inject 到 {@code WrittenBookItem.use} HEAD 处调用。
     * 为什么不用 PlayerInteractEvent.RightClickItem：该事件只在「对着空气右键」fire，
     * 玩家拿着书右键地面/方块打开 GUI 时走 useItemOn，不 fire 此事件 → 书右键永远不触发。
     * 而 WrittenBookItem.use 是书被使用的唯一统一入口（对空气/对方块都经过它），
     * 服务端在 HEAD 处检查 custom_data 并写 spell-requests.jsonl。
     *
     * @param player 使用书的玩家
     * @param stack  玩家手上的 ItemStack（WrittenBookItem）
     */
    /** 是否技能书（skillbook 标记）或空白造物卷（craftreq 标记）：右键 = 施法。双端一致——客户端据此取消打开。 */
    public static boolean isSkillBook(ItemStack stack) {
        if (!stack.is(Items.WRITTEN_BOOK)) {
            return false;
        }
        var cd = stack.get(DataComponents.CUSTOM_DATA);
        if (cd == null || cd.isEmpty()) {
            return false;
        }
        try {
            CompoundTag data = cd.getUnsafe();
            if (data == null) {
                return false;
            }
            return data.contains("skillbook") || data.getBoolean("craftreq");
        } catch (Exception e) {
            return false;
        }
    }

    /** 是否神使手札（custom_data.statusbook=true）。双端一致。 */
    public static boolean isStatusBook(ItemStack stack) {
        if (!stack.is(Items.WRITTEN_BOOK)) {
            return false;
        }
        var cd = stack.get(DataComponents.CUSTOM_DATA);
        if (cd == null || cd.isEmpty()) {
            return false;
        }
        try {
            CompoundTag data = cd.getUnsafe();
            return data != null && data.getBoolean("statusbook");
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 是否受保护的神使手札（custom_data.statusbook=true）：不可丢弃、不可入箱。
     * 2026-08-23 拍板：只有状态书受保护——技能书/空白造物卷是搜集品，
     * 可丢、可入箱、可送人（用户「技能书还得自己去搜集…可以给别人」）。
     */
    public static boolean isMarkedBook(ItemStack stack) {
        if (!stack.is(Items.WRITTEN_BOOK)) {
            return false;
        }
        var cd = stack.get(DataComponents.CUSTOM_DATA);
        if (cd == null || cd.isEmpty()) {
            return false;
        }
        CompoundTag data;
        try {
            data = cd.getUnsafe();
        } catch (Exception e) {
            return false; // 非法 custom_data 视为无标记
        }
        if (data == null) {
            return false;
        }
        return data.getBoolean("statusbook");
    }

    /**
     * 技能书/神使手札使用统一入口。返回 true = 标记书（本次交互被消费，调用方取消打开书 GUI）；
     * false = 普通书，照常打开。
     */
    public static boolean handleSkillBookUse(Player player, ItemStack stack) {
        // 神使手札（statusbook=true）：右键 = 刷新状态（写 status-requests.jsonl，mc-god 回执），不打开书。
        if (isStatusBook(stack)) {
            if (!player.level().isClientSide) {
                appendStatus(player.getName().getString());
                LOGGER.info("[settlementsfix] statusbook request: player={}", player.getName().getString());
            }
            return true;
        }
        if (!isSkillBook(stack)) {
            return false;
        }
        if (player.level().isClientSide) {
            return true; // 客户端不写盘，但仍取消打开
        }
        var cd = stack.get(DataComponents.CUSTOM_DATA);
        CompoundTag data;
        try {
            data = cd.getUnsafe();
        } catch (Exception e) {
            return true;
        }
        if (data == null) {
            return true;
        }
        String playerName = player.getName().getString();
        // 固定技能书：custom_data.skillbook=<id>
        if (data.contains("skillbook")) {
            String skill = data.getString("skillbook");
            if (!skill.isEmpty()) {
                appendSpell("speaker", playerName, "skill", skill);
                LOGGER.info("[settlementsfix] skillbook cast: player={} skill={}", playerName, skill);
            }
            return true;
        }
        // 空白造物卷（合书产物）：custom_data.craftreq=true → 读全书页作为祈愿文
        if (data.getBoolean("craftreq")) {
            StringBuilder sb = new StringBuilder();
            WrittenBookContent content = stack.get(DataComponents.WRITTEN_BOOK_CONTENT);
            if (content != null) {
                for (var filtered : content.pages()) {
                    String raw = filtered.raw().getString();
                    if (raw != null && !raw.isEmpty()) {
                        sb.append(raw).append(' ');
                    }
                }
            }
            String text = sb.toString().trim();
            if (!text.isEmpty()) {
                appendSpell("speaker", playerName, "text", text);
                LOGGER.info("[settlementsfix] craftreq request: player={} len={}", playerName, text.length());
            }
            return true;
        }
        return true;
    }

    private void onItemCrafted(PlayerEvent.ItemCraftedEvent ev) {
        if (ev.getEntity().level().isClientSide) {
            return;
        }
        var result = ev.getCrafting();
        if (!result.is(Items.WRITTEN_BOOK)) {
            return;
        }
        var inv = ev.getInventory();
        if (inv == null) {
            return;
        }
        // 输入含 craftreq 标记的书与笔 → 产物打 craftreq=true（空白造物卷链路）
        boolean src = false;
        for (int i = 0; i < inv.getContainerSize(); i++) {
            var st = inv.getItem(i);
            if (st.is(Items.WRITABLE_BOOK)) {
                var cd = st.get(DataComponents.CUSTOM_DATA);
                if (cd != null && !cd.isEmpty()) {
                    try {
                        CompoundTag d = cd.getUnsafe();
                        if (d != null && d.getBoolean("craftreq")) {
                            src = true;
                            break;
                        }
                    } catch (Exception ignore) {
                        // 非法 custom_data 视为无标记
                    }
                }
            }
        }
        if (src) {
            CustomData cd = result.get(DataComponents.CUSTOM_DATA);
            if (cd == null) {
                cd = CustomData.EMPTY;
            }
            final CustomData fcd = cd;
            result.set(DataComponents.CUSTOM_DATA, fcd.update(j -> j.putBoolean("craftreq", true)));
        }
    }

    /** 追加 {ts, speaker, skill|text} 到 spell-requests.jsonl（每行一个 JSON）。 */
    private static void appendSpell(String... kv) {
        try {
            Path parent = SPELL_FILE.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            JsonObject o = new JsonObject();
            o.addProperty("ts", System.currentTimeMillis());
            for (int i = 0; i + 1 < kv.length; i += 2) {
                o.addProperty(kv[i], kv[i + 1]);
            }
            Files.writeString(SPELL_FILE, GSON.toJson(o) + System.lineSeparator(),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            // 写盘失败不打断游戏
        }
    }

    /** 追加 {ts, speaker} 到 status-requests.jsonl（神使手札右键刷新状态请求）。 */
    private static void appendStatus(String playerName) {
        try {
            Path parent = STATUS_FILE.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            JsonObject o = new JsonObject();
            o.addProperty("ts", System.currentTimeMillis());
            o.addProperty("speaker", playerName);
            Files.writeString(STATUS_FILE, GSON.toJson(o) + System.lineSeparator(),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            // 写盘失败不打断游戏
        }
    }
}
