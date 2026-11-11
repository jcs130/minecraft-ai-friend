package local.tlmcompat.qa;

import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import java.nio.file.*;
import java.util.*;

/** Only injects a synthetic ASR receipt into the marked loopback test server. */
public final class ConversationRangeQa extends JavaPlugin {
    @Override public void onEnable(){
        try{if(Bukkit.getPort()!=25938||!Files.readString(Path.of(".maid-lifecycle-qa")).equals("FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA"))throw new IllegalStateException("Marked QA world required");}
        catch(Exception error){throw new IllegalStateException(error);}
        getCommand("rangeqa").setExecutor((sender,command,label,args)->{
            if(sender instanceof Player||args.length!=2)return false;
            try{
                Player actor=Bukkit.getPlayerExact(args[0]);if(actor==null||!Set.of("MaidBrainQA","MaidVisitorQA").contains(actor.getName()))return false;
                double range=Double.parseDouble(args[1]);if(range!=16&&range!=32)return false;
                var at=actor.getLocation();long now=System.currentTimeMillis();
                var bridge=Bukkit.getPluginManager().getPlugin("QiandengjiMaidBridge");
                bridge.getClass().getMethod("acceptNearbyVoice",UUID.class,UUID.class,UUID.class,long.class,long.class,double[].class,double.class,String.class,Set.class)
                    .invoke(bridge,actor.getUniqueId(),actor.getWorld().getUID(),UUID.randomUUID(),now-1000,now-300,
                        new double[]{at.getX(),at.getY(),at.getZ(),at.getX(),at.getY(),at.getZ()},range,"隔离肥鱼，聊聊眼前的路。",Set.of(actor.getUniqueId()));
                sender.sendMessage("QA_ASR_RECEIPT_INJECTED");return true;
            }catch(Exception error){throw new RuntimeException(error);}
        });
    }
}
