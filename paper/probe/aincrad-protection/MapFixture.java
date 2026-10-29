package org.qdqa;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.*;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.inventory.*;
import org.bukkit.event.block.*;
import org.bukkit.event.entity.*;
import org.bukkit.event.player.*;
import org.bukkit.plugin.java.JavaPlugin;
import dev.aurelium.auraskills.api.AuraSkillsApi;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.bukkit.WorldGuardPlugin;
import com.sk89q.worldguard.protection.flags.Flags;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.math.BlockVector3;

/** Console only, port and bind guarded. Never deploy to the game server. */
public final class MapFixture extends JavaPlugin implements CommandExecutor {
  @Override public void onEnable(){
    if(Bukkit.getPort()!=25928||!Bukkit.getIp().equals("127.0.0.1"))throw new IllegalStateException("isolated_fixture_only");
    getCommand("qdmap").setExecutor(this);
  }
  static void check(CommandSender s,boolean ok,String name){if(!ok)throw new IllegalStateException(name);s.sendMessage("PASS "+name);}
  @Override public boolean onCommand(CommandSender s,Command c,String l,String[] a){
    if(!(s instanceof ConsoleCommandSender)&&!(s instanceof RemoteConsoleCommandSender))return true;
    try{
      Player p=Bukkit.getPlayerExact(a[1]);World w=Bukkit.getWorld("aincrad");
      switch(a[0]){
        case "prepare" -> {
          for(World qw:Bukkit.getWorlds()){qw.setGameRule(GameRule.DO_MOB_SPAWNING,false);qw.setTime(6000);}
          for(Entity e:p.getNearbyEntities(32,16,32))if(e instanceof Monster)e.remove();
          for(Entity e:w.getNearbyEntities(new Location(w,-582.5,69,934.5),32,16,32))if(e instanceof Monster)e.remove();
          p.setOp(false);p.setGameMode(GameMode.SURVIVAL);
          p.setHealth(p.getAttribute(org.bukkit.attribute.Attribute.GENERIC_MAX_HEALTH).getValue());
          p.addAttachment(this,"essentials.warp",true);p.addAttachment(this,"essentials.warps.aincrad",true);p.addAttachment(this,"essentials.warps.village",true);
          var mana=AuraSkillsApi.get().getUser(p.getUniqueId());mana.setMana(mana.getMaxMana());
          p.teleport(new Location(Bukkit.getWorld("world"),10.5,5,10.5));
          p.getInventory().setItem(0,new ItemStack(Material.DIAMOND_PICKAXE));p.getInventory().setItem(1,new ItemStack(Material.COBBLESTONE,16));
          p.getInventory().setItem(2,new ItemStack(Material.WATER_BUCKET));
          s.sendMessage("prepared");
        }
        case "mana" -> {var u=AuraSkillsApi.get().getUser(p.getUniqueId());u.setMana(u.getMaxMana());s.sendMessage("mana="+u.getMana());}
        case "drain" -> {AuraSkillsApi.get().getUser(p.getUniqueId()).setMana(0);s.sendMessage("mana=0");}
        case "state" -> s.sendMessage("world="+p.getWorld().getName()+" position="+p.getLocation().toVector()+" mana="+AuraSkillsApi.get().getUser(p.getUniqueId()).getMana()+" op="+p.isOp());
        case "checks" -> {
          check(s,w!=null,"authored_world_loaded");
          var manager=WorldGuard.getInstance().getPlatform().getRegionContainer().get(BukkitAdapter.adapt(w));
          check(s,manager.getRegion("qd_aincrad_map")!=null,"whole_map_region_loaded");
          check(s,manager.getRegions().keySet().stream().noneMatch(x->x.startsWith("qd_block_access_outside_")),"no_wilderness_allow_overlay");
          var local=WorldGuardPlugin.inst().wrapPlayer(p);var set=manager.getApplicableRegions(BlockVector3.at(-583,68,934));
          check(s,!set.testState(local,Flags.BLOCK_BREAK,Flags.BLOCK_PLACE),"ordinary_non_op_build_denied");
          check(s,set.testState(local,Flags.USE,Flags.CHEST_ACCESS),"doors_chests_allowed");
          var entry=new Location(w,-582.5,69,934.5);
          check(s,w.getBlockAt(-583,68,934).getType().isSolid()&&w.getBlockAt(-583,69,934).isPassable()&&w.getBlockAt(-583,70,934).isPassable(),"original_entry_safe");
          Block b=w.getBlockAt(-585,69,934);b.setType(Material.STONE);
          var br=new BlockBreakEvent(b,p);Bukkit.getPluginManager().callEvent(br);check(s,br.isCancelled(),"break_event_denied");
          var pl=new BlockPlaceEvent(b,b.getState(),b.getRelative(BlockFace.DOWN),new ItemStack(Material.COBBLESTONE),p,true,EquipmentSlot.HAND);Bukkit.getPluginManager().callEvent(pl);check(s,pl.isCancelled()||!pl.canBuild(),"place_event_denied");
          var bu=new PlayerBucketEmptyEvent(p,b.getRelative(BlockFace.UP),b,BlockFace.UP,Material.WATER_BUCKET,new ItemStack(Material.BUCKET),EquipmentSlot.HAND);Bukkit.getPluginManager().callEvent(bu);check(s,bu.isCancelled(),"bucket_denied");
          var en=w.spawn(entry.clone().add(2,0,0),Enderman.class);en.setAI(false);
          var change=new EntityChangeBlockEvent(en,b,Material.AIR.createBlockData());Bukkit.getPluginManager().callEvent(change);check(s,change.isCancelled(),"enderman_grief_denied");en.remove();
          var ex=new EntityExplodeEvent(w.spawn(entry,TNTPrimed.class),entry,new ArrayList<>(List.of(b)),1,ExplosionResult.DESTROY);Bukkit.getPluginManager().callEvent(ex);check(s,ex.isCancelled()||ex.blockList().isEmpty(),"tnt_blocks_preserved");ex.getEntity().remove();
          b.setType(Material.WATER,false);b.getRelative(BlockFace.EAST).setType(Material.AIR,false);
          var flow=new BlockFromToEvent(b,b.getRelative(BlockFace.EAST));Bukkit.getPluginManager().callEvent(flow);check(s,flow.isCancelled(),"fluid_flow_denied");b.setType(Material.STONE,false);
          var pistonData=(org.bukkit.block.data.Directional)Material.PISTON.createBlockData();pistonData.setFacing(BlockFace.EAST);b.setBlockData(pistonData,false);b.getRelative(BlockFace.EAST).setType(Material.STONE,false);
          var piston=new BlockPistonExtendEvent(b,List.of(b.getRelative(BlockFace.EAST)),BlockFace.EAST);Bukkit.getPluginManager().callEvent(piston);check(s,piston.isCancelled(),"piston_denied");b.setType(Material.STONE,false);
          var ignite=new BlockIgniteEvent(b,BlockIgniteEvent.IgniteCause.FLINT_AND_STEEL,p);Bukkit.getPluginManager().callEvent(ignite);check(s,ignite.isCancelled(),"fire_ignition_denied");
          var place=new com.sk89q.worldguard.protection.regions.ProtectedCuboidRegion("qa_private_claim",BlockVector3.at(-590,60,930),BlockVector3.at(-580,80,940));place.setPriority(100);place.getOwners().addPlayer(p.getUniqueId());place.setFlag(Flags.BUILD,com.sk89q.worldguard.protection.flags.StateFlag.State.ALLOW);manager.addRegion(place);
          try{check(s,!manager.getApplicableRegions(BlockVector3.at(-585,69,934)).testState(local,Flags.BLOCK_BREAK),"private_claim_cannot_override_authored_map");}finally{manager.removeRegion("qa_private_claim");}
          var editors=manager.getRegion("qd_block_access_editors");check(s,editors!=null&&editors.getMembers().size()==2,"existing_two_editors_retained");editors.getMembers().addPlayer(p.getUniqueId());
          try{var eb=new BlockBreakEvent(b,p);Bukkit.getPluginManager().callEvent(eb);check(s,!eb.isCancelled(),"trusted_editor_can_maintain_map");}finally{editors.getMembers().removePlayer(p.getUniqueId());}
          b.setType(Material.CHEST);var chest=new PlayerInteractEvent(p,Action.RIGHT_CLICK_BLOCK,new ItemStack(Material.AIR),b,BlockFace.UP,EquipmentSlot.HAND);Bukkit.getPluginManager().callEvent(chest);check(s,chest.useInteractedBlock()!=org.bukkit.event.Event.Result.DENY,"chest_interaction_allowed");
          b.setType(Material.OAK_DOOR);var door=new PlayerInteractEvent(p,Action.RIGHT_CLICK_BLOCK,new ItemStack(Material.AIR),b,BlockFace.EAST,EquipmentSlot.HAND);Bukkit.getPluginManager().callEvent(door);check(s,door.useInteractedBlock()!=org.bukkit.event.Event.Result.DENY,"door_interaction_allowed");b.setType(Material.STONE);
          var mob=w.spawn(entry.clone().add(3,0,0),Husk.class);mob.setAI(false);mob.setSilent(true);
          double hp=mob.getHealth();mob.damage(2,p);check(s,mob.getHealth()<hp,"player_can_damage_monster");
          p.setNoDamageTicks(0);double before=p.getHealth();p.damage(1,mob);check(s,p.getHealth()<before,"monster_can_damage_player");mob.remove();
          var pre=new PlayerCommandPreprocessEvent(p,"/mycli protect break -585 69 934");Bukkit.getPluginManager().callEvent(pre);
          if(!pre.isCancelled())p.performCommand(pre.getMessage().substring(1));
          b.setType(Material.AIR);s.sendMessage("checks_completed");
        }
      }
    }catch(Throwable t){s.sendMessage("QDQA_ERROR "+t);t.printStackTrace();}
    return true;
  }
}
