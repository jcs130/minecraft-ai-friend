import java.lang.reflect.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Only seeds fictitious receipts in the named, loopback-only integration server. */
public final class DungeonReceiptQA extends JavaPlugin {
    private JavaPlugin friend;
    public void onEnable(){
        if(Bukkit.getPort()!=25664||!Bukkit.getIp().equals("127.0.0.1")||!Bukkit.getMotd().equals("Dungeon receipt isolated check"))throw new IllegalStateException("Isolated only");
        friend=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");getCommand("receiptqa").setExecutor(this::command);
    }
    private Object call(Object o,String name,Object... args)throws Exception {
        Method m=Arrays.stream(o.getClass().getDeclaredMethods()).filter(x->x.getName().equals(name)&&x.getParameterCount()==args.length).findFirst().orElseThrow();
        m.setAccessible(true);return m.invoke(o,args);
    }
    private boolean command(CommandSender s,Command c,String label,String[] args){
        if(!(s instanceof ConsoleCommandSender||s instanceof RemoteConsoleCommandSender))return true;
        try{
            var config=friend.getConfig();Object manager=call(friend,"siteDungeons");
            if(args[0].equals("reset")){
                Field f=manager.getClass().getDeclaredField("runs");f.setAccessible(true);
                for(Object run:new ArrayList<>(((Map<?,?>)f.get(manager)).values()))call(manager,"end",run,"isolated_reset");
                config.set("site-dungeons",null);
            }else if(args[0].equals("muster")){
                Field f=manager.getClass().getDeclaredField("runs");f.setAccessible(true);
                for(Object run:((Map<?,?>)f.get(manager)).values()){Field t=run.getClass().getDeclaredField("readyAt");t.setAccessible(true);t.setLong(run,System.currentTimeMillis()+120_000);}
            }else if(args[0].equals("cooldown"))config.set("site-dungeons.cooldowns",null);
            else{
                Player p=Objects.requireNonNull(Bukkit.getPlayerExact(args[1]));UUID id=p.getUniqueId();
                if(args[0].equals("seed")){
                    String site=args.length>2?args[2]:"undead_crypt";
                    config.createSection("site-dungeons.receipts."+id+"."+site,Map.of("run","6170dc66-0d87-457e-a2bb-3c58a895ea7e","day","2026-10-11","started-at",1791703542319L,"emeralds",8,"item","IRON_INGOT","count",4));
                    config.set("site-dungeons.outcomes."+id,null);
                }else if(args[0].equals("rewards")){
                    Object tower=call(friend,"dungeon");
                    for(Material material:List.of(Material.EMERALD,Material.IRON_INGOT))config.set((String)call(tower,"rewardPath",id,material),args[2].equals("full")?Integer.MAX_VALUE:0);
                }else throw new IllegalArgumentException("unknown fixture");
            }
            friend.saveConfig();s.sendMessage("RECEIPT_QA_OK "+args[0]);
        }catch(Exception e){s.sendMessage("RECEIPT_QA_ERROR "+e);e.printStackTrace();}return true;
    }
}
