package local.tlmcompat.qa;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.network.message.PlayMaidSoundPackage;
import net.minecraft.resources.ResourceLocation;
import org.bukkit.Bukkit;
import org.bukkit.craftbukkit.entity.CraftEntity;
import org.bukkit.plugin.java.JavaPlugin;

/** Test-only sound stimulus. Never included in the candidate bridge or production. */
public final class CompanionSpeechQa extends JavaPlugin implements org.bukkit.event.Listener {
    @Override public void onEnable(){
        if(Bukkit.getPort()!=25938)throw new IllegalStateException("Synthetic QA port required");
        Bukkit.getPluginManager().registerEvents(this,this);
        getCommand("speechqa").setExecutor((sender,command,label,args)->{
            if(sender instanceof org.bukkit.entity.Player||Bukkit.getPort()!=25938||args.length!=2)return false;
            var entity=Bukkit.getEntity(java.util.UUID.fromString(args[1]));
            if(entity==null||!(((CraftEntity)entity).getHandle() instanceof EntityMaid maid))return false;
            if(args[0].equals("quiet")){maid.getConfigManager().setSoundFreq(0);sender.sendMessage("synthetic_ambient_disabled");return true;}
            if(args[0].equals("ambient")){
                float frequency=maid.getConfigManager().getSoundFreq();maid.getConfigManager().setSoundFreq(1);
                try{
                local.tlmcompat.nativebridge.NativePayloads.sendToAllPlayers(new PlayMaidSoundPackage(ResourceLocation.parse("touhou_little_maid:maid.mode.idle"),maid.getSoundPackId(),maid.getId()));
                }finally{maid.getConfigManager().setSoundFreq(frequency);}
                sender.sendMessage("synthetic_sound_sent");return true;
            }return false;
        });
    }
    @org.bukkit.event.EventHandler
    public void joined(org.bukkit.event.player.PlayerJoinEvent event){
        var permissions=event.getPlayer().addAttachment(this);
        permissions.setPermission("essentials.chat.shout",true);
        permissions.setPermission("essentials.msg",true);
    }
}
