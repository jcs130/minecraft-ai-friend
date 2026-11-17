package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.Gson;
import java.util.*;

/** Optional in-process Vortex ABI. When selected, unavailable is never replaced by a second mana pool. */
final class ResidentVortex {
    private static Object backend(){
        try{var b=Class.forName("org.bukkit.Bukkit");var pm=b.getMethod("getPluginManager").invoke(null);
            return Class.forName("org.bukkit.plugin.PluginManager").getMethod("getPlugin",String.class).invoke(pm,"QiandengjiRpg");
        }catch(ClassNotFoundException stock){return null;}catch(ReflectiveOperationException e){throw new IllegalStateException("vortex_lookup_failed",e);}
    }
    static boolean selected(){return backend()!=null;}
    static Object call(String method,Class<?>[] types,Object...args){
        try{var plugin=backend();if(plugin==null)throw new IllegalStateException("vortex_missing");return plugin.getClass().getMethod(method,types).invoke(plugin,args);}
        catch(ReflectiveOperationException e){throw new IllegalStateException("vortex_native_adapter_unavailable",e);}
    }
    static String role(String legacy){return switch(legacy){case "guardian"->"knight";case "healer"->"cleric";case "artisan"->"engineer";case "farmer"->"";default->legacy;};}
    static void tick(EntityMaid maid,String profession){call("residentTick",new Class[]{UUID.class,String.class},maid.getUUID(),role(profession));}
    @SuppressWarnings("unchecked") static Map<String,Object> observe(UUID id){
        try{return new Gson().fromJson((String)call("residentState",new Class[]{UUID.class},id),Map.class);}
        catch(RuntimeException unavailable){return Map.of("available",false,"backend","vortex","reason","native_adapter_unavailable","abilities",List.of(),"skills",List.of());}
    }
    static boolean mana(UUID id,double amount,boolean spend){return Boolean.TRUE.equals(call("residentMana",new Class[]{UUID.class,double.class,boolean.class},id,amount,spend));}
    static boolean refill(UUID id){return Boolean.TRUE.equals(call("residentRefill",new Class[]{UUID.class},id));}
    static void xp(UUID id,long amount){call("residentExperience",new Class[]{UUID.class,long.class},id,amount);}
    static Map<String,Object> cast(EntityMaid maid,UUID request,String skill){
        if(!skill.matches("[a-z0-9_]{1,48}"))throw new IllegalArgumentException("invalid_skill_id");
        try{return ResidentServices.execute(maid,request,"cast "+skill);}
        catch(IllegalArgumentException denied){throw denied;}catch(Exception error){return Map.of("status","unknown","completed",false,"requestId",request.toString(),"reason","native_cast_query_original_request");}
    }
    static Map<String,Object> reflex(EntityMaid maid,boolean fighting){
        var data=maid.getPersistentData();String key="tlm_resident_reflex_cast";
        try{
            String pending=data.getString(key);
            if(!pending.isBlank()){
                var result=ResidentServices.query(maid.getUUID(),UUID.fromString(pending));
                if(List.of("completed","blocked","rejected").contains(result.get("status")))data.remove(key);
                return result;
            }
            String spell=(String)call("residentReflex",new Class[]{UUID.class,boolean.class},maid.getUUID(),fighting);
            if(spell.isBlank())return Map.of();
            UUID request=UUID.randomUUID();data.putString(key,request.toString());var result=cast(maid,request,spell);
            if(List.of("completed","blocked","rejected").contains(result.get("status")))data.remove(key);
            return result;
        }catch(IllegalArgumentException refusal){data.remove(key);return Map.of("status","blocked","completed",false,"reason",refusal.getMessage());}
        catch(Exception unavailable){return Map.of("status","unknown","completed",false,"reason","native_reflex_read_original_request","requestId",data.getString(key));}
    }
}
