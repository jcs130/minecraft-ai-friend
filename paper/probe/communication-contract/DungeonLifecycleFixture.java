package org.qdqa;

import com.google.gson.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;

/** Own disposable actors only. Never install on a production server. */
public final class DungeonLifecycleFixture extends JavaPlugin implements CommandExecutor {
    private JavaPlugin owner;
    private static final Set<String> NAMES=Set.of("ag_LifeAlice","ag_LifeBob","ag_LifeEye");
    @Override public void onEnable(){
        try{if(Bukkit.getPort()!=29395||!Bukkit.getIp().equals("127.0.0.1")||!Files.readString(Path.of(".communication-qa")).strip().equals("127.0.0.1:29395 20261030"))throw new IllegalStateException("isolated_qa_only");}
        catch(java.io.IOException e){throw new IllegalStateException(e);}
        owner=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");getCommand("qd_life_fixture").setExecutor(this);
    }
    private Object call(Object target,String name,Class<?>[] types,Object...args)throws Exception{var m=target.getClass().getDeclaredMethod(name,types);m.setAccessible(true);return m.invoke(target,args);}
    private Object field(Object target,String name)throws Exception{var f=target.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(target);}
    private void field(Object target,String name,Object value)throws Exception{var f=target.getClass().getDeclaredField(name);f.setAccessible(true);f.set(target,value);}
    private Player player(String name){if(!NAMES.contains(name))throw new IllegalArgumentException("qa_actor_only");return Objects.requireNonNull(Bukkit.getPlayerExact(name));}
    @Override public boolean onCommand(CommandSender sender,Command command,String label,String[] args){
        if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return true;
        try{
            String action=args[0];Player p=player(args[1]);Object site=call(owner,"siteDungeons",new Class<?>[]{});
            if(action.equals("setup")){
                if(!((Map<?,?>)field(site,"runs")).isEmpty())throw new IllegalStateException("prior_run_present");
                World w=Bukkit.getWorld("world");w.setGameRule(GameRule.DO_MOB_SPAWNING,false);w.setGameRule(GameRule.KEEP_INVENTORY,true);
                for(int x=4193;x<=4255;x++)for(int z=4193;z<=4207;z++){
                    w.getBlockAt(x,80,z).setType(Material.STONE,false);for(int y=81;y<=86;y++)w.getBlockAt(x,y,z).setType(Material.AIR,false);
                }
                for(String name:NAMES){Player member=player(name);member.setOp(false);member.setGameMode(name.endsWith("Eye")?GameMode.SPECTATOR:GameMode.SURVIVAL);member.setInvulnerable(false);member.setHealth(member.getMaxHealth());member.setFoodLevel(20);member.setSaturation(20);member.setFireTicks(0);
                    member.getInventory().clear();member.getInventory().setHelmet(new ItemStack(Material.DIAMOND_HELMET));member.getInventory().setChestplate(new ItemStack(Material.DIAMOND_CHESTPLATE));member.getInventory().setLeggings(new ItemStack(Material.DIAMOND_LEGGINGS));member.getInventory().setBoots(new ItemStack(Material.DIAMOND_BOOTS));member.getInventory().setItem(0,new ItemStack(Material.DIAMOND_SWORD));member.getInventory().setItem(1,new ItemStack(Material.EMERALD,7));member.getInventory().setHeldItemSlot(0);
                    member.teleport(new Location(w,name.endsWith("Alice")?4200.5:4250.5,81,4200.5));
                }
            }else if(action.equals("age")){
                Object run=((Map<?,?>)field(site,"runs")).get("qa_lifecycle");if(run==null)throw new IllegalStateException("qa_run_required");
                for(Object id:(Set<?>)field(run,"party"))if(NAMES.stream().noneMatch(n->UUID.nameUUIDFromBytes(("OfflinePlayer:"+n).getBytes(java.nio.charset.StandardCharsets.UTF_8)).equals(id)))throw new IllegalStateException("foreign_participant");
                int seconds=Integer.parseInt(args[2]);if(seconds<0||seconds>1900)throw new IllegalArgumentException("age_out_of_range");field(run,"started",System.currentTimeMillis()-seconds*1000L);
            }else if(action.equals("inside"))p.teleport(new Location(Bukkit.getWorld("world"),4200.5,81,4200.5));
            else if(action.equals("outside"))p.teleport(new Location(Bukkit.getWorld("world"),4250.5,81,4200.5));
            else if(action.equals("state")){
                Object rescue=call(owner,"trialRescue",new Class<?>[]{});JsonObject out=new JsonObject();out.add("rescue",(JsonObject)call(rescue,"state",new Class<?>[]{Player.class},p));
                out.addProperty("x",p.getLocation().getX());out.addProperty("y",p.getLocation().getY());out.addProperty("z",p.getLocation().getZ());out.addProperty("dead",p.isDead());
                var inventory=new TreeMap<String,Integer>();for(ItemStack item:p.getInventory().getContents())if(item!=null)inventory.merge(item.getType().name(),item.getAmount(),Integer::sum);out.add("inventory",new Gson().toJsonTree(inventory));sender.sendMessage("LIFE_QA_STATE "+out);return true;
            }else if(action.equals("cooldown")){owner.getConfig().set("site-dungeons.cooldowns.qa_lifecycle",0);owner.saveConfig();}
            else if(action.equals("freeze")){for(Entity entity:p.getWorld().getNearbyEntities(p.getLocation(),35,8,15))if(entity instanceof Monster mob)mob.setAI(false);}
            else throw new IllegalArgumentException("unknown_qa_action");
            sender.sendMessage("LIFE_QA_OK "+action);
        }catch(Throwable e){getLogger().log(java.util.logging.Level.WARNING,"QA failure",e);sender.sendMessage("LIFE_QA_ERROR "+e);}
        return true;
    }
}
