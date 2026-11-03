package org.afuhome.agentfriend.tests;

import com.google.gson.Gson;
import io.vortexcore.VortexCorePlugin;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Console-only real-server fixture. Requires its own marked loopback world. */
public final class TravelCliProbe extends JavaPlugin {
    private final Gson json=new Gson();
    private Map<String,Object> coldProbe=Map.of("phase","none");
    @Override public void onEnable(){
        try {
            if(!Bukkit.getIp().equals("127.0.0.1")||!Set.of(25988,25990).contains(Bukkit.getPort())
                    ||!Files.readString(Path.of(".travel-cli-qa")).equals("TRAVEL_CLI_QA_ONLY"))
                throw new IllegalStateException("Isolated travel fixture only");
        } catch(java.io.IOException error){throw new IllegalStateException(error);}
        getServer().getCommandMap().register("travelfixture",new Command("travelqa"){
            @Override public boolean execute(CommandSender sender,String label,String[] args){
                if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender)||args.length<2||!args[1].matches("ag_TC[AB]"))return false;
                Player p=Bukkit.getPlayerExact(args[1]);if(p==null)throw new IllegalStateException("Own fixture actor offline");
                try{run(sender,p,args);}catch(Exception error){throw new IllegalStateException(error);}return true;
            }
        });
    }
    private VortexCorePlugin vortex(){return (VortexCorePlugin)Bukkit.getPluginManager().getPlugin("VortexRPG");}
    private void platform(World world,int x,int y,int z){
        for(int dx=-4;dx<=4;dx++)for(int dz=-4;dz<=4;dz++)for(int dy=-1;dy<=3;dy++)
            world.getBlockAt(x+dx,y+dy,z+dz).setType(dy==-1?Material.STONE:Material.AIR,false);
    }
    private void run(CommandSender sender,Player p,String[] args)throws Exception{
        if(vortex().playerProfileService().qiandengjiLoading(p.getUniqueId())){sender.sendMessage("TRAVEL_QA {\"loading\":true}");return;}
        World world=Bukkit.getWorld("world");
        switch(args[0]){
            case "setup"->{
                platform(world,48,81,48);platform(world,204,81,204);platform(world,1096,91,232);platform(world,-425,81,677);
                world.setGameRule(GameRule.DO_MOB_SPAWNING,false);world.setGameRule(GameRule.DO_DAYLIGHT_CYCLE,false);
                world.setTime(6000);world.save();p.setGameMode(GameMode.SURVIVAL);p.teleport(new Location(world,48.5,81,48.5));
                ((com.earth2me.essentials.Essentials)Bukkit.getPluginManager().getPlugin("Essentials")).getWarps()
                    .setWarp("village",new Location(world,48.5,81,48.5));
                vortex().qiandengjiMana().setMana(p.getUniqueId(),vortex().qiandengjiMana().getMaxMana(p));
            }
            case "origin"->{p.teleport(new Location(world,48.5,81,48.5));vortex().qiandengjiMana().setMana(p.getUniqueId(),vortex().qiandengjiMana().getMaxMana(p));}
            case "waypoint"->{p.teleport(new Location(world,204.5,81,204.5));vortex().qiandengjiMana().setMana(p.getUniqueId(),vortex().qiandengjiMana().getMaxMana(p));}
            case "mana"->vortex().qiandengjiMana().setMana(p.getUniqueId(),Integer.parseInt(args[2]));
            case "block"->world.getBlockAt(204,82,204).setType(args[2].equals("yes")?Material.STONE:Material.AIR,false);
            case "cold","unload"->{
                int x=Integer.parseInt(args[2]),z=Integer.parseInt(args[3]);
                if(!world.getPlayers().stream().allMatch(who->Math.abs(who.getLocation().getChunk().getX()-x)>4||Math.abs(who.getLocation().getChunk().getZ()-z)>4))throw new IllegalStateException("Actor too close to cold chunk");
                if(!world.getPluginChunkTickets(x,z).isEmpty()||world.isChunkForceLoaded(x,z))throw new IllegalStateException("Owned test chunk still held");
                boolean unloaded=!world.isChunkLoaded(x,z)||world.unloadChunk(x,z,true);
                if(args[0].equals("unload")){coldProbe=Map.of("phase","complete","unloaded",!world.isChunkLoaded(x,z));break;}
                if(!unloaded||world.isChunkLoaded(x,z))throw new IllegalStateException("Could not unload own fixture chunk");
                coldProbe=Map.of("phase","pending","chunkX",x,"chunkZ",z);
                long began=System.nanoTime();
                world.getChunkAtAsync(x,z,false).whenComplete((chunk,error)->{
                    Map<String,Object> result=new LinkedHashMap<>();result.put("phase","complete");result.put("returnedNull",chunk==null);
                    result.put("error",error==null?"":error.getClass().getSimpleName());result.put("elapsedMs",(System.nanoTime()-began)/1e6);coldProbe=result;
                });
            }
            case "status"->{}
            default->throw new IllegalArgumentException("Unknown fixture operation");
        }
        Map<String,Object> state=new LinkedHashMap<>();state.put("mana",vortex().qiandengjiMana().getMana(p.getUniqueId()));
        state.put("position",List.of(p.getWorld().getName(),p.getLocation().getX(),p.getLocation().getY(),p.getLocation().getZ()));
        state.put("op",p.isOp());state.put("coldProbe",coldProbe);sender.sendMessage("TRAVEL_QA "+json.toJson(state));
    }
}
