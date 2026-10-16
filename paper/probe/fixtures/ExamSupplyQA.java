package stageqa;
import com.google.gson.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.craftbukkit.CraftWorld;
import org.bukkit.craftbukkit.generator.structure.CraftStructure;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;
public class ExamSupplyQA extends JavaPlugin {
 public void onEnable(){if(getServer().getPort()!=25830)getServer().getPluginManager().disablePlugin(this);}
 public boolean onCommand(CommandSender sender,Command command,String label,String[] a){
  if(getServer().getPort()!=25830||!(sender instanceof ConsoleCommandSender||sender instanceof RemoteConsoleCommandSender))return true;
  JsonObject out=new JsonObject();try {
   var plugin=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");
   switch(a[0]) {
    case "tickets"->{out.addProperty("pluginTickets",Bukkit.getWorld("world").getPluginChunkTickets().getOrDefault(plugin,List.of()).size());}
    case "place"->{var world=Bukkit.getWorld("world");int x=Integer.parseInt(a[1]),y=Integer.parseInt(a[2]),z=Integer.parseInt(a[3]);
     var cls=Class.forName("org.afuhome.agentfriend.ExplorationObjectives",true,plugin.getClass().getClassLoader());var method=cls.getDeclaredMethod("mapPlace",org.bukkit.Location.class,int.class,int.class);method.setAccessible(true);
     out.addProperty("place",String.valueOf(method.invoke(null,new Location(world,x,y,z),x,z)));JsonArray starts=new JsonArray();var source=((CraftWorld)world).getHandle().getChunkSource();
     for(int cx=(x>>4)-2;cx<=(x>>4)+2;cx++)for(int cz=(z>>4)-2;cz<=(z>>4)+2;cz++){var chunk=source.getChunkAtIfLoadedImmediately(cx,cz);if(chunk==null)continue;for(var entry:chunk.getAllStarts().entrySet()){
      JsonObject row=new JsonObject();row.addProperty("structure",CraftStructure.minecraftToBukkit(entry.getKey()).getKey().toString());row.addProperty("bounds",entry.getValue().getBoundingBox().toString());starts.add(row);
     }}out.add("starts",starts);}
    case "fill"->{Player p=Bukkit.getPlayerExact(a[1]);for(int slot=0;slot<540;slot++)plugin.getConfig().set("dungeon-personal-stash."+p.getUniqueId()+"."+slot,new ItemStack(Material.STONE,64));plugin.saveConfig();out.addProperty("filled",540);}
    case "fillinventory"->{Player p=Bukkit.getPlayerExact(a[1]);for(int slot=0;slot<36;slot++)p.getInventory().setItem(slot,new ItemStack(Material.STONE,64));out.addProperty("filled",36);}
    case "clearinventoryslot"->{Player p=Bukkit.getPlayerExact(a[1]);p.getInventory().setItem(Integer.parseInt(a[2]),null);out.addProperty("cleared",true);}
    case "state"->{Player p=Bukkit.getPlayerExact(a[1]);String id=p.getUniqueId().toString();out.addProperty("supplies",String.valueOf(plugin.getConfig().get("exam-supplies-issued."+id)));out.addProperty("queue",String.valueOf(plugin.getConfig().get("dungeon-bonus-items."+id)));out.addProperty("uuid",id);}
   }
  }catch(Exception e){out.addProperty("error",e.toString());}sender.sendMessage(out.toString());return true;
 }
}
