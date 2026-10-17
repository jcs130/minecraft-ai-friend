package org.afuhome.agentfriend.qa;

import com.google.gson.JsonObject;
import java.util.Set;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Console-only test fixture. Never package this helper with the production plugin. */
public final class QuestGuidanceProbe extends JavaPlugin {
    public void onEnable() {
        if(Bukkit.getPort()!=25830||!Bukkit.getIp().equals("127.0.0.1")||!Bukkit.getMotd().equals("RPG_QUEST_GUIDANCE_ISOLATED_20261017"))throw new IllegalStateException("Isolated QA only");
    }
    private static Object call(Object owner,String name,Class<?>[] types,Object... args)throws Exception{var method=owner.getClass().getDeclaredMethod(name,types);method.setAccessible(true);return method.invoke(owner,args);}
    public boolean onCommand(CommandSender sender,Command command,String label,String[] args) {
        if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender)||args.length!=1)return false;
        try {
            JavaPlugin af=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");
            Player p=Bukkit.getPlayerExact("ag_RpgQA17");if(p==null)throw new IllegalStateException("QA actor offline");
            Object market=call(af,"taskMarket",new Class<?>[0]);
            if(args[0].equals("home")||args[0].equals("surface")||args[0].equals("inside")) {
                World w=Bukkit.getWorld("world");boolean home=args[0].equals("home"),surface=args[0].equals("surface");
                int minX=home?-706:-430,maxX=home?-694:-420,minZ=home?-706:674,maxZ=home?-694:680,y=home?68:4;
                if(!surface)for(int x=minX;x<=maxX;x++)for(int z=minZ;z<=maxZ;z++){w.getBlockAt(x,y-1,z).setType(Material.STONE,false);for(int dy=0;dy<=2;dy++)w.getBlockAt(x,y+dy,z).setType(Material.AIR,false);}
                p.setGameMode(GameMode.SURVIVAL);p.setFlying(false);p.setAllowFlight(false);
                p.teleport(new Location(w,home?-700.5:-425.5,surface?68:y,home?-700.5:677.5));
                p.setFoodLevel(20);p.setHealth(Math.min(20,p.getMaxHealth()));
                sender.sendMessage("QA_RPG_MOVED "+args[0]);
            } else if(args[0].equals("attach")||args[0].equals("detach")) {
                Player eye=Bukkit.getPlayerExact("ag_RpgQA17_eye");if(eye==null)throw new IllegalStateException("Eye offline");
                eye.setGameMode(GameMode.SPECTATOR);eye.setSpectatorTarget(null);
                if(args[0].equals("attach")){eye.teleport(p.getLocation());eye.setSpectatorTarget(p);}
                sender.sendMessage("QA_RPG_EYE "+args[0]);
            } else if(args[0].equals("readonly")) {
                String before=af.getConfig().saveToString();int chunks=p.getWorld().getLoadedChunks().length;
                for(int n=0;n<4;n++) {
                    call(market,"progressState",new Class<?>[]{Player.class},p);
                    call(market,"mapInfo",new Class<?>[]{Player.class},p);
                    Object guild=call(af,"guild",new Class<?>[0]);call(guild,"progressState",new Class<?>[]{Player.class},p);
                }
                if(!before.equals(af.getConfig().saveToString())||chunks!=p.getWorld().getLoadedChunks().length)throw new IllegalStateException("Query wrote evidence or loaded chunks");
                sender.sendMessage("QA_RPG_READONLY_OK");
            } else if(args[0].equals("status")) {
                JsonObject result=(JsonObject)call(market,"progressState",new Class<?>[]{Player.class},p);
                result.addProperty("playerY",p.getLocation().getY());
                sender.sendMessage("QA_RPG "+result);
            } else throw new IllegalArgumentException("home/surface/inside/attach/detach/readonly/status");
        }catch(Exception e){sender.sendMessage("QA_RPG_ERROR "+e);getLogger().log(java.util.logging.Level.SEVERE,"QA failed",e);}
        return true;
    }
}
