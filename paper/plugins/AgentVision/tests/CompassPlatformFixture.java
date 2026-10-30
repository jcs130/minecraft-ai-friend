package org.afuhome.agentvision.tests;

import java.lang.reflect.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** Runs the actual loaded AF method, using nullable API receipts without moving a player. */
public final class CompassPlatformFixture extends JavaPlugin {
    @Override public void onEnable() {
        if(!getServer().getIp().equals("127.0.0.1")||getServer().getPort()!=29397)throw new IllegalStateException("Loopback compass fixture only");
        getServer().getCommandMap().register("compassqa",new Command("compassplatformtest") {
            @Override public boolean execute(CommandSender sender,String label,String[] args) {
                if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return false;
                try{run(sender);}catch(ReflectiveOperationException e){throw new IllegalStateException(e);}return true;
            }
        });
        getServer().getCommandMap().register("compassqa",new Command("backpackplatformstatus") {
            @Override public boolean execute(CommandSender sender,String label,String[] args) {
                if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return false;
                Player p=Bukkit.getPlayerExact("ag_BP1030Fix");if(p==null){sender.sendMessage("BACKPACK_PLATFORM offline");return true;}
                var inv=p.getOpenInventory().getTopInventory();int stored=0,carried=0;
                for(var i:inv.getContents())if(i!=null&&i.getType()==Material.COBBLESTONE)stored+=i.getAmount();
                for(var i:p.getInventory().getContents())if(i!=null&&i.getType()==Material.COBBLESTONE)carried+=i.getAmount();
                sender.sendMessage("BACKPACK_PLATFORM size="+inv.getSize()+" stored="+stored+" carried="+carried+" holder="+inv.getHolder());return true;
            }
        });
        Bukkit.getPluginManager().registerEvents(new Listener(){
            @EventHandler(priority=EventPriority.MONITOR)public void click(InventoryClickEvent e){
                if(e.getWhoClicked().getName().equals("ag_BP1030Fix"))getLogger().info("BACKPACK_CLICK raw="+e.getRawSlot()+" action="+e.getAction()+" result="+e.getResult()+" cancelled="+e.isCancelled());
            }
        },this);
    }
    void run(CommandSender sender)throws ReflectiveOperationException {
        var plugin=Bukkit.getPluginManager().getPlugin("AgentFriend");
        Method sync=plugin.getClass().getDeclaredMethod("syncCompass",Player.class,Location.class);sync.setAccessible(true);
        Field saved=plugin.getClass().getDeclaredField("savedCompassTargets");saved.setAccessible(true);
        @SuppressWarnings("unchecked") Map<UUID,Location> values=(Map<UUID,Location>)saved.get(plugin);
        UUID id=UUID.randomUUID();World world=Bukkit.getWorlds().getFirst();Location target=new Location(world,101,95,100);Location[] current={null};int[] writes={0};
        Player viewer=(Player)Proxy.newProxyInstance(Player.class.getClassLoader(),new Class<?>[]{Player.class},(proxy,method,args)->switch(method.getName()){
            case "getUniqueId"->id;case "getWorld"->world;case "getCompassTarget"->current[0];
            case "setCompassTarget"->{current[0]=((Location)args[0]).clone();writes[0]++;yield null;}
            case "toString"->"CompassPlatformFixture";case "hashCode"->id.hashCode();case "equals"->proxy==args[0];default->null;
        });
        int passed=0;
        try {
            sync.invoke(plugin,viewer,target);if(writes[0]!=1||!target.equals(current[0]))throw new IllegalStateException("null target was not initialised");passed++;
            sync.invoke(plugin,viewer,target);if(writes[0]!=1)throw new IllegalStateException("unchanged compass was rewritten");passed++;
            current[0]=new Location(null,0,0,0);sync.invoke(plugin,viewer,target);if(writes[0]!=2)throw new IllegalStateException("null world not repaired");passed++;
            current[0]=new Location(world,99,95,99);values.remove(id);sync.invoke(plugin,viewer,target);if(!values.get(id).equals(new Location(world,99,95,99)))throw new IllegalStateException("original target lost");passed++;
        }finally{values.remove(id);}
        sender.sendMessage("COMPASS_PLATFORM checks="+passed+" allPassed=true worldWrites=0");
    }
}
