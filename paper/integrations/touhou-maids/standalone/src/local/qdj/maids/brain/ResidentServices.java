package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.*;
import java.util.*;

final class ResidentServices {
    static Map<String,Object> catalogue(){return Map.of("actor","own_resident_uuid_inventory_mana","commandPrefix","mycli",
        "available",List.of("status","land here","land list [page]","land info <ID>","land members <ID> [page]","land trust <ID> <player-or-resident UUID>","land untrust <ID> <player-or-resident UUID>","archive status","archive list book --page 1","archive info <UUID>","archive read <UUID> --page 1","archive create <书名>|<正文>","archive restore <UUID>",
            "guild join","guild board [page]","guild status","guild accept <ID>","guild verify","guild claim","guild abandon",
            "tasks list","tasks info <ID>","tasks status","arena status","arena entrance","arena start","arena leave","arena recycle list","arena recycle quote bag <slot> <count>","arena recycle sell <quoteId>","arena shop list [all|supplies|daily|food] [page]","arena wallet","arena shop buy <offerId>","arena stash summary","arena stash inventory","arena stash list <page 1-10>","arena stash take <stashSlot 1-540> <count 1-64>","arena stash putslot <nativeBagSlot 0-based> <count 1-64>",
            "arena stash collect","dungeon list --page 1","dungeon info <ID>","dungeon status [ID]","dungeon travel <ID>","dungeon start <ID> [normal|adventure|apocalypse]","dungeon join <ID>","dungeon resume","dungeon leave","dungeon claim [ID]",
            "photo status","photo take <名字> third 1 --story <经历>","photo album","photo info <名字>","photo exhibit <名字>"),
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
