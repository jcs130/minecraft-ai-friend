package org.qiandengji.vortex;

import java.util.*;
import org.bukkit.command.*;
import org.bukkit.plugin.java.JavaPlugin;

/** Reversible guard for the native auction's reproduced charge-without-delivery bug. */
public final class AuctionSafety {
    public static final String MESSAGE="[RPG] [auction_unavailable] 玩家拍卖暂时维护：原生交付未通过验收；本次未上架、未扣款、未移走物品。金币查询：/mycli trade wallet；公共补给：/mycli guild shared";
    private record Installed(PluginCommand command,CommandExecutor original,CommandExecutor guard){}
    private final List<Installed> installed=new ArrayList<>();
    public static boolean blocked(String name,String[] args){
        name=name.toLowerCase(Locale.ROOT);int colon=name.lastIndexOf(':');if(colon>=0)name=name.substring(colon+1);
        return Set.of("auction","ah").contains(name)||Set.of("vortex","vrp","vortexrpg").contains(name)&&args.length>0&&Set.of("auction","ah").contains(args[0].toLowerCase(Locale.ROOT));
    }
    public void install(JavaPlugin nativePlugin){
        var seen=new HashSet<PluginCommand>();
        for(String name:List.of("auction","ah","vortex","vrp","vortexrpg")){
            var command=nativePlugin.getCommand(name);if(command==null||!seen.add(command))continue;
            var original=command.getExecutor();CommandExecutor guard=(sender,cmd,label,args)->{
                if(blocked(command.getName(),args)||blocked(label,args)){sender.sendMessage(MESSAGE);return true;}
                return original.onCommand(sender,cmd,label,args);
            };
            installed.add(new Installed(command,original,guard));command.setExecutor(guard);
        }
    }
    public void restore(){for(var item:installed)if(item.command().getExecutor()==item.guard())item.command().setExecutor(item.original());installed.clear();}
}
