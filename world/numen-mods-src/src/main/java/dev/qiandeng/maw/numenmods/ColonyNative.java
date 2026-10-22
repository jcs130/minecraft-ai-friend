package dev.qiandeng.maw.numenmods;
import com.google.gson.JsonObject;
import net.minecraft.server.level.ServerPlayer;
/** Loaded only after MineColonies has been positively identified. Shared native implementations are relocated at build time. */
final class ColonyNative {
    static void checkAccess(ServerPlayer p,net.minecraft.core.BlockPos pos){
        var c=com.minecolonies.api.colony.IColonyManager.getInstance().getColonyByPosFromWorld(p.level(),pos);
        if(c!=null&&!c.getPermissions().hasPermission(p,com.minecolonies.api.colony.permissions.Action.ACCESS_HUTS))throw new IllegalArgumentException("colony_machine_access_denied");
    }
    static JsonObject invoke(ServerPlayer p,JsonObject input,boolean mutation){
        if(mutation)PlayerColonyBridge.handleAction(p,input.toString());else PlayerColonyBridge.handle(p,input.toString());return null;
    }
    static JsonObject domum(ServerPlayer p,JsonObject input,boolean mutation){
        if(mutation){input.addProperty("playerUuid",p.getUUID().toString());DomumCutterBridge.select(p,input.toString());}
        else DomumCutterBridge.query(p,input.toString());return null;
    }
}
