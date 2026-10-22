package dev.qiandeng.maw.numenmods;
import com.google.gson.*;
import net.minecraft.server.level.ServerPlayer;
import io.redspace.ironsspellbooks.api.magic.MagicData;
import io.redspace.ironsspellbooks.api.registry.AttributeRegistry;
/** Reuses the existing tested native Iron casting implementation, without its commands or old protection setup. */
final class IronNative {
    static JsonObject mana(ServerPlayer p){var o=new JsonObject();o.addProperty("current",MagicData.getPlayerMagicData(p).getMana());o.addProperty("max",p.getAttributeValue(AttributeRegistry.MAX_MANA));return o;}
    static JsonObject invoke(ServerPlayer p,String id,JsonObject args){
        try {
        return switch(id){case "iron.list"->IronsBody.describe(p,"list");case "iron.status"->IronsBody.describe(p,"status");case "iron.cast"->IronsBody.cast(p,args.get("spellId").getAsString());case "iron.cancel"->IronsBody.cancel(p);default->throw new IllegalArgumentException("iron_operation_unknown");};
        }catch(RuntimeException failure){
            if(id.equals("iron.cast")||id.equals("iron.cancel"))throw new IllegalStateException("native_cast_outcome_unknown_check_state",failure);
            throw failure;
        }
    }
}
