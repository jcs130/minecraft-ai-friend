package org.qiandengji.vortex.tests;

import com.google.gson.*;
import io.vortexcore.VortexCorePlugin;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Own actors and terrain on a marked loopback server only. Never install in production. */
public final class CooperationFixture extends JavaPlugin {
    private final Gson gson=new Gson();
    @Override public void onEnable(){
        try{if(!getServer().getIp().equals("127.0.0.1")||getServer().getPort()!=29397
            ||!Files.readString(Path.of(".communication-qa")).strip().equals("127.0.0.1:29397 20261030"))throw new IllegalStateException("Own marked loopback only");}
        catch(java.io.IOException error){throw new IllegalStateException(error);}
        getServer().getCommandMap().register("cooperationfixture",new Command("coopqa"){
            @Override public boolean execute(CommandSender sender,String label,String[]args){
                if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return false;
                if(args.length<2||!args[1].matches("ag_CP[a-z0-9]{3,10}"))throw new IllegalArgumentException("Own QA actor only");
                var p=Bukkit.getPlayerExact(args[1]);if(p==null)throw new IllegalStateException("Own QA actor offline");
                try{run(sender,p,args);}catch(Exception e){throw new IllegalStateException(e);}return true;
            }});
    }
    private VortexCorePlugin vortex(){return (VortexCorePlugin)Bukkit.getPluginManager().getPlugin("VortexRPG");}
    private JavaPlugin friend(){return (JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");}
    private void run(CommandSender sender,Player p,String[]args)throws Exception{
        if(vortex().playerProfileService().qiandengjiLoading(p.getUniqueId())){sender.sendMessage("COOP_QA loading");return;}
        String action=args[0];World w=Bukkit.getWorld("world");
        if(action.equals("setup")){
            for(int x=297;x<=345;x++)for(int z=90;z<=106;z++)for(int y=114;y<=145;y++)w.getBlockAt(x,y,z).setType(y<=125?Material.STONE:Material.AIR,false);
            p.setGameMode(GameMode.SURVIVAL);p.setOp(false);p.setFoodLevel(20);p.setHealth(p.getMaxHealth());
            p.teleport(new Location(w,305.5,126,98.5,-90,0));vortex().qiandengjiMana().setMana(p.getUniqueId(),vortex().qiandengjiMana().getMaxMana(p));
            var field=friend().getClass().getDeclaredField("teamTeleportAt");field.setAccessible(true);((Map<?,?>)field.get(friend())).remove(p.getUniqueId());
        }else if(action.equals("far"))p.teleport(new Location(w,330.5,126,98.5,-90,0));
        else if(action.equals("otherworld")){
            var other=Bukkit.getWorlds().stream().filter(v->v!=w&&v.getEnvironment()==World.Environment.NORMAL).findFirst().orElseThrow();
            other.getBlockAt(305,125,98).setType(Material.STONE,false);other.getBlockAt(305,126,98).setType(Material.AIR,false);other.getBlockAt(305,127,98).setType(Material.AIR,false);
            p.teleport(new Location(other,305.5,126,98.5));
        }else if(action.equals("peak")){
            String kind=args[2];if(!Set.of("pillar","thin_roof","mountain").contains(kind))throw new IllegalArgumentException("Own terrain case");
            for(int x=297;x<=313;x++)for(int z=90;z<=106;z++)for(int y=110;y<w.getMaxHeight();y++){
                boolean stone=kind.equals("mountain")&&y<=125||kind.equals("thin_roof")&&y==125||kind.equals("pillar")&&x>=305&&x<=307&&z==98&&y<=125;
                w.getBlockAt(x,y,z).setType(stone?Material.STONE:Material.AIR,false);
            }
            String base="guild-players."+p.getUniqueId()+".active";
            friend().getConfig().set(base+".id","high_peak");friend().getConfig().set(base+".progress",0);
            friend().getConfig().set(base+".accepted",java.time.LocalDate.now().toString());
            p.teleport(new Location(w,305.5,126,98.5,-90,0));p.setFallDistance(0);
        }else if(!action.equals("state"))throw new IllegalArgumentException("Unknown fixture action");
        var result=new LinkedHashMap<String,Object>();result.put("world",p.getWorld().getKey().toString());
        result.put("position",List.of(p.getLocation().getX(),p.getLocation().getY(),p.getLocation().getZ()));
        result.put("mana",vortex().qiandengjiMana().getMana(p.getUniqueId()));result.put("op",p.isOp());
        result.put("partyPermission",p.hasPermission("vortex.player.party.create"));
        result.put("party",JsonParser.parseString((String)Bukkit.getPluginManager().getPlugin("QiandengjiRpg").getClass().getMethod("partyState",Player.class).invoke(Bukkit.getPluginManager().getPlugin("QiandengjiRpg"),p)));
        result.put("peakProgress",friend().getConfig().getInt("guild-players."+p.getUniqueId()+".active.progress",0));
        var type=friend().getClass().getClassLoader().loadClass("org.afuhome.agentfriend.PeakSurvey");
        var method=type.getDeclaredMethod("inspect",Location.class);method.setAccessible(true);Object sample=method.invoke(null,p.getLocation());
        var json=sample.getClass().getDeclaredMethod("json");json.setAccessible(true);result.put("terrain",json.invoke(sample));
        sender.sendMessage("COOP_QA "+gson.toJson(result));
    }
}
