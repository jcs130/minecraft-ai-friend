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
            rows.add(Map.of("uuid",maid.getUUID().toString(),"type",BuiltInRegistries.ENTITY_TYPE.getKey(maid.getType()).toString(),
                "model",maid.getModelId(),"renderer",client.getEntityRenderDispatcher().getRenderer(maid).getClass().getName()));
        }
        data.put("maids",rows);
    }
    public static void appendEntity(Entity entity,JsonObject row){
        if(entity instanceof EntityMaid maid){row.addProperty("maidModel",maid.getModelId());row.addProperty("nativeEntity",true);}
    }
}
