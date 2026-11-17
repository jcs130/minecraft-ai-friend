package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.*;
import java.util.*;

final class ResidentServices {
    static Map<String,Object> catalogue(){return Map.of("actor","own_resident_uuid_inventory_mana","commandPrefix","mycli",
        "available",ResidentCliContract.available(),"queryOnly",ResidentCliContract.readOnly(),
        "entrance",ResidentCliContract.describe("arena entrance"),
        "rewardCollection","arena stash collect materializes the existing reward queue into your own personal box; then list/take. Near the chest is free; remote successful transfers cost the same 2 mana.",
        "notYetAdapted","Other player CLI commands are not advertised as NPC capabilities. No operator fallback.",
        "book","Digital archive is public; a physical copy consumes an owned blank writable book. No item is fabricated.",
        "photo","Real existing camera pipeline, 2 mana at capture, actual maps enter this NPC's personal reward box; query receipt, do not repeat.");}
    static Map<String,Object> execute(EntityMaid maid,UUID request,String command)throws Exception {
        return call(maid.getUUID(),request,command);
    }
    static Map<String,Object> query(UUID maid,UUID request)throws Exception{return call(maid,request,null);}
    static void acknowledgeUnknown(UUID maid,UUID request,String note)throws Exception {
        var bukkit=Class.forName("org.bukkit.Bukkit");var manager=bukkit.getMethod("getPluginManager").invoke(null);
        var plugin=Class.forName("org.bukkit.plugin.PluginManager").getMethod("getPlugin",String.class).invoke(manager,"AgentFriend");
        if(plugin==null)throw new IllegalArgumentException("cli_service_unavailable");
        plugin.getClass().getClassLoader().loadClass("org.afuhome.agentfriend.ResidentCli").getMethod("acknowledgeUnknown",UUID.class,UUID.class,String.class).invoke(null,maid,request,note);
    }
    private static Map<String,Object> call(UUID maid,UUID request,String command)throws Exception {
        var bukkit=Class.forName("org.bukkit.Bukkit");var pm=bukkit.getMethod("getPluginManager").invoke(null);
        var plugin=Class.forName("org.bukkit.plugin.PluginManager").getMethod("getPlugin",String.class).invoke(pm,"AgentFriend");
        if(plugin==null)throw new IllegalArgumentException("cli_service_unavailable");
        var service=plugin.getClass().getClassLoader().loadClass("org.afuhome.agentfriend.ResidentCli");
        String raw=(String)service.getMethod("query",UUID.class,UUID.class).invoke(null,maid,request);
        var reply=JsonParser.parseString(raw).getAsJsonObject();
        if(command!=null&&reply.get("status").getAsString().equals("not_found")) {
            try{raw=(String)service.getMethod("run",UUID.class,UUID.class,String.class).invoke(null,maid,request,command);}
            catch(java.lang.reflect.InvocationTargetException e){if(e.getCause() instanceof IllegalArgumentException invalid)throw invalid;throw e;}
        }
        @SuppressWarnings("unchecked") Map<String,Object> row=new Gson().fromJson(raw,Map.class);return row;
    }
}
