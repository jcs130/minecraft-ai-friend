package local.tlmcompat.qa;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import org.bukkit.Bukkit;
import org.bukkit.craftbukkit.entity.CraftEntity;
import org.bukkit.plugin.java.JavaPlugin;
import java.util.Set;
import java.util.UUID;

/** Console-only stimulus for a marked loopback QA world; never shipped in the bridge. */
public final class ShortDialogueQa extends JavaPlugin {
    @Override public void onEnable(){
        if(Bukkit.getPort()!=25938)throw new IllegalStateException("Synthetic QA port required");
        getCommand("shortdialogueqa").setExecutor((sender,command,label,args)->{
            if(sender instanceof org.bukkit.entity.Player||args.length!=3)return false;
            try{
                var entity=Bukkit.getEntity(UUID.fromString(args[0]));
                if(entity==null||!(((CraftEntity)entity).getHandle() instanceof EntityMaid maid))return false;
                var bridge=Bukkit.getPluginManager().getPlugin("QiandengjiMaidBridge");
                var method=bridge.getClass().getDeclaredMethod("speakPublicReply",EntityMaid.class,String.class,String.class,Set.class);
                method.setAccessible(true);
                var audience=Set.of(UUID.fromString(args[1]));
                if(!args[2].matches("sq_[a-zA-Z0-9_]{1,36}"))return false;
                method.invoke(bridge,maid,args[2],"可米，先看清前面的路再走吧。",audience);
                sender.sendMessage("QA_ORIGINAL_SPEECH_REQUEST "+args[2]);return true;
            }catch(Exception error){throw new RuntimeException(error);}
        });
    }
}
