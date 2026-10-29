package org.qdqa;

import com.google.gson.*;
import java.lang.reflect.*;
import java.time.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;

/** Disposable loopback QA only. Sets initial fixtures, never invents a clear or reward receipt. */
public final class RpgActivitiesFixture extends JavaPlugin implements CommandExecutor {
    private JavaPlugin owner;
    private final Set<UUID> reportedNativeFailures=new HashSet<>();
    @Override public void onEnable(){
        if(Bukkit.getPort()!=29395||!Bukkit.getIp().equals("127.0.0.1"))throw new IllegalStateException("isolated_qa_only");
        owner=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");getCommand("qd_rpg_fixture").setExecutor(this);
    }
    private Object call(Object value,String name,Class<?>[] types,Object...args)throws Exception{var m=value.getClass().getDeclaredMethod(name,types);m.setAccessible(true);return m.invoke(value,args);}
    private Object dungeon()throws Exception{return call(owner,"dungeon",new Class<?>[]{});}
    private void field(Object value,String name,Object data)throws Exception{var f=value.getClass().getDeclaredField(name);f.setAccessible(true);f.set(value,data);}
    private Object field(Object value,String name)throws Exception{var f=value.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(value);}
    private Player player(String name){if(!Set.of("ag_TrialAlice","ag_TrialBob","ag_TrialEye").contains(name))throw new IllegalArgumentException("qa_role_only");Player p=Bukkit.getPlayerExact(name);if(p==null)throw new IllegalStateException("QA player offline");return p;}
    private void equip(Player p){p.getInventory().clear();p.getInventory().setHelmet(new ItemStack(Material.DIAMOND_HELMET));p.getInventory().setChestplate(new ItemStack(Material.DIAMOND_CHESTPLATE));p.getInventory().setLeggings(new ItemStack(Material.DIAMOND_LEGGINGS));p.getInventory().setBoots(new ItemStack(Material.DIAMOND_BOOTS));p.getInventory().setItem(0,new ItemStack(Material.DIAMOND_SWORD));p.getInventory().setHeldItemSlot(0);p.setFoodLevel(20);}
    @Override public boolean onCommand(CommandSender sender,Command command,String label,String[] args){
        if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return true;
        try{
            String action=args[0];Object d=dungeon();
            if(action.equals("end_prior_qa")){
                for(Object id:(Set<?>)field(d,"participants")){
                    if(!Set.of("ag_TrialAlice","ag_TrialBob","ag_TrialEye").stream().map(name->UUID.nameUUIDFromBytes(("OfflinePlayer:"+name).getBytes(java.nio.charset.StandardCharsets.UTF_8))).anyMatch(id::equals))throw new IllegalStateException("foreign participant");
                }
                if(Boolean.TRUE.equals(field(d,"active")))call(d,"finish",new Class<?>[]{boolean.class,String.class,String.class},false,"qa_reset","Prior disposable QA ended; not a clear");
                sender.sendMessage("RPG_QA_PREVIOUS_ENDED");return true;
            }
            if(action.equals("config")){
                Object coach=field(owner,"agentCoach"),onboarding=field(coach,"onboarding");
                String result=String.valueOf(call(onboarding,"reload",new Class<?>[]{}));
                var config=(org.bukkit.configuration.file.YamlConfiguration)field(onboarding,"settings");
                var out=new JsonObject();out.addProperty("result",result);out.addProperty("releaseRevision",config.getInt("release-revision"));out.addProperty("noticeCount",config.getStringList("release-notice").size());
                sender.sendMessage("RPG_QA_STATE "+out);return true;
            }
            if(action.equals("setup")){
                for(String name:List.of("ag_TrialAlice","ag_TrialBob","ag_TrialEye")){
                    Player p=player(name);p.setOp(false);p.setGameMode(name.endsWith("Eye")?GameMode.CREATIVE:GameMode.SURVIVAL);p.setInvulnerable(true);equip(p);
                    p.teleport(new Location(Bukkit.getWorld("world"),name.endsWith("Alice")?.5:3.5,68,.5));
                }
                Bukkit.getWorld("world").setGameRule(GameRule.DO_DAYLIGHT_CYCLE,false);Bukkit.getWorld("world").setGameRule(GameRule.DO_MOB_SPAWNING,false);
                sender.sendMessage("RPG_QA_READY");return true;
            }
            if(action.equals("build")){
                field(d,"lastRun",0L);owner.getConfig().set("dungeon-last-run",0L);
                World w=Bukkit.getWorld("world");
                // Only two disposable physical rooms are needed to exercise
                // actual enrollment, combat, auto-descent and quest callbacks.
                // The unrelated asynchronous production map builder is not tested.
                for(int floorY:new int[]{68,56})for(int x=-602;x<=-578;x++)for(int z=-317;z<=-293;z++){
                    w.getBlockAt(x,floorY,z).setType(Material.STONE,false);
                    for(int y=floorY+1;y<=floorY+7;y++)w.getBlockAt(x,y,z).setType(x==-602||x==-578||z==-317||z==-293?Material.STONE:Material.AIR,false);
                }
                for(int x=-605;x<=-580;x++)for(int z=-323;z<=-300;z++){
                    w.getBlockAt(x,90,z).setType(Material.STONE,false);
                    for(int y=91;y<=95;y++)w.getBlockAt(x,y,z).setType(Material.AIR,false);
                }
                field(d,"built",true);owner.getConfig().set("dungeon-built",true);owner.getConfig().set("dungeon-building",false);owner.saveConfig();
                sender.sendMessage("RPG_QA_ROOMS_READY");return true;
            }
            if(action.equals("targets")){
                Player p=player("ag_TrialAlice");int count=0;
                for(Object id:(Set<?>)field(d,"mobs")){
                    Entity entity=Bukkit.getEntity((UUID)id);
                    if(entity instanceof LivingEntity living&&living.isValid()&&!living.isDead()){
                        living.setAI(false);living.setFireTicks(0);if(living.getEquipment()!=null)living.getEquipment().setHelmet(new ItemStack(Material.CARVED_PUMPKIN));
                        living.teleport(p.getLocation().clone().add(count%2==0?1.5:-1.5,0,1.5));count++;
                    }
                }
                sender.sendMessage("RPG_QA_TARGETS "+count);return true;
            }
            Player p=player(args[1]);
            if(action.equals("loading_diagnostic")){
                Object vortex=Bukkit.getPluginManager().getPlugin("VortexRPG");Object service=vortex.getClass().getMethod("playerProfileService").invoke(vortex);
                Object scheduler=field(service,"scheduler"),repository=field(service,"repository");
                getLogger().warning("QA load diagnostic: scheduler="+scheduler.getClass().getName()+", online="+p.isOnline()+", valid="+p.isValid()+", loading="+field(service,"loadingPlayers")+", saves="+((Map<?,?>)field(service,"pendingSaves")).size());
                scheduler.getClass().getMethod("runGlobal",String.class,Runnable.class).invoke(scheduler,"qa-load-global",(Runnable)()->getLogger().warning("QA global callback reached: online="+p.isOnline()+", valid="+p.isValid()));
                Object accepted=scheduler.getClass().getMethod("runEntity",Entity.class,String.class,Runnable.class).invoke(scheduler,p,"qa-load-entity",(Runnable)()->getLogger().warning("QA entity callback reached: online="+p.isOnline()+", valid="+p.isValid()));
                var future=(java.util.concurrent.CompletableFuture<?>)repository.getClass().getMethod("loadPlayer",UUID.class).invoke(repository,p.getUniqueId());
                getLogger().warning("QA entity accepted="+accepted+", diskFutureDone="+future.isDone());future.whenComplete((v,e)->getLogger().warning("QA repository callback: error="+e+", snapshot="+(v==null?"null":"present")));
                sender.sendMessage("RPG_QA_DIAGNOSTIC_ARMED");return true;
            }
            if(action.equals("entrance")){p.teleport(new Location(Bukkit.getWorld("world"),args[1].endsWith("Bob")?-594.5:-595.5,91,-312.5));sender.sendMessage("RPG_QA_AT_ENTRANCE");return true;}
            if(action.equals("unequip")){p.getInventory().setHelmet(null);sender.sendMessage("RPG_QA_UNEQUIPPED");return true;}
            if(action.equals("equip")){equip(p);sender.sendMessage("RPG_QA_EQUIPPED");return true;}
            if(action.equals("oldquest")){
                String base="guild-players."+p.getUniqueId();String today=LocalDate.now(ZoneId.of("Asia/Shanghai")).toString();
                owner.getConfig().set(base+".joined",today);owner.getConfig().set(base+".active.id","party_oath");owner.getConfig().set(base+".active.progress",0);owner.getConfig().set(base+".active.accepted",today);
                // Seed only a prior daily-loot limit, never a quest proof.
                // Both floors must still count after actual combat below.
                for(int floor:List.of(1,2))owner.getConfig().set("dungeon-daily-claims."+p.getUniqueId()+"."+floor,p.getWorld().getFullTime()/24000L);
                owner.saveConfig();
                sender.sendMessage("RPG_QA_INITIAL_OLD_QUEST");return true;
            }
            if(action.equals("state")){
                var out=(JsonObject)call(d,"guidance",new Class<?>[]{Player.class},p);
                Object guild=call(owner,"guild",new Class<?>[]{});out.add("guild",(JsonObject)call(guild,"progressState",new Class<?>[]{Player.class},p));
                Object nativeRpg=call(owner,"nativeRpg",new Class<?>[]{});var nativeState=(JsonObject)call(nativeRpg,"state",new Class<?>[]{Player.class},p);out.add("rpg",nativeState);
                if(nativeState.has("available")&&!nativeState.get("available").getAsBoolean()){
                    try{Object adapter=Bukkit.getPluginManager().getPlugin("QiandengjiRpg");adapter.getClass().getMethod("selfState",Player.class).invoke(adapter,p);}
                    catch(Throwable unavailable){Throwable cause=unavailable;while(cause.getCause()!=null)cause=cause.getCause();out.addProperty("rpgFailure",cause.getClass().getName()+": "+cause.getMessage());if(reportedNativeFailures.add(p.getUniqueId()))getLogger().log(java.util.logging.Level.WARNING,"QA native profile diagnostic",cause);}
                }
                var participants=new JsonArray();for(Object id:(Set<?>)field(d,"participants")){Player member=Bukkit.getPlayer((UUID)id);participants.add(member==null?id.toString():member.getName());}out.add("participants",participants);
                out.addProperty("op",p.isOp());sender.sendMessage("RPG_QA_STATE "+out);return true;
            }
            throw new IllegalArgumentException("unknown fixture action");
        }catch(Throwable error){getLogger().warning("QA fixture failure: "+error);sender.sendMessage("RPG_QA_ERROR "+error.getClass().getSimpleName()+":"+error.getMessage());return true;}
    }
}
