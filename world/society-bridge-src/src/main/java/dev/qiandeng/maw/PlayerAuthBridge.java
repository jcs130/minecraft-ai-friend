package dev.qiandeng.maw;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;

import java.lang.reflect.Method;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/** Optional MixAuth integration. No name/IP exemptions, credentials or login bypass. */
public final class PlayerAuthBridge {
    private static final Set<UUID> JOINING = new HashSet<>();
    private static boolean initialized;
    private static boolean enabled;
    private static Method pending;
    private PlayerAuthBridge() {}

    static void register() {
        NeoForge.EVENT_BUS.addListener(EventPriority.HIGHEST, (PlayerEvent.PlayerLoggedInEvent e) -> JOINING.add(e.getEntity().getUUID()));
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, (PlayerEvent.PlayerLoggedInEvent e) -> JOINING.remove(e.getEntity().getUUID()));
        NeoForge.EVENT_BUS.addListener((PlayerEvent.PlayerLoggedOutEvent e) -> JOINING.remove(e.getEntity().getUUID()));
    }

    public static boolean authenticated(ServerPlayer player) {
        if (!initialized) {
            enabled = net.neoforged.fml.ModList.get().isLoaded("mixauth");
            if (enabled) {
                try { pending = Class.forName("io.github.truscdo.mixauth.offline.OfflineAuthSessionService").getMethod("getPendingAuth", ServerPlayer.class); }
                catch (ReflectiveOperationException unavailable) { pending = null; }
            }
            initialized = true;
        }
        if (!enabled) return true;
        if (player.connection == null || JOINING.contains(player.getUUID()) || pending == null) return false;
        try { return pending.invoke(null, player) == null; }
        catch (ReflectiveOperationException failure) { return false; }
    }

    public static void requireAuthenticated(ServerPlayer player) {
        if (!authenticated(player)) throw new IllegalArgumentException("authentication_required");
    }

    static JsonObject denial(ServerPlayer player, String raw, String kind) {
        if (authenticated(player)) return null;
        JsonObject out = new JsonObject();
        out.addProperty("schemaVersion", 1); out.addProperty("kind", kind);
        out.addProperty("playerUuid", player.getUUID().toString());
        out.addProperty("ok", false); out.addProperty("code", "authentication_required");
        out.addProperty("outcomeKnown", true); out.addProperty("changed", false);
        out.addProperty("retryAutomatically", false);
        try {
            JsonObject in = JsonParser.parseString(raw).getAsJsonObject();
            String id = in.get("requestId").getAsString();
            if (id.matches("[A-Za-z0-9:_-]{1,64}")) out.addProperty("requestId", id);
            if (in.has("kind")) out.addProperty("action", in.get("kind").getAsString());
        } catch (RuntimeException ignored) { /* Never inspect world data before authentication. */ }
        return out;
    }
}
