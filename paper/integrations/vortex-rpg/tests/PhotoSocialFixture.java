package org.qiandengji.vortex.tests;
import java.nio.file.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.plugin.java.JavaPlugin;
/** A temporary photo permission for one own test actor, without granting OP. */
public final class PhotoSocialFixture extends JavaPlugin {
    @Override public void onEnable(){
        try{if(!getServer().getIp().equals("127.0.0.1")||getServer().getPort()!=29397
            ||!Files.readString(Path.of(".communication-qa")).strip().equals("127.0.0.1:29397 20261030"))throw new IllegalStateException("Own loopback only");}
        catch(java.io.IOException e){throw new IllegalStateException(e);}
        getServer().getCommandMap().register("photosocialfixture",new Command("socialqa"){
            @Override public boolean execute(CommandSender s,String label,String[]args){
                if(!(s instanceof ConsoleCommandSender)&&!(s instanceof RemoteConsoleCommandSender))return false;
                if(args.length!=1||!args[0].matches("ag_PS[a-z0-9]{3,10}"))throw new IllegalArgumentException("Own actor only");
                var p=Bukkit.getPlayerExact(args[0]);if(p==null||p.isOp())throw new IllegalStateException("Own ordinary actor required");
                p.addAttachment(PhotoSocialFixture.this,"imageframe.create",true);p.recalculatePermissions();
                s.sendMessage("SOCIAL_QA ordinary="+!p.isOp()+" photo="+p.hasPermission("imageframe.create"));return true;
            }});
    }
}
