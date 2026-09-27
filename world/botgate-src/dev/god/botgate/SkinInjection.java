package dev.god.botgate;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.mojang.authlib.GameProfile;
import com.mojang.authlib.properties.Property;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Map;

/**
 * 登录注皮（2026-09-27 造物主令）：让离线登录的 Agent 机器人（ag_naruto 等）
 * 也带上 Mojang 签名皮肤——基岩版(Geyser 转发 player_info)与 Java 端同看一张脸。
 *
 * 配置：config/qiandeng-botgate-skins.json
 *   {"skins": {"ag_naruto": {"value": "<base64>", "signature": "<sig>"}}}
 * 素材来源：numen_companions.dat 里已为私服守卫存档的签名皮肤（与桐人同款管线）。
 *
 * 时机：PlayerEvent.LoadFromFile —— ServerPlayer 已建、player_info 广播前，
 * 改 GameProfile 属性即随加入包下发（SkinsRestorer 同法）。每次登录现读配置，热改生效。
 */
public final class SkinInjection {
    private static final Gson GSON = new Gson();

    private SkinInjection() {}

    public static void onPlayerLoadFromFile(PlayerEvent.LoadFromFile event) {
        try {
            // 服务端 cwd 即 run 目录，config/ 相对路径与 FMLPaths.CONFIGDIR 同源，
            // 且不依赖编译器可见的内部 API。
            Path cfg = Path.of("config", "qiandeng-botgate-skins.json");
            if (!Files.isRegularFile(cfg)) return;
            JsonObject root = GSON.fromJson(Files.readString(cfg, StandardCharsets.UTF_8), JsonObject.class);
            if (root == null || !root.has("skins")) return;
            JsonObject skins = root.getAsJsonObject("skins");
            GameProfile profile = event.getEntity().getGameProfile();
            String name = String.valueOf(profile.getName()).toLowerCase(Locale.ROOT);
            JsonObject entry = null;
            for (Map.Entry<String, com.google.gson.JsonElement> e : skins.entrySet()) {
                if (e.getKey().toLowerCase(Locale.ROOT).equals(name) && e.getValue().isJsonObject()) {
                    entry = e.getValue().getAsJsonObject();
                    break;
                }
            }
            if (entry == null || !entry.has("value")) return;
            String value = entry.get("value").getAsString();
            String sig = entry.has("signature") && !entry.get("signature").isJsonNull()
                    ? entry.get("signature").getAsString() : null;
            var props = profile.getProperties();
            props.removeAll("textures");
            props.put("textures", sig != null && !sig.isEmpty()
                    ? new Property("textures", value, sig)
                    : new Property("textures", value));
            System.out.println("[SKIN-INJECT] " + profile.getName() + " got signed textures (" + value.length() + "B)");
        } catch (Throwable degraded) {
            System.out.println("[SKIN-INJECT] skipped: " + degraded.getClass().getSimpleName());
        }
    }
}
