package org.qiandengji.vortex.tests;

import com.earth2me.essentials.Essentials;
import com.google.gson.Gson;
import io.vortexcore.VortexCorePlugin;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.data.Waterlogged;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** Own actors/terrain and village warp on the marked loopback test server only. */
public final class HomeReturnFixture extends JavaPlugin implements Listener {
    private final Gson gson=new Gson();
    private Location oldWarp;
    private String behavior="";
    private UUID actor;
    private boolean restoreWarp;
    private Location anchor(){return new Location(Bukkit.getWorld("world"),305.5,126,98.5,45,0);}
    private VortexCorePlugin vortex(){return (VortexCorePlugin)Bukkit.getPluginManager().getPlugin("VortexRPG");}
    private Essentials essentials(){return (Essentials)Bukkit.getPluginManager().getPlugin("Essentials");}
    private JavaPlugin friend(){return (JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");}
    @Override public void onEnable(){
        try{
            if(!getServer().getIp().equals("127.0.0.1")||getServer().getPort()!=29397
                ||!Files.readString(Path.of(".communication-qa")).strip().equals("127.0.0.1:29397 20261030"))throw new IllegalStateException("Marked loopback only");
            try{oldWarp=essentials().getWarps().getWarp("village");}catch(Exception absent){}
            restoreWarp=true;
        }catch(java.io.IOException error){throw new IllegalStateException(error);}
        Bukkit.getPluginManager().registerEvents(this,this);
        getServer().getCommandMap().register("homereturnfixture",new Command("homeqa"){
            @Override public boolean execute(CommandSender sender,String label,String[]args){
                if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return false;
                if(args.length<2||!args[1].matches("ag_HM[a-z0-9]{3,10}"))throw new IllegalArgumentException("Own actor only");
                Player p=Bukkit.getPlayerExact(args[1]);if(p==null)throw new IllegalStateException("Own actor offline");
                try{run(sender,p,args);}catch(Exception e){throw new IllegalStateException(e);}return true;
            }});
    }
    @Override public void onDisable(){
        if(!restoreWarp)return;
        try{if(oldWarp==null)essentials().getWarps().removeWarp("village");else essentials().getWarps().setWarp("village",oldWarp);}
        catch(Exception error){getLogger().severe("QA warp restore failed: "+error.getClass().getSimpleName());}
    }
    @EventHandler(priority=EventPriority.LOW,ignoreCancelled=true)
    public void interfere(PlayerTeleportEvent event){
        if(!event.getPlayer().getUniqueId().equals(actor)||behavior.isEmpty()||behavior.equals("late_redirect"))return;
        String action=behavior;behavior="";
        if(action.equals("cancel")){event.setCancelled(true);return;}
        if(action.equals("bad_redirect"))event.setTo(anchor());
        else if(action.equals("safe_redirect"))event.setTo(anchor().add(1,0,0));
        else if(action.equals("far_redirect"))event.setTo(anchor().add(8,0,0));
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void lateInterference(PlayerTeleportEvent event){
        if(!event.getPlayer().getUniqueId().equals(actor)||!behavior.equals("late_redirect"))return;
        behavior="";event.setTo(anchor());
    }
    private void run(CommandSender sender,Player p,String[]args)throws Exception{
        if(vortex().playerProfileService().qiandengjiLoading(p.getUniqueId())){sender.sendMessage("HOME_QA loading");return;}
        String action=args[0];World w=anchor().getWorld();
        if(action.equals("setup")){
            behavior="";actor=p.getUniqueId();String kind=args[2];
            if(!Set.of("clear","blocked","sealed","hazard","slab","waterlogged","fence").contains(kind))throw new IllegalArgumentException("Own terrain cases only");
            for(int x=300;x<=323;x++)for(int z=93;z<=104;z++)for(int y=122;y<=131;y++)w.getBlockAt(x,y,z).setType(y<=125?Material.STONE:Material.AIR,false);
            if(kind.equals("blocked"))w.getBlockAt(305,126,98).setType(Material.OAK_PLANKS,false);
            if(kind.equals("sealed"))for(int x=302;x<=308;x++)for(int z=95;z<=101;z++)for(int y=123;y<=130;y++)w.getBlockAt(x,y,z).setType(Material.OAK_PLANKS,false);
            if(Set.of("hazard","slab","waterlogged","fence").contains(kind))for(int x=302;x<=308;x++)for(int z=95;z<=101;z++){
                var b=w.getBlockAt(x,125, z);b.setType(kind.equals("hazard")?Material.MAGMA_BLOCK:kind.equals("fence")?Material.OAK_FENCE:Material.OAK_SLAB,false);
                if(kind.equals("waterlogged")){var data=(Waterlogged)b.getBlockData();data.setWaterlogged(true);b.setBlockData(data,false);}
            }
            p.setOp(false);p.setGameMode(GameMode.SURVIVAL);p.setHealth(p.getMaxHealth());p.setFoodLevel(20);p.setNoDamageTicks(200);
            p.teleport(new Location(w,320.5,126,98.5));p.setFallDistance(0);
            vortex().qiandengjiMana().setMana(p.getUniqueId(),vortex().qiandengjiMana().getMaxMana(p));
            essentials().getWarps().setWarp("village",anchor());
        }else if(action.equals("arm")){
            if(!Set.of("cancel","bad_redirect","safe_redirect","far_redirect","late_redirect").contains(args[2]))throw new IllegalArgumentException("Own interference only");
            behavior=args[2];actor=p.getUniqueId();
        }else if(action.equals("otherworld")){
            World other=Bukkit.getWorlds().stream().filter(v->v!=w&&v.getEnvironment()==World.Environment.NORMAL).findFirst().orElseThrow();
            other.getBlockAt(320,125,98).setType(Material.STONE,false);
            other.getBlockAt(320,126,98).setType(Material.AIR,false);other.getBlockAt(320,127,98).setType(Material.AIR,false);
            p.teleport(new Location(other,320.5,126,98.5));
        }else if(action.equals("drain"))vortex().qiandengjiMana().setMana(p.getUniqueId(),0);
        else if(!action.equals("state"))throw new IllegalArgumentException("Unknown action");
        Class<?> type=friend().getClass().getClassLoader().loadClass("org.afuhome.agentfriend.HomeLanding");
        var constructor=type.getDeclaredConstructor(Player.class,Location.class);constructor.setAccessible(true);Object resolver=constructor.newInstance(p,anchor());
        var method=type.getDeclaredMethod("select");method.setAccessible(true);Object result=method.invoke(resolver);
        var rows=new LinkedHashMap<String,Object>();rows.put("position",List.of(p.getLocation().getX(),p.getLocation().getY(),p.getLocation().getZ()));rows.put("world",p.getWorld().getKey().toString());rows.put("mana",vortex().qiandengjiMana().getMana(p.getUniqueId()));rows.put("op",p.isOp());
        for(String key:List.of("destination","blockReads","originalIssue")){
            var getter=result.getClass().getDeclaredMethod(key);getter.setAccessible(true);Object value=getter.invoke(result);
            if(value instanceof Location at)rows.put(key,List.of(at.getX(),at.getY(),at.getZ()));
            else if(key.equals("originalIssue")&&value!=null){var code=value.getClass().getDeclaredMethod("code");code.setAccessible(true);rows.put(key,code.invoke(value));}
            else rows.put(key,value);
        }
        sender.sendMessage("HOME_QA "+gson.toJson(rows));
    }
}
