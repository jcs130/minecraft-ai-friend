package dev.qiandeng.maw.numenmods;
import com.google.gson.JsonObject;
import net.minecraft.server.level.ServerPlayer;
/** No login events or MixAuth replacement: only a current owned-provider call can enter these handlers. */
final class PlayerAuthBridge {
    static void requireAuthenticated(ServerPlayer p){ModAccess.requireBody(p);if(!ModAccess.capturing(p))throw new IllegalStateException("native_provider_scope_required");}
    static JsonObject denial(ServerPlayer p,String input,String kind){requireAuthenticated(p);return null;}
}
