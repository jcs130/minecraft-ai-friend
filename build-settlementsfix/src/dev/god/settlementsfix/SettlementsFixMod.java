package dev.god.settlementsfix;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.CustomData;
import net.minecraft.world.item.component.WrittenBookContent;
import net.minecraft.world.entity.npc.Villager;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;

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
 */
@Mod("settlementsfix")
public class SettlementsFixMod {

    private static final Path INTERACT_FILE = Paths.get(System.getProperty(
            "settlementsfix.interactFile",
            "C:\\Users\\lzl19\\.copaw\\workspaces\\default\\deepseek-harness\\scratch-plugin\\data\\village\\interact-events.jsonl"));

    private static final Path SPELL_FILE = Paths.get(System.getProperty(
            "settlementsfix.spellFile",
            "C:\\Users\\lzl19\\.copaw\\workspaces\\default\\deepseek-harness\\scratch-plugin\\data\\spell-requests.jsonl"));

    private static final Gson GSON = new Gson();

    public SettlementsFixMod(IEventBus modBus) {
        // PlayerInteractEvent / PlayerEvent 是游戏总线事件（非 mod 总线）；NeoForge.EVENT_BUS 注册
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::onEntityInteract);
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::onRightClickItem);
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::onItemCrafted);
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

    private void onRightClickItem(PlayerInteractEvent.RightClickItem ev) {
        if (ev.getLevel().isClientSide) {
            return; // 服务端 only（双端都 fire，避免重复写盘）
        }
        var stack = ev.getItemStack();
        if (!stack.is(Items.WRITTEN_BOOK)) {
            return;
        }
        var cd = stack.get(DataComponents.CUSTOM_DATA);
        if (cd == null || cd.isEmpty()) {
            return;
        }
        CompoundTag data;
        try {
            data = cd.getUnsafe();
        } catch (Exception e) {
            return;
        }
        if (data == null) {
            return;
        }
        String player = ev.getEntity().getName().getString();
        // 固定技能书：custom_data.skillbook=<id>
        if (data.contains("skillbook")) {
            String skill = data.getString("skillbook");
            if (!skill.isEmpty()) {
                appendSpell("speaker", player, "skill", skill);
            }
            return;
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
                appendSpell("speaker", player, "text", text);
            }
        }
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
    private void appendSpell(String... kv) {
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
}
