package local.qdqa;
import com.worldevents.managers.BossBarManager;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import net.kyori.adventure.bossbar.BossBar;
/** The real WorldEvents producer, restricted to three synthetic loopback players. */
public final class ActivityBarQa extends JavaPlugin {
    private BossBarManager bars;
    private static final Set<String> NAMES=Set.of("BossActorAQA","BossActorBQA","BossEyeQA");
    public void onEnable(){
        try{if(Bukkit.getPort()!=25956||!Bukkit.getIp().equals("127.0.0.1")||!Files.readString(Path.of(".eye-bossbar-qa")).trim().equals("isolated eye bossbar QA only"))throw new IllegalStateException("Synthetic loopback fixture only");}catch(Exception e){throw new IllegalStateException(e);}
        if(!Bukkit.getPluginManager().isPluginEnabled("AgentFriend")||!Bukkit.getPluginManager().isPluginEnabled("CortiEyeMirror"))throw new IllegalStateException("Both real producer/filter and mirror must be enabled");
        bars=new BossBarManager((JavaPlugin)Bukkit.getPluginManager().getPlugin("WorldEvents"));
        getCommand("activityqa").setExecutor((sender,command,label,args)->{
            if(sender instanceof Player||args.length<2||!NAMES.contains(args[1]))return false;
            Player p=Bukkit.getPlayerExact(args[1]);if(p==null)return false;
            try{
                if(args[0].equals("remove")){bars.removeBar(p,"qa_activity");sender.sendMessage("ACTIVITY_QA removed");return true;}
                if(args.length!=5)return false;
                String name=switch(args[2]){case "gather"->"☆ 冒险者集结·探索留影";case "boss"->"双生首领";case "rescue"->"试炼救援";case "quest"->"任务 · 冒险者集结·探索留影";default->throw new IllegalArgumentException("fixture kind");};
                int time=Integer.parseInt(args[3]);float progress=Float.parseFloat(args[4]);if(time<0||time>3600||!Float.isFinite(progress)||progress<0||progress>1)return false;
                String title=name+" | "+String.format(java.util.Locale.ROOT,"%02d:%02d",time/60,time%60);
                if(args[0].equals("show"))bars.showBar(p,"qa_activity",title,BossBar.Color.GREEN,BossBar.Overlay.PROGRESS,progress);
                else if(args[0].equals("update")){bars.setTitle(p,"qa_activity",title);bars.setProgress(p,"qa_activity",progress);}else return false;
                sender.sendMessage("ACTIVITY_QA "+args[0]);
            }catch(Exception error){sender.sendMessage("ACTIVITY_QA_ERROR "+error);}
            return true;
        });
    }
    public void onDisable(){if(bars!=null)bars.cleanup();}
}
