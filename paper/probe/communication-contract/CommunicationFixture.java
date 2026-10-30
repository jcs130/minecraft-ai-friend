package org.qdqa;

import com.earth2me.essentials.Essentials;
import com.google.gson.*;
import java.lang.reflect.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.*;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;

/** Exclusively a disposable loopback Paper integration fixture. */
public final class CommunicationFixture extends JavaPlugin implements CommandExecutor {
    private final Map<UUID,org.bukkit.permissions.PermissionAttachment> attachments=new HashMap<>();
    private Zombie zombie;
    @Override public void onEnable(){
        if(Bukkit.getPort()!=29395||!Bukkit.getIp().equals("127.0.0.1"))throw new IllegalStateException("isolated_qa_only");
        getCommand("qd_comm_fixture").setExecutor(this);
    }
    private Essentials essentials(){return (Essentials)Bukkit.getPluginManager().getPlugin("Essentials");}
    private Object mana()throws Exception{var vortex=Bukkit.getPluginManager().getPlugin("VortexRPG");return vortex.getClass().getMethod("qiandengjiMana").invoke(vortex);}
    private JsonObject policy(Player p)throws Exception{
        var af=Bukkit.getPluginManager().getPlugin("AgentFriend");
        Class<?> type=Class.forName("org.afuhome.agentfriend.AgentChatPolicy",true,af.getClass().getClassLoader());
        var method=type.getDeclaredMethod("observe",af.getClass(),Player.class);method.setAccessible(true);
        return (JsonObject)method.invoke(null,af,p);
    }
    private static void check(boolean result,String name){if(!result)throw new IllegalStateException(name);}
    @Override public boolean onCommand(CommandSender out,Command cmd,String label,String[] args){
        if(!(out instanceof ConsoleCommandSender)&&!(out instanceof RemoteConsoleCommandSender))return true;
        try{
            String action=args[0];Player p=args.length>1?Bukkit.getPlayerExact(args[1]):null;
            if(action.equals("setup")){
                World world=Bukkit.getWorld("world");
                world.setGameRule(GameRule.DO_MOB_SPAWNING,false);world.setGameRule(GameRule.DO_DAYLIGHT_CYCLE,false);world.setTime(6000);
                String[] names={"ag_CommAlice","ag_CommBob","ag_CommFar"};int[] xs={0,16,160};
                for(int i=0;i<names.length;i++){
                    Player a=Bukkit.getPlayerExact(names[i]);check(a!=null,"missing_test_player");a.setOp(false);a.setGameMode(GameMode.SURVIVAL);a.setInvulnerable(true);
                    for(int dx=-2;dx<=2;dx++)for(int dz=-2;dz<=2;dz++){
                        world.getBlockAt(xs[i]+dx,67,dz).setType(Material.STONE,false);
                        for(int y=68;y<=71;y++)world.getBlockAt(xs[i]+dx,y,dz).setType(Material.AIR,false);
                    }
                    a.teleport(new Location(world,xs[i]+.5,68,.5));
                    var attach=a.addAttachment(this);attach.setPermission("essentials.chat.shout",true);attach.setPermission("essentials.msg",true);
                    attach.setPermission("essentials.chat.ignoreexempt",false);attachments.put(a.getUniqueId(),attach);
                    essentials().getUser(a).setToggleShout(false);essentials().getUser(a).setMuted(false);
                }
                out.sendMessage("COMM_READY");return true;
            }
            check(p!=null,"test_player_required");
            if(action.equals("state")){
                var state=new JsonObject();state.addProperty("world",p.getWorld().getUID().toString());state.addProperty("x",p.getLocation().getX());state.addProperty("z",p.getLocation().getZ());
                state.addProperty("food",p.getFoodLevel());int logs=0;for(var item:p.getInventory().getContents())if(item!=null&&item.getType()==Material.OAK_LOG)logs+=item.getAmount();state.addProperty("logs",logs);
                state.addProperty("wallet",essentials().getUser(p).getMoney());var items=new TreeMap<String,Integer>();for(var item:p.getInventory().getContents())if(item!=null)items.merge(item.getType().name(),item.getAmount(),Integer::sum);state.add("items",new Gson().toJsonTree(items));
                var vortex=Bukkit.getPluginManager().getPlugin("VortexRPG");
                if(vortex!=null&&vortex.isEnabled()){var mana=mana();state.addProperty("mana",(Number)mana.getClass().getMethod("getMana",UUID.class).invoke(mana,p.getUniqueId()));}
                state.addProperty("zombieHealth",zombie==null||!zombie.isValid()?0:zombie.getHealth());out.sendMessage("COMM_STATE "+state);return true;
            }
            if(action.equals("effects")){
                // Previous disposable runs can leave overlapping frozen targets.
                // Clear only this QA pad before measuring one real spell target.
                for(var entity:p.getWorld().getNearbyEntities(p.getLocation(),8,4,8))if(entity instanceof Monster)entity.remove();
                p.getInventory().clear();p.getInventory().setItem(0,new ItemStack(Material.DIAMOND_SWORD));p.getInventory().setHeldItemSlot(0);p.setFoodLevel(8);p.setSaturation(0);
                var mana=mana();mana.getClass().getMethod("refillFull",UUID.class).invoke(mana,p.getUniqueId());
                Location at=p.getLocation().clone().add(0,0,4);zombie=p.getWorld().spawn(at,Zombie.class,z->{z.setAI(false);z.setSilent(true);z.setAdult();z.addScoreboardTag("qd_comm_effect_fixture");z.getEquipment().setHelmet(new ItemStack(Material.CARVED_PUMPKIN));});
                Location facing=p.getLocation();facing.setDirection(zombie.getLocation().add(0,1,0).toVector().subtract(p.getEyeLocation().toVector()));p.teleport(facing);out.sendMessage("COMM_EFFECTS_READY");return true;
            }
            if(action.equals("policy")){out.sendMessage("COMM_POLICY "+policy(p));return true;}
            if(action.equals("guide")){
                var af=Bukkit.getPluginManager().getPlugin("AgentFriend");var getter=af.getClass().getDeclaredMethod("communication");getter.setAccessible(true);var service=getter.invoke(af);
                var guide=service.getClass().getDeclaredMethod("welcome",Player.class);guide.setAccessible(true);guide.invoke(service,p);out.sendMessage("COMM_GUIDE_SENT");return true;
            }
            if(action.equals("permissions")){attachments.get(p.getUniqueId()).setPermission("essentials.chat.shout",Boolean.parseBoolean(args[2]));p.recalculatePermissions();out.sendMessage("COMM_PERMISSION_SET "+new Gson().toJson(Map.of("bukkit",p.hasPermission("essentials.chat.shout"),"native",essentials().getUser(p).isAuthorized("essentials.chat.shout"))));return true;}
            if(action.equals("mute")){essentials().getUser(p).setMuted(Boolean.parseBoolean(args[2]));out.sendMessage("COMM_MUTED_SET");return true;}
            if(action.equals("ignore")){essentials().getUser(p).setIgnoredPlayer(essentials().getUser(Bukkit.getPlayerExact(args[2])),Boolean.parseBoolean(args[3]));out.sendMessage("COMM_IGNORE_SET");return true;}
            if(action.equals("world")){
                World world=Bukkit.getWorld(args[2]);check(world!=null,"test_world_required");
                for(int dx=-2;dx<=2;dx++)for(int dz=-2;dz<=2;dz++)world.getBlockAt(dx,67,dz).setType(Material.STONE,false);
                int x=p.getName().equals("ag_CommBob")&&world.getName().equals("world")?16:0;
                p.teleport(new Location(world,x+.5,68,.5));out.sendMessage("COMM_WORLD_SET");return true;
            }
            if(action.equals("settings")){
                var file=new java.io.File(essentials().getDataFolder(),"config.yml");var cfg=YamlConfiguration.loadConfiguration(file);
                cfg.set("chat.radius",Integer.parseInt(args[2]));cfg.set("chat.shout-default",Boolean.parseBoolean(args[3]));cfg.set("chat.persist-shout",Boolean.parseBoolean(args[4]));cfg.save(file);essentials().reload();
                out.sendMessage("COMM_SETTINGS_SET "+essentials().getSettings().getChatRadius());return true;
            }
            if(action.equals("nochat")){
                var chat=Bukkit.getPluginManager().getPlugin("EssentialsChat");Bukkit.getPluginManager().disablePlugin(chat);
                try{var result=policy(p);check(result.get("defaultChannel").getAsString().equals("unknown"),"missing_chat_must_be_unknown");out.sendMessage("COMM_UNKNOWN_OK "+result);}
                finally{Bukkit.getPluginManager().enablePlugin(chat);}return true;
            }
            if(action.equals("worldfacts")){
                var values=new ArrayList<JsonObject>();
                for(UUID id:List.of(UUID.randomUUID(),UUID.randomUUID())){
                    World world=(World)Proxy.newProxyInstance(World.class.getClassLoader(),new Class[]{World.class},(proxy,method,arguments)->switch(method.getName()){
                        case "getKey"->NamespacedKey.minecraft("overworld");case "getUID"->id;default->method.invoke(p.getWorld(),arguments);});
                    Player wrapped=(Player)Proxy.newProxyInstance(Player.class.getClassLoader(),new Class[]{Player.class},(proxy,method,arguments)->method.getName().equals("getWorld")?world:method.invoke(p,arguments));
                    values.add(policy(wrapped));
                }
                check(values.get(0).get("worldKey").equals(values.get(1).get("worldKey")),"same_key_fixture");
                check(!values.get(0).get("worldUuid").equals(values.get(1).get("worldUuid")),"world_uuid_must_distinguish_instances");out.sendMessage("COMM_WORLD_IDENTITY_OK");return true;
            }
            throw new IllegalArgumentException("unknown_fixture_action");
        }catch(Throwable error){out.sendMessage("COMM_QA_ERROR "+error);error.printStackTrace();return true;}
    }
}
