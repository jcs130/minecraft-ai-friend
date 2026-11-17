package org.qiandeng.camera;

import com.google.gson.JsonObject;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import net.minecraft.client.Minecraft;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Entity;
import java.util.*;

/** Record the actual native entity and model, without mutating or forcing a load. */
public final class NativeMaidObservation {
    public static void append(Minecraft client,Map<String,Object> data){
        data.put("loader","neoforge");data.put("nativeMaidRenderer",true);
        List<Map<String,Object>> rows=new ArrayList<>();
        for(var entity:client.level.entitiesForRendering()){
            if(!(entity instanceof EntityMaid maid))continue;
            if(rows.size()>=64)break;
            var selection=YsmAccess.selection(maid);boolean ysm=selection!=null&&selection.model()!=null;
            String model=ysm?selection.model():maid.getModelId();
            boolean loaded=ysm?YsmAccess.hasModel(model):com.github.tartaricacid.touhoulittlemaid.client.resource.CustomPackLoader.MAID_MODELS.getModel(model).isPresent();
            rows.add(Map.of("uuid",maid.getUUID().toString(),"entityId",maid.getId(),"type",BuiltInRegistries.ENTITY_TYPE.getKey(maid.getType()).toString(),
                "model",model,"maidModel",maid.getModelId(),"modelLoaded",loaded,"renderKind",ysm?"ysm":"native_maid",
                "renderer",client.getEntityRenderDispatcher().getRenderer(maid).getClass().getName()));
        }
        data.put("maids",rows);
    }
    public static void appendEntity(Entity entity,JsonObject row){
        if(entity instanceof EntityMaid maid){row.addProperty("maidModel",maid.getModelId());row.addProperty("nativeEntity",true);}
    }
}
