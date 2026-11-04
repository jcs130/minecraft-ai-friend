package org.qiandengji.vortex.tests;

import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.BlockFace;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.*;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.plugin.java.JavaPlugin;
import io.vortexcore.VortexCorePlugin;
import com.google.gson.Gson;

/** Test-only console fixture. Cannot run on a public production listener. */
public final class CityGateFixture extends JavaPlugin implements Listener {
    private boolean deny;
    @Override public void onEnable(){
        try{if(!Bukkit.getIp().equals("127.0.0.1")||Bukkit.getPort()!=25988
                ||!Files.readString(Path.of(".city-gate-qa")).equals("CITY_GATE_QA_ONLY"))
            throw new IllegalStateException("Isolated city gate fixture only");
        }catch(java.io.IOException error){throw new IllegalStateException(error);}
        Bukkit.getPluginManager().registerEvents(this,this);
        getServer().getCommandMap().register("citygatefixture",new Command("gateqa"){
            @Override public boolean execute(CommandSender sender,String label,String[] a){
                if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender)||a.length==0)return false;
                Player p=Bukkit.getPlayerExact("ag_TCA");if(p==null)throw new IllegalStateException("Own actor offline");
                try{run(sender,p,a);}catch(Exception error){throw new IllegalStateException(error);}return true;
            }
        });
    }
    @EventHandler(priority=EventPriority.HIGHEST)
    public void deny(PlayerInteractEvent e){if(deny&&e.getPlayer().getName().equals("ag_TCA"))e.setUseInteractedBlock(Event.Result.DENY);}
    private void platform(World w,int x,int z){for(int xx=x-2;xx<=x+5;xx++)for(int zz=z-2;zz<=z+5;zz++)for(int y=80;y<=85;y++)
        w.getBlockAt(xx,y,zz).setType(y==80?Material.STONE:Material.AIR,false);
        for(int y=81;y<=83;y++){w.getBlockAt(x-1,y,z).setType(Material.SMOOTH_QUARTZ,false);w.getBlockAt(x+3,y,z).setType(Material.SMOOTH_QUARTZ,false);}
        for(int xx=x-1;xx<=x+3;xx++)w.getBlockAt(xx,84,z).setType(Material.CHISELED_QUARTZ_BLOCK,false);
        w.getBlockAt(x-1,82,z+1).setBlockData(Bukkit.createBlockData("minecraft:stone_button[face=wall,facing=south,powered=false]"),false);
    }
    private void run(CommandSender sender,Player p,String[] a)throws Exception{
        var v=(VortexCorePlugin)Bukkit.getPluginManager().getPlugin("VortexRPG");World w=Bukkit.getWorld("world");
        if(v.playerProfileService().qiandengjiLoading(p.getUniqueId())){sender.sendMessage("GATE_QA {\"loading\":true}");return;}
        switch(a[0]){
            case "setup"->{platform(w,48,48);platform(w,64,48);w.setGameRule(GameRule.DO_MOB_SPAWNING,false);
                var warps=((com.earth2me.essentials.Essentials)Bukkit.getPluginManager().getPlugin("Essentials")).getWarps();
                warps.setWarp("aincrad",new Location(w,63.5,81,51.5));warps.setWarp("village",new Location(w,47.5,81,51.5));
                p.setGameMode(GameMode.SURVIVAL);p.teleport(new Location(w,47.5,81,51.5));v.qiandengjiMana().setMana(p.getUniqueId(),20);}
            case "origin"->{p.eject();p.setGameMode(GameMode.SURVIVAL);p.teleport(new Location(w,47.5,81,51.5));v.qiandengjiMana().setMana(p.getUniqueId(),20);deny=false;}
            case "mana"->v.qiandengjiMana().setMana(p.getUniqueId(),Integer.parseInt(a[1]));
            case "mode"->p.setGameMode(GameMode.valueOf(a[1]));
            case "deny"->deny=Boolean.parseBoolean(a[1]);
            case "frame"->w.getBlockAt(51,81,48).setType(a[1].equals("true")?Material.SMOOTH_QUARTZ:Material.AIR,false);
            case "far"->p.teleport(new Location(w,52.5,81,53.5));
            case "event"->{
                var action=a[1].equals("left")?Action.LEFT_CLICK_BLOCK:Action.RIGHT_CLICK_BLOCK;
                var hand=a[1].equals("offhand")?EquipmentSlot.OFF_HAND:EquipmentSlot.HAND;
                var b=w.getBlockAt(a[1].equals("other")?51:47,82,49);
                Bukkit.getPluginManager().callEvent(new PlayerInteractEvent(p,action,null,b,BlockFace.SOUTH,hand));}
            case "walk"->{
                Location from=new Location(w,49.5,81,49.5),to=new Location(w,49.5,81,48.5);
                p.teleport(from);Bukkit.getPluginManager().callEvent(new PlayerMoveEvent(p,from,to));p.teleport(to);}
            case "status"->{}
            default->throw new IllegalArgumentException("Own fixture operation");
        }
        sender.sendMessage("GATE_QA "+new Gson().toJson(Map.of("mana",v.qiandengjiMana().getMana(p.getUniqueId()),
            "position",List.of(p.getWorld().getName(),p.getLocation().getX(),p.getLocation().getY(),p.getLocation().getZ()),"op",p.isOp())));
    }
}
