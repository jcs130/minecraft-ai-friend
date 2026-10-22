package dev.qiandeng.maw.numenmods;
import com.google.gson.*;
import net.minecraft.server.level.ServerPlayer;
/** Private capture adapter for the reused colony handlers; never registers their old channels. */
final class NativeModAccess {
    static boolean capturing(ServerPlayer p){return ModAccess.capturing(p);}
    static boolean capture(ServerPlayer p,JsonObject v){return ModAccess.capture(p,v);}
    static boolean capture(ServerPlayer p,String v){return capture(p,JsonParser.parseString(v).getAsJsonObject());}
}
