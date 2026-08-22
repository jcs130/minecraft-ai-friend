package dev.god.settlementsfix;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import net.minecraft.world.entity.npc.Villager;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
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
 */
@Mod("settlementsfix")
public class SettlementsFixMod {

    private static final Path INTERACT_FILE = Paths.get(System.getProperty(
            "settlementsfix.interactFile",
            "C:\\Users\\lzl19\\.copaw\\workspaces\\default\\deepseek-harness\\scratch-plugin\\data\\village\\interact-events.jsonl"));

    private static final Gson GSON = new Gson();

    public SettlementsFixMod(IEventBus modBus) {
        // PlayerInteractEvent 是游戏总线事件（非 mod 总线）；NeoForge.EVENT_BUS 注册
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::onEntityInteract);
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
}
