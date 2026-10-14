import java.util.*;
import java.lang.reflect.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.inventory.*;
import org.bukkit.plugin.java.JavaPlugin;

/** Test fixtures only; cannot enable on production or on a non-loopback listener. */
public final class LifeChallengeQA extends JavaPlugin implements CommandExecutor,Listener {
    private final Set<UUID> deny=new HashSet<>();
    public void onEnable(){if(getServer().getPort()!=25678||!getServer().getIp().equals("127.0.0.1")||!getServer().getMotd().equals("Life challenges isolated check"))throw new IllegalStateException("Isolated only");getCommand("lifeqa").setExecutor(this);Bukkit.getPluginManager().registerEvents(this,this);}
    Object invoke(Object o,String name,Object... args)throws Exception{Method m=Arrays.stream(o.getClass().getDeclaredMethods()).filter(x->x.getName().equals(name)&&x.getParameterCount()==args.length).findFirst().orElseThrow();m.setAccessible(true);return m.invoke(o,args);}
    Object field(Object o,String name)throws Exception{Field f=o.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(o);}
    void set(Object o,String name,Object value)throws Exception{Field f=o.getClass().getDeclaredField(name);f.setAccessible(true);f.set(o,value);}
    @EventHandler(priority=EventPriority.HIGHEST) public void deny(InventoryClickEvent e){if(deny.remove(e.getWhoClicked().getUniqueId()))e.setCancelled(true);}
    public boolean onCommand(CommandSender sender,Command command,String label,String[] args){
        if(!(sender instanceof ConsoleCommandSender||sender instanceof RemoteConsoleCommandSender))return true;
        try{
            var plugin=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");Object tower=invoke(plugin,"dungeon");
            switch(args[0]){
                case "reset"->{invoke(tower,"finish",false,"isolated_reset","QA fixture reset");set(tower,"lastRun",0L);plugin.getConfig().set("dungeon-last-run",0);plugin.saveConfig();}
                case "clear"->{for(UUID id:new ArrayList<>((Set<UUID>)field(tower,"mobs"))){Entity e=Bukkit.getEntity(id);if(e instanceof LivingEntity living)living.setHealth(0);}}
                case "state"->{sender.sendMessage("LIFE_QA_STATE "+invoke(invoke(plugin,"trialRescue"),"state",Bukkit.getPlayerExact(args[1])));return true;}
                case "deny"->deny.add(Bukkit.getPlayerExact(args[1]).getUniqueId());
                case "snapshot"->{Player p=Bukkit.getPlayerExact(args[1]);var data=new com.google.gson.JsonObject();data.addProperty("uuid",p.getUniqueId().toString());data.addProperty("health",p.getHealth());data.addProperty("cursorEmpty",p.getItemOnCursor().getType().isAir());var items=new com.google.gson.JsonObject();for(var item:p.getInventory().getContents())if(item!=null){String key=item.getType().getKey().toString();items.addProperty(key,(items.has(key)?items.get(key).getAsInt():0)+item.getAmount());}data.add("items",items);sender.sendMessage("LIFE_QA_SNAPSHOT "+data);return true;}
                default->throw new IllegalArgumentException("unknown fixture");
            }
            sender.sendMessage("LIFE_QA_OK");
        }catch(Exception error){sender.sendMessage("LIFE_QA_ERROR "+error);error.printStackTrace();}
        return true;
    }
}
