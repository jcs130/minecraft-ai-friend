package local.tlmcompat.qa;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonObject;
import org.bukkit.Bukkit;
import org.bukkit.craftbukkit.entity.CraftEntity;
import org.bukkit.plugin.java.JavaPlugin;

/** Console-only diagnostics for the synthetic loopback fixture. Never ship in production. */
public final class FollowRadiusQa extends JavaPlugin {
    public void onEnable(){
        if(Bukkit.getPort()!=25938||!java.nio.file.Files.exists(java.nio.file.Path.of(".maid-lifecycle-qa")))throw new IllegalStateException("Synthetic loopback fixture only");
        getCommand("followqa").setExecutor((sender,command,label,args)->{
            if(sender instanceof org.bukkit.entity.Player||args.length!=1)return false;
            var entity=Bukkit.getEntity(java.util.UUID.fromString(args[0]));
            if(!(entity instanceof CraftEntity craft)||!(craft.getHandle() instanceof EntityMaid maid))return false;
            JsonObject out=new JsonObject();out.addProperty("restrictRadius",maid.getRestrictRadius());
            out.addProperty("home",maid.isHomeModeEnable());out.addProperty("sitting",maid.isMaidInSittingPose());
            out.addProperty("uuid",maid.getUUID().toString());
            sender.sendMessage("FOLLOW_QA "+out);return true;
        });
    }
}
