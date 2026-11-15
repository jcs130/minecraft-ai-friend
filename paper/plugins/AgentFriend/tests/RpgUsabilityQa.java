package qa;

import com.google.gson.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.Chest;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;

/** Synthetic inventory/quest setup only. Actual menu clicks and claims come from ordinary clients. */
public final class RpgUsabilityQa extends JavaPlugin {
    private JavaPlugin af;
    static Object call(Object o,String name,Object...args)throws Exception{
        Method m=Arrays.stream(o.getClass().getDeclaredMethods()).filter(x->x.getName().equals(name)&&x.getParameterCount()==args.length).findFirst().orElseThrow();m.setAccessible(true);return m.invoke(o,args);
    }
    @Override public void onEnable(){
        try{if(!Bukkit.getIp().equals("127.0.0.1")||Bukkit.getPort()!=26461||!Files.readString(Path.of(".player-navigation-qa")).equals("SYNTHETIC_PLAYER_NAVIGATION_ONLY"))throw new IllegalStateException("Marked isolated server required");}catch(Exception e){throw new IllegalStateException(e);}
        af=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");
        Bukkit.getCommandMap().register("usabilityqa",new Command("usabilityqa"){
            public boolean execute(CommandSender sender,String label,String[] args){
                if(sender instanceof Player||args.length!=1)return false;
                try{run(args[0]);sender.sendMessage("USABILITY_QA "+state());}catch(Exception e){sender.sendMessage("USABILITY_QA_ERROR "+e);}
                return true;
            }
        });
    }
    Player actor(){return Objects.requireNonNull(Bukkit.getPlayerExact("NavActorQA"));}
    Player target(){return Objects.requireNonNull(Bukkit.getPlayerExact("NavTargetQA"));}
    void run(String action)throws Exception{
        var a=actor();Object dungeon=call(af,"dungeon");Object storage=call(dungeon,"storage");
        switch(action){
            case "stash-seed"->{
                for(var p:List.of(a,target())){p.setOp(false);p.setGameMode(GameMode.SURVIVAL);p.closeInventory();}
                for(int i=0;i<540;i++){call(storage,"set",a.getUniqueId(),i,null);call(storage,"set",target().getUniqueId(),i,null);}
                call(storage,"set",a.getUniqueId(),539,new ItemStack(Material.DIAMOND_SWORD));
                call(storage,"set",target().getUniqueId(),539,new ItemStack(Material.APPLE,3));
                for(var p:List.of(a,target()))for(int page=0;page<10;page++)call(storage,"write",call(storage,"page",p.getUniqueId(),page),p.getUniqueId());
                af.saveConfig();
            }
            case "shared-floor"->{
                World w=Bukkit.getWorld("world");
                Path receipt=af.getDataFolder().toPath().resolve("trial-shared-installed.txt");
                if(Files.exists(receipt)){
                    if(!Set.of("planned-v1\n","installed-v1\n").contains(Files.readString(receipt)))throw new IllegalStateException("Unknown installation retained");
                    for(int x=-583;x<=-582;x++)for(int z:new int[]{-314,-311,-308}){
                        var block=w.getBlockAt(x,91,z);
                        if(block.getState() instanceof org.bukkit.block.Container c){
                            if(!c.getInventory().isEmpty())throw new IllegalStateException("Nonempty synthetic container retained");
                            block.setType(Material.AIR,false);
                        }
                    }
                    Files.delete(receipt); // Only empty fixed fixture chests in the marked loopback world.
                }
                for(int x=-586;x<=-579;x++)for(int z=-316;z<=-306;z++)for(int y=90;y<=94;y++){
                    var b=w.getBlockAt(x,y,z);if(b.getState() instanceof org.bukkit.block.Container)throw new IllegalStateException("Existing container retained");
                    b.setType(y==90?Material.STONE:Material.AIR,false);
                }
                a.teleport(new Location(w,-583,91,-313));target().teleport(new Location(w,-584,91,-313));
            }
            case "shared-seed"->{
                var c=(Chest)Bukkit.getWorld("world").getBlockAt(-583,91,-314).getState();
                if(c.getInventory().getSize()!=54)throw new IllegalStateException("Real double chest required");
                c.getInventory().clear();c.getInventory().setItem(0,new ItemStack(Material.ARROW,12));
            }
            case "shared-near"->{a.teleport(new Location(Bukkit.getWorld("world"),-583,91,-313));target().teleport(new Location(Bukkit.getWorld("world"),-584,91,-313));}
            case "quest-progress"->{
                Object vortex=Bukkit.getPluginManager().getPlugin("VortexRPG"),quests=call(vortex,"qiandengjiQuests");
                Class<?> type=vortex.getClass().getClassLoader().loadClass("io.vortexcore.quest.QuestObjectiveType");
                Object kill=Arrays.stream(type.getEnumConstants()).filter(e->e.toString().equals("KILL_MOB")).findFirst().orElseThrow();
                call(quests,"progressObjectiveByType",a,kill,"zombie",5);call(quests,"progressObjectiveByType",a,kill,"skeleton",3);
            }
            case "shared-break"->{
                var b=Bukkit.getWorld("world").getBlockAt(-583,91,-314);var event=new org.bukkit.event.block.BlockBreakEvent(b,a);Bukkit.getPluginManager().callEvent(event);
                a.sendMessage("QA_SHARED_BREAK_CANCELLED="+event.isCancelled());
            }
            case "status"->{}
            default->throw new IllegalArgumentException("Unknown setup action");
        }
    }
    JsonObject state()throws Exception{
        var out=new JsonObject();var a=actor();Object dungeon=call(af,"dungeon"),storage=call(dungeon,"storage");
        out.addProperty("actorPage",(Integer)call(dungeon,"openStashPage",a));out.addProperty("actorPage10",String.valueOf(call(storage,"item",a.getUniqueId(),539)));
        out.addProperty("targetPage10",String.valueOf(call(storage,"item",target().getUniqueId(),539)));
        out.addProperty("actorOp",a.isOp());out.addProperty("slots",a.getOpenInventory().getTopInventory().getSize());
        JsonArray boxes=new JsonArray();for(int z:new int[]{-314,-311,-308}){var b=Bukkit.getWorld("world").getBlockAt(-583,91,z);boxes.add(b.getState() instanceof Chest c?c.getInventory().getSize():0);}out.add("sharedSlots",boxes);
        return out;
    }
}
