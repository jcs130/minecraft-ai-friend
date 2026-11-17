package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonParser;
import com.mojang.authlib.GameProfile;
import java.util.Map;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.GameType;
import net.neoforged.neoforge.common.util.FakePlayerFactory;

/** The NPC's own UUID is the land principal. Neither its creator nor its party leader is impersonated. */
public final class ResidentProtection {
    public static boolean registered(EntityMaid maid) {
        var residents=MaidAgentsMod.residents();return residents!=null&&residents.role(maid.getUUID())!=null;
    }
    static boolean combat(EntityMaid maid,net.minecraft.world.entity.LivingEntity target){
        Class<?> bukkit;try{bukkit=Class.forName("org.bukkit.Bukkit");}catch(ClassNotFoundException stock){return true;}
        try{
            var manager=bukkit.getMethod("getPluginManager").invoke(null);
            var plugin=Class.forName("org.bukkit.plugin.PluginManager").getMethod("getPlugin",String.class).invoke(manager,"AgentFriend");if(plugin==null)return false;
            var access=plugin.getClass().getClassLoader().loadClass("org.afuhome.agentfriend.ResidentCli");
            return Boolean.TRUE.equals(access.getMethod("mayTarget",java.util.UUID.class,java.util.UUID.class).invoke(null,maid.getUUID(),target.getUUID()));
        }catch(ReflectiveOperationException|LinkageError|RuntimeException unavailable){return false;}
    }
    static boolean travel(EntityMaid maid,ServerLevel level,BlockPos at){
        Class<?> bukkit;try{bukkit=Class.forName("org.bukkit.Bukkit");}catch(ClassNotFoundException stock){return true;}
        try{
            var manager=bukkit.getMethod("getPluginManager").invoke(null);
            var plugin=Class.forName("org.bukkit.plugin.PluginManager").getMethod("getPlugin",String.class).invoke(manager,"AgentFriend");if(plugin==null)return false;
            var world=level.getClass().getMethod("getWorld").invoke(level);
            var worldId=(java.util.UUID)Class.forName("org.bukkit.World").getMethod("getUID").invoke(world);
            var access=plugin.getClass().getClassLoader().loadClass("org.afuhome.agentfriend.ResidentTravelAccess");
            return Boolean.TRUE.equals(access.getMethod("allowed",java.util.UUID.class,java.util.UUID.class,double.class,double.class,double.class).invoke(null,maid.getUUID(),worldId,at.getX()+.5,(double)at.getY(),at.getZ()+.5));
        }catch(ReflectiveOperationException|LinkageError|RuntimeException unavailable){return false;}
    }
    public static boolean nativeAllowed(EntityMaid maid,String action,BlockPos pos) {
        if(!registered(maid)&&!MaidAgentsMod.managed(maid)&&!maid.getPersistentData().getBoolean("tlm_resident_home_installed"))return true;
        return "allow_likely".equals(query(maid,action,pos).get("status"));
    }
    static Map<String,Object> query(EntityMaid maid,String action,BlockPos pos) {return query(maid,(ServerLevel)maid.level(),action,pos);}
    static Map<String,Object> query(EntityMaid maid,ServerLevel level,String action,BlockPos pos) {
        if(!java.util.Set.of("break","place","container","use").contains(action))throw new IllegalArgumentException("invalid_protection_action");
        Class<?> bukkit;
        try {bukkit=Class.forName("org.bukkit.Bukkit");}
        catch(ClassNotFoundException stock){return Map.of("status","allow_likely","reason","native_events_still_authoritative","principal",maid.getStringUUID());}
        try {
            Object manager=bukkit.getMethod("getPluginManager").invoke(null);
            var managerType=Class.forName("org.bukkit.plugin.PluginManager");
            Object plugin=managerType.getMethod("getPlugin",String.class).invoke(manager,"AgentFriend");
            if(plugin==null)return Map.of("status","unknown","reason","hybrid_protection_adapter_missing");
            var actor=FakePlayerFactory.get(level,new GameProfile(maid.getUUID(),"npc_"+maid.getStringUUID().substring(0,8)));
            actor.setPos(net.minecraft.world.phys.Vec3.atBottomCenterOf(pos));actor.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
            Object player=actor.getClass().getMethod("getBukkitEntity").invoke(actor);
            var method=plugin.getClass().getMethod("residentProtection",Class.forName("org.bukkit.entity.Player"),String.class,int.class,int.class,int.class);
            String response=(String)method.invoke(plugin,player,action,pos.getX(),pos.getY(),pos.getZ());
            @SuppressWarnings("unchecked") Map<String,Object> row=new com.google.gson.Gson().fromJson(JsonParser.parseString(response),Map.class);
            return row;
        } catch(ReflectiveOperationException|LinkageError|RuntimeException unavailable){return Map.of("status","unknown","reason","hybrid_protection_unavailable");}
    }
    static void require(EntityMaid maid,String action,BlockPos pos) {
        var row=query(maid,action,pos);
        if(!"allow_likely".equals(row.get("status")))throw new IllegalArgumentException("protection_"+row.get("status")+":"+row.get("reason"));
    }
}
