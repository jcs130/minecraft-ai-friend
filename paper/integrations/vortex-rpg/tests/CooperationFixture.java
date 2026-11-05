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
    private Map<String,Object> identity;
    @Override public void onEnable(){
        try{if(!getServer().getIp().equals("127.0.0.1")||getServer().getPort()!=29397
            ||!Files.readString(Path.of(".communication-qa")).strip().equals("127.0.0.1:29397 20261030"))throw new IllegalStateException("Own marked loopback only");}
        catch(java.io.IOException error){throw new IllegalStateException(error);}
        // Optional v2 identity is captured at enable time, never reconstructed after a JAR swap.
        // This describes staging inputs, not byte equality of Paper's remapped classes.
        if(Files.isRegularFile(Path.of(".party4-artifacts.json")))try{identity=captureIdentity();}
        catch(Exception error){throw new IllegalStateException("Invalid party4 stage lock",error);}
        getServer().getCommandMap().register("cooperationfixture",new Command("coopqa"){
            @Override public boolean execute(CommandSender sender,String label,String[]args){
                if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return false;
                if(args.length==1&&args[0].equals("identify")){
                    if(identity==null)throw new IllegalStateException("Party4 v2 lock was not present at startup");
                    var current=new LinkedHashMap<>(identity);
                    current.put("normalWorlds",Bukkit.getWorlds().stream().filter(w->w.getEnvironment()==World.Environment.NORMAL).count());
                    sender.sendMessage("COOP_QA_ID "+gson.toJson(current));return true;
                }
                if(args.length<2||!args[1].matches("ag_CP[a-z0-9]{3,10}"))throw new IllegalArgumentException("Own QA actor only");
                var p=Bukkit.getPlayerExact(args[1]);if(p==null)throw new IllegalStateException("Own QA actor offline");
                try{run(sender,p,args);}catch(Exception e){throw new IllegalStateException(e);}return true;
            }});
    }
    private Map<String,Object> captureIdentity()throws Exception{
        Path root=Path.of(".").toRealPath();
        var lock=JsonParser.parseString(Files.readString(root.resolve(".party4-artifacts.json"))).getAsJsonObject();
        if(!lock.get("schema").getAsString().equals("party4-stage-lock/v1"))throw new IllegalArgumentException("Unknown lock schema");
        var artifacts=new LinkedHashMap<String,String>();var loaded=new LinkedHashMap<String,Object>();
        for(var item:Map.of("native","VortexRPG","bridge","QiandengjiRpg","friend","AgentFriend","fixture",getName()).entrySet()){
            var plugin=Bukkit.getPluginManager().getPlugin(item.getValue());
            if(plugin==null)throw new IllegalStateException("Missing stage plugin");
            Path source=Path.of(plugin.getClass().getProtectionDomain().getCodeSource().getLocation().toURI()).toRealPath();
            if(!source.startsWith(root.resolve("plugins")))throw new IllegalStateException("Plugin loaded outside stage");
            Path input=root.resolve(lock.getAsJsonObject("artifacts").getAsJsonObject(item.getKey()).get("file").getAsString()).normalize();
            if(!input.startsWith(root.resolve("plugins"))||!input.toRealPath().equals(input))throw new IllegalStateException("Invalid artifact input");
            if(!source.getFileName().equals(input.getFileName()))throw new IllegalStateException("Loaded plugin differs from locked input");
            artifacts.put(item.getKey(),java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(input))));
            loaded.put(item.getKey(),Map.of("version",plugin.getDescription().getVersion(),"file",root.relativize(source).toString().replace('\\','/'),
                "sha256",java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(source)))));
        }
        return Map.of("protocol","party4-fixture/v2","root",root.toString().replace('\\','/'),"port",getServer().getPort(),
            "artifactObservation","stage-inputs-at-fixture-enable","artifactSha256",artifacts,"loadedArtifacts",loaded);
    }
    private VortexCorePlugin vortex(){return (VortexCorePlugin)Bukkit.getPluginManager().getPlugin("VortexRPG");}
    private JavaPlugin friend(){return (JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");}
    private void run(CommandSender sender,Player p,String[]args)throws Exception{
        if(vortex().playerProfileService().qiandengjiLoading(p.getUniqueId())){sender.sendMessage("COOP_QA loading");return;}
        String action=args[0];World w=Bukkit.getWorld("world");
        if(action.equals("setup")){
            for(int x=297;x<=345;x++)for(int z=90;z<=106;z++)for(int y=114;y<=145;y++)w.getBlockAt(x,y,z).setType(y<=125?Material.STONE:Material.AIR,false);
            p.setGameMode(GameMode.SURVIVAL);p.setOp(false);p.setCollidable(false);p.setFoodLevel(20);p.setHealth(p.getMaxHealth());
            p.teleport(new Location(w,305.5,126,98.5,-90,0));vortex().qiandengjiMana().setMana(p.getUniqueId(),vortex().qiandengjiMana().getMaxMana(p));
            var field=friend().getClass().getDeclaredField("teamTeleportAt");field.setAccessible(true);((Map<?,?>)field.get(friend())).remove(p.getUniqueId());
        }else if(action.equals("boundary48")||action.equals("beyond48")){
            // A safe floor at the actual 48m routing boundary, for our QA body only.
            if(args.length!=3||!args[2].matches("ag_CP[a-z0-9]{3,10}"))throw new IllegalArgumentException("Own QA reference required");
            var reference=Bukkit.getPlayerExact(args[2]);if(reference==null||reference.getWorld()!=w)throw new IllegalArgumentException("Own QA reference unavailable");
            var target=reference.getLocation().clone().add(action.equals("boundary48")?48:48.25,0,0);
            if(target.getBlockX()<296||target.getBlockX()>400||target.getBlockZ()<89||target.getBlockZ()>107||target.getBlockY()!=126)
                throw new IllegalArgumentException("Outside own fixture terrain");
            for(int x=target.getBlockX()-1;x<=target.getBlockX()+1;x++)for(int z=target.getBlockZ()-1;z<=target.getBlockZ()+1;z++)for(int y=125;y<=128;y++)
                w.getBlockAt(x,y,z).setType(y==125?Material.STONE:Material.AIR,false);
            p.teleport(target);
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
