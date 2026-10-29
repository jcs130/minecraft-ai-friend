package org.qiandengji.chatqa;

import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.permissions.PermissionAttachment;
import org.bukkit.plugin.java.JavaPlugin;

/** Test fixture only. All chat delivery is performed by official EssentialsXChat. */
public final class ChatQA extends JavaPlugin implements Listener {
    private final Map<UUID,PermissionAttachment> permissions=new HashMap<>();
    public void onEnable(){
        try{
            if(Bukkit.getPort()!=29086||!Files.readString(Path.of(".qa-only")).equals("QIANDENGJI_CHAT_QA_ONLY"))throw new IllegalStateException("Marked local QA only");
            Bukkit.createWorld(new WorldCreator("aincrad").type(WorldType.FLAT).generateStructures(false));
            Bukkit.getPluginManager().registerEvents(this,this);
            getCommand("chatqa").setExecutor(this::command);
        }catch(Exception failure){getServer().getPluginManager().disablePlugin(this);throw new IllegalStateException(failure);}
    }
    // Production voice also has a legacy listener; retain that event bridge in QA.
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void legacy(AsyncPlayerChatEvent event) {}
    private boolean command(CommandSender sender,Command command,String label,String[] args){
        if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return false;
        if(args.length<2||!args[1].matches("ChatQA[A-C]"))return false;
        Player p=Bukkit.getPlayerExact(args[1]);if(p==null){sender.sendMessage("offline");return true;}
        try{
            switch(args[0]){
                case "at"->{
                    if(args.length!=6||!Set.of("world","aincrad").contains(args[2]))throw new IllegalArgumentException();
                    double x=Double.parseDouble(args[3]),y=Double.parseDouble(args[4]),z=Double.parseDouble(args[5]);
                    if(!Double.isFinite(x+y+z)||Math.abs(x)>256||Math.abs(z)>256||y<0||y>120)throw new IllegalArgumentException();
                    p.teleport(new Location(Objects.requireNonNull(Bukkit.getWorld(args[2])),x,y,z));p.setGameMode(GameMode.CREATIVE);p.setFlying(true);
                }
                case "permission"->{
                    if(args.length!=4||!args[2].startsWith("essentials."))throw new IllegalArgumentException();
                    permissions.computeIfAbsent(p.getUniqueId(),id->p.addAttachment(this)).setPermission(args[2],Boolean.parseBoolean(args[3]));
                }
                case "speak"->{if(args.length<3)throw new IllegalArgumentException();p.chat(String.join(" ",Arrays.copyOfRange(args,2,args.length)));}
                case "op"->{if(args.length!=3)throw new IllegalArgumentException();p.setOp(Boolean.parseBoolean(args[2]));}
                case "where"->sender.sendMessage(p.getWorld().getKey()+" "+p.getLocation().getBlockX()+","+p.getLocation().getBlockY()+","+p.getLocation().getBlockZ());
                case "party"->{
                    if(args.length<3)throw new IllegalArgumentException();
                    var bridge=Objects.requireNonNull(Bukkit.getPluginManager().getPlugin("QiandengjiRpg"));
                    bridge.getClass().getMethod("partyCommand",Player.class,String[].class).invoke(bridge,p,Arrays.copyOfRange(args,2,args.length));
                }
                case "intro"->{
                    var bridge=Objects.requireNonNull(Bukkit.getPluginManager().getPlugin("QiandengjiRpg"));
                    bridge.getClass().getMethod("describeJourney",Player.class,String.class,boolean.class,boolean.class).invoke(bridge,p,"{}",true,true);
                }
                default->throw new IllegalArgumentException();
            }
            sender.sendMessage("CHAT_QA_OK");return true;
        }catch(Exception failure){sender.sendMessage("CHAT_QA_REJECTED");return true;}
    }
}
