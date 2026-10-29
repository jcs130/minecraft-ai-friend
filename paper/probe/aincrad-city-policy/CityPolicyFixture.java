package org.qdqa;

import java.util.*;
import org.bukkit.*;
import org.bukkit.block.Block;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.event.block.*;
import org.bukkit.inventory.*;
import org.bukkit.plugin.java.JavaPlugin;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.bukkit.WorldGuardPlugin;
import com.sk89q.worldguard.protection.flags.Flags;
import com.sk89q.worldguard.protection.regions.ProtectedPolygonalRegion;

/** Loopback-only fixture. It must never be installed on the production server. */
public final class CityPolicyFixture extends JavaPlugin implements CommandExecutor {
    @Override public void onEnable() {
        if (Bukkit.getPort()!=29385 || !Bukkit.getIp().equals("127.0.0.1")) throw new IllegalStateException("isolated_city_fixture_only");
        getCommand("qd_city_fixture").setExecutor(this);
    }
    private static void check(CommandSender sender, boolean value, String name) {
        if (!value) throw new IllegalStateException(name);
        sender.sendMessage("PASS "+name);
    }
    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) return true;
        try {
            Player p=Bukkit.getPlayerExact(args[1]); World world=Bukkit.getWorld("aincrad");
            if (p==null || world==null) throw new IllegalStateException("test_player_or_world_missing");
            if (args[0].equals("state")) {
                sender.sendMessage("CITY_BLOCKS city="+world.getBlockAt(-584,69,934).getType()+" outside="+world.getBlockAt(-1000,69,934).getType()+" world="+p.getWorld().getName()+" op="+p.isOp()); return true;
            }
            if (args[0].equals("outside")) {
                p.teleport(new Location(world,-998.5,69,934.5)); sender.sendMessage("READY outside pad"); return true;
            }
            if (args[0].equals("setup")) {
                p.setOp(false); p.setGameMode(GameMode.SURVIVAL); p.getInventory().clear();
                p.getInventory().setItem(0,new ItemStack(Material.COBBLESTONE,64));
                p.getInventory().setItem(1,new ItemStack(Material.DIAMOND_PICKAXE));
                // Dedicated copied QA terrain only; real client uses these two pads.
                for(int x:new int[]{-584,-1000}) {
                    for(int dx=-2;dx<=2;dx++)for(int dz=-2;dz<=2;dz++) {
                        world.getBlockAt(x+dx,68,934+dz).setType(Material.STONE,false);
                        for(int y=69;y<=72;y++)world.getBlockAt(x+dx,y,934+dz).setType(Material.AIR,false);
                    }
                }
                p.teleport(new Location(world,-582.5,69,934.5));
                sender.sendMessage("READY non-op survival inventory and QA pads"); return true;
            }
            var manager=WorldGuard.getInstance().getPlatform().getRegionContainer().get(BukkitAdapter.adapt(world));
            var local=WorldGuardPlugin.inst().wrapPlayer(p);
            check(sender,!p.isOp()&&!p.hasPermission("worldguard.region.bypass.aincrad"),"ordinary_player_without_bypass");
            var region=manager.getRegion("qd_aincrad_map");
            check(sender,region instanceof ProtectedPolygonalRegion && region.getPoints().size()==64,"city_is_64_point_polygon");
            check(sender,manager.getRegions().keySet().stream().anyMatch(id->id.startsWith("qd_block_access_outside_")),"wilderness_allow_regions_present");
            check(sender,manager.getRegion("qd_block_access_editors").getMembers().size()==2,"original_two_editors_preserved");
            int[][] cases={{-583,934,0},{-584,1285,0},{-1000,934,1},{-180,934,1},{-584,540,1},{-584,1340,1},
                           {-920,1260,1},{-250,1260,1},{-920,600,1},{-250,600,1}};
            for(int[] test:cases) {
                int x=test[0],z=test[1]; boolean outside=test[2]==1;
                var set=manager.getApplicableRegions(BlockVector3.at(x,69,z));
                check(sender,set.testState(local,Flags.BLOCK_BREAK)==outside,"break_query_"+x+"_"+z);
                check(sender,set.testState(local,Flags.BLOCK_PLACE),"place_query_"+x+"_"+z);
                p.teleport(new Location(world,x+1.5,71,z+.5)); Block block=world.getBlockAt(x,69,z);
                var broken=new BlockBreakEvent(block,p); Bukkit.getPluginManager().callEvent(broken);
                check(sender,broken.isCancelled()!=outside,"break_event_"+x+"_"+z);
                var placed=new BlockPlaceEvent(block,block.getState(),block.getRelative(org.bukkit.block.BlockFace.DOWN),new ItemStack(Material.COBBLESTONE),p,true,EquipmentSlot.HAND);
                Bukkit.getPluginManager().callEvent(placed);
                check(sender,!placed.isCancelled()&&placed.canBuild(),"place_event_"+x+"_"+z);
            }
            // A floor-one encounter is outside the city, but retains its own building guard.
            Block dungeon=world.getBlockAt(832,69,-1176); p.teleport(new Location(world,833.5,70,-1175.5));
            var dungeonBreak=new BlockBreakEvent(dungeon,p); Bukkit.getPluginManager().callEvent(dungeonBreak);
            check(sender,dungeonBreak.isCancelled(),"authored_dungeon_break_still_denied");
            var dungeonPlace=new BlockPlaceEvent(dungeon,dungeon.getState(),dungeon.getRelative(org.bukkit.block.BlockFace.DOWN),new ItemStack(Material.COBBLESTONE),p,true,EquipmentSlot.HAND);
            Bukkit.getPluginManager().callEvent(dungeonPlace);
            check(sender,dungeonPlace.isCancelled()||!dungeonPlace.canBuild(),"authored_dungeon_place_still_denied");
            var city=manager.getApplicableRegions(BlockVector3.at(-583,69,934));
            check(sender,city.testState(local,Flags.USE,Flags.CHEST_ACCESS),"city_doors_and_containers_usable");
            check(sender,!city.testState(local,Flags.TNT,Flags.CREEPER_EXPLOSION,Flags.LIGHTER),"city_explosion_and_fire_guard_retained");
            p.teleport(new Location(world,-582.5,69,934.5));
            sender.sendMessage("CITY_CHECKS_COMPLETED");
        } catch(Throwable failure) { sender.sendMessage("CITY_QA_ERROR "+failure); failure.printStackTrace(); }
        return true;
    }
}
