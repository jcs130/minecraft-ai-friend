import java.util.*;
import java.lang.reflect.*;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.inventory.*;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.configuration.serialization.ConfigurationSerializable;

/** Private fixture: refuses every port except the isolated copied-world instance. */
public final class TrialRescueQA extends JavaPlugin implements CommandExecutor {
  public void onEnable(){if(getServer().getPort()!=25662 || !getServer().getIp().equals("127.0.0.1"))throw new IllegalStateException("Isolated only");getCommand("trialrescueqa").setExecutor(this);}
  Object invoke(Object o,String name,Object... args)throws Exception{
    Method m=Arrays.stream(o.getClass().getDeclaredMethods()).filter(x->x.getName().equals(name)&&x.getParameterCount()==args.length).findFirst().orElseThrow();
    m.setAccessible(true);try{return m.invoke(o,args);}catch(InvocationTargetException e){throw new RuntimeException(e.getCause());}
  }
  Object field(Object o,String name)throws Exception{Field f=o.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(o);}
  void set(Object o,String name,Object v)throws Exception{Field f=o.getClass().getDeclaredField(name);f.setAccessible(true);f.set(o,v);}
  Object norm(Object v){
    if(v instanceof ConfigurationSerializable c)return norm(c.serialize());
    if(v instanceof Map<?,?> m){var r=new TreeMap<String,Object>();m.forEach((k,x)->r.put(k.toString(),norm(x)));return r;}
    if(v instanceof Collection<?> c)return c.stream().map(this::norm).toList();
    if(v!=null&&v.getClass().isArray()){var r=new ArrayList<>();for(int i=0;i<Array.getLength(v);i++)r.add(norm(Array.get(v,i)));return r;}
    return v==null||v instanceof String||v instanceof Number||v instanceof Boolean?v:v.toString();
  }
  String inventory(Player p){return new com.google.gson.Gson().toJson(Arrays.stream(p.getInventory().getContents()).map(this::norm).toList());}
  public boolean onCommand(CommandSender s,Command c,String l,String[] a){
    if(!(s instanceof ConsoleCommandSender||s instanceof RemoteConsoleCommandSender))return true;
    try{
      var p=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");Object tower=invoke(p,"dungeon"),sites=invoke(p,"siteDungeons");
      switch(a[0]){
        case "clear"->{for(UUID id:new ArrayList<>((Set<UUID>)field(tower,"mobs"))){Entity e=Bukkit.getEntity(id);if(e instanceof LivingEntity living)living.setHealth(0);}s.sendMessage("TRIAL_QA cleared=true");}
        case "state"->{Object rescue=invoke(p,"trialRescue");s.sendMessage("TRIAL_QA_STATE "+invoke(rescue,"state",Bukkit.getPlayerExact(a[1])));}
        case "pause"->{set(tower,"pausedAt",a[1].equals("true")?System.currentTimeMillis():0L);s.sendMessage("TRIAL_QA paused="+a[1]);}
        case "reset"->{invoke(tower,"finish",false,"isolated_reset","QA fixture reset");for(Object run:new ArrayList<>(((Map<?,?>)field(sites,"runs")).values()))invoke(sites,"end",run,"isolated_reset");set(tower,"lastRun",0L);p.getConfig().set("dungeon-last-run",0);p.getConfig().set("site-dungeons.cooldowns",null);p.saveConfig();s.sendMessage("TRIAL_QA reset=true");}
        case "floor"->{var ids=(Set<UUID>)field(tower,"participants");List<Player> players=ids.stream().map(Bukkit::getPlayer).filter(Objects::nonNull).toList();int count=(Integer)invoke(tower,"enterFloor",Integer.parseInt(a[1]),players);s.sendMessage("TRIAL_QA arrived="+count);}
        case "audit"->{Player target=Bukkit.getPlayerExact(a[1]);MessageDigest digest=MessageDigest.getInstance("SHA-256");digest.update(inventory(target).getBytes(java.nio.charset.StandardCharsets.UTF_8));s.sendMessage("TRIAL_QA name="+target.getName()+" health="+target.getHealth()+" dead="+target.isDead()+" mode="+target.getGameMode()+" inventory="+HexFormat.of().formatHex(digest.digest()));}
        case "inventory"->s.sendMessage("TRIAL_QA_INVENTORY "+inventory(Bukkit.getPlayerExact(a[1])));
        case "mobs"->{for(UUID id:(Set<UUID>)field(tower,"mobs")){Entity e=Bukkit.getEntity(id);if(e instanceof Mob mob)s.sendMessage("TRIAL_QA_MOB type="+e.getType()+" health="+mob.getHealth()+" max="+mob.getMaxHealth()+" weapon="+(mob.getEquipment().getItemInMainHand().getType()));}}
        default->s.sendMessage("TRIAL_QA invalid");
      }
    }catch(Exception e){s.sendMessage("TRIAL_QA error="+e);e.printStackTrace();}
    return true;
  }
}
