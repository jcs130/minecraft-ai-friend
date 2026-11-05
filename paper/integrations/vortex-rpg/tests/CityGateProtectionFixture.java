package org.qiandengji.vortex.tests;

import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.*;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.event.block.*;
import org.bukkit.event.entity.*;
import org.bukkit.plugin.java.JavaPlugin;
import com.google.gson.Gson;

/** Only synthetic blocks/actors on the existing loopback gate fixture. */
public final class CityGateProtectionFixture extends JavaPlugin {
    @Override public void onEnable(){
        try{if(!Bukkit.getIp().equals("127.0.0.1")||Bukkit.getPort()!=25988
            ||!Files.readString(Path.of(".city-gate-qa")).equals("CITY_GATE_QA_ONLY"))throw new IllegalStateException("Gate QA only");
        }catch(java.io.IOException e){throw new IllegalStateException(e);}
        getServer().getCommandMap().register("gateprotectionqa",new Command("gateprotectqa"){
            @Override public boolean execute(CommandSender s,String label,String[] a){
                if(!(s instanceof ConsoleCommandSender)&&!(s instanceof RemoteConsoleCommandSender))return false;
                Player p=Bukkit.getPlayerExact("ag_TCA");if(p==null)throw new IllegalStateException("Own actor offline");
                s.sendMessage("GATE_PROTECTION_QA "+new Gson().toJson(check(p)));return true;
            }
        });
    }
    private Map<String,Boolean> check(Player p){
        Map<String,Boolean> checks=new LinkedHashMap<>();World w=p.getWorld();boolean op=p.isOp();GameMode gm=p.getGameMode();
        try{
            p.setOp(true);p.setGameMode(GameMode.CREATIVE);
            for(var point:List.of(new int[]{47,81,48},new int[]{51,82,48},new int[]{49,84,48},new int[]{47,82,49},new int[]{47,83,49},new int[]{49,80,50})){
                var e=new BlockBreakEvent(w.getBlockAt(point[0],point[1],point[2]),p);Bukkit.getPluginManager().callEvent(e);
                checks.put("op break "+Arrays.toString(point),e.isCancelled());
            }
            Block inside=w.getBlockAt(49,81,48),outside=w.getBlockAt(46,81,48);
            var plain=new BlockBreakEvent(outside,p);Bukkit.getPluginManager().callEvent(plain);checks.put("outside remains editable",!plain.isCancelled());
            var place=new BlockPlaceEvent(inside,inside.getState(),inside.getRelative(BlockFace.DOWN),new org.bukkit.inventory.ItemStack(Material.STONE),p,true,org.bukkit.inventory.EquipmentSlot.HAND);
            Bukkit.getPluginManager().callEvent(place);checks.put("OP cannot block entrance",place.isCancelled());
            var multi=new BlockMultiPlaceEvent(List.of(outside.getState(),inside.getState()),outside.getRelative(BlockFace.DOWN),new org.bukkit.inventory.ItemStack(Material.OAK_DOOR),p,true,org.bukkit.inventory.EquipmentSlot.HAND);
            Bukkit.getPluginManager().callEvent(multi);checks.put("multi placement crossing boundary",multi.isCancelled());
            var sign=new SignChangeEvent(w.getBlockAt(47,83,49),p,new String[]{"test","","",""});Bukkit.getPluginManager().callEvent(sign);checks.put("sign text protected",sign.isCancelled());
            var burn=new BlockBurnEvent(inside,outside);Bukkit.getPluginManager().callEvent(burn);checks.put("fire protected",burn.isCancelled());
            var flow=new BlockFromToEvent(outside,inside);Bukkit.getPluginManager().callEvent(flow);checks.put("fluid destination protected",flow.isCancelled());
            var change=new EntityChangeBlockEvent(p,inside,Material.AIR.createBlockData());Bukkit.getPluginManager().callEvent(change);checks.put("entity grief protected",change.isCancelled());
            var explode=new EntityExplodeEvent(p,p.getLocation(),new ArrayList<>(List.of(inside,outside)),1f,ExplosionResult.DESTROY);Bukkit.getPluginManager().callEvent(explode);
            checks.put("explosion preserves only gate",!explode.blockList().contains(inside)&&explode.blockList().contains(outside));
            var extend=new BlockPistonExtendEvent(outside.getRelative(BlockFace.WEST),List.of(outside),BlockFace.EAST);Bukkit.getPluginManager().callEvent(extend);checks.put("piston into gate",extend.isCancelled());
            var head=new BlockPistonExtendEvent(outside,List.of(),BlockFace.EAST);Bukkit.getPluginManager().callEvent(head);checks.put("empty piston head into gate",head.isCancelled());
            var retract=new BlockPistonRetractEvent(outside.getRelative(BlockFace.WEST),List.of(inside),BlockFace.EAST);Bukkit.getPluginManager().callEvent(retract);checks.put("piston out of gate",retract.isCancelled());
        }finally{p.setOp(op);p.setGameMode(gm);}
        return checks;
    }
}
