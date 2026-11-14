package qa;

import com.google.gson.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;

/** Disposable-world fixture. It sets up encounters; the client sends the real /mycli command. */
public final class PlayerNavigationQa extends JavaPlugin implements Listener {
    private JavaPlugin af;
    private boolean cancel;
    private boolean failCommit;
    private LivingEntity enemy;
    private static Object get(Object o,String key)throws Exception{Field f=o.getClass().getDeclaredField(key);f.setAccessible(true);return f.get(o);}
    private static void set(Object o,String key,Object v)throws Exception{Field f=o.getClass().getDeclaredField(key);f.setAccessible(true);f.set(o,v);}
    private static Object call(Object o,String key,Class<?>[] types,Object... args)throws Exception{Method m=o.getClass().getDeclaredMethod(key,types);m.setAccessible(true);return m.invoke(o,args);}
    private static Object call(Object o,String key)throws Exception{return call(o,key,new Class<?>[0]);}
    @Override public void onEnable(){
        try{
            if(!Files.readString(Path.of(".player-navigation-qa")).equals("SYNTHETIC_PLAYER_NAVIGATION_ONLY")
                    ||!Bukkit.getIp().equals("127.0.0.1")||Bukkit.getPort()!=26461)throw new IllegalStateException("synthetic fixture only");
            af=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");
            Bukkit.getPluginManager().registerEvents(this,this);
            Bukkit.getCommandMap().register("navqa",new Command("navqa"){
                public boolean execute(CommandSender sender,String label,String[] args){
                    if(sender instanceof Player)return false;
                    try{run(sender,args);}catch(Exception e){throw new IllegalStateException(e);}return true;
                }
            });
        }catch(Exception failure){throw new IllegalStateException(failure);}
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void teleport(PlayerTeleportEvent event){
        if(cancel&&event.getPlayer().getName().equals("NavActorQA"))event.setCancelled(true);
        if(failCommit&&event.getPlayer().getName().equals("NavActorQA")){
            failCommit=false;
            try{((Set<String>)get(call(af,"siteDungeons"),"blockedCheckpoints")).add("synthetic_commit_failure");}
            catch(Exception e){throw new IllegalStateException(e);}
        }
    }
    private Player player(String name){return Objects.requireNonNull(Bukkit.getPlayerExact(name));}
    private static void floor(Location at){
        for(int x=-4;x<=4;x++)for(int z=-4;z<=4;z++){
            at.getWorld().getBlockAt(at.getBlockX()+x,at.getBlockY()-1,at.getBlockZ()+z).setType(Material.STONE,false);
            for(int y=0;y<=3;y++)at.getWorld().getBlockAt(at.getBlockX()+x,at.getBlockY()+y,at.getBlockZ()+z).setType(Material.AIR,false);
        }
    }
    private static void gear(Player p){
        p.getInventory().clear();
        p.getInventory().setArmorContents(new ItemStack[]{new ItemStack(Material.IRON_BOOTS),new ItemStack(Material.IRON_LEGGINGS),new ItemStack(Material.IRON_CHESTPLATE),new ItemStack(Material.IRON_HELMET)});
        p.getInventory().setItem(0,new ItemStack(Material.IRON_SWORD));p.getInventory().setItem(1,new ItemStack(Material.BOW));p.getInventory().setItem(2,new ItemStack(Material.ARROW,16));
    }
    @SuppressWarnings("unchecked") private void run(CommandSender sender,String[] args)throws Exception{
        Player actor=player("NavActorQA"),target=player("NavTargetQA");Object trial=call(af,"dungeon"),sites=call(af,"siteDungeons"),rpg=call(af,"nativeRpg");
        switch(args[0]){
            case "setup" -> {
                cancel=false;set(trial,"active",false);((Set<?>)get(trial,"participants")).clear();((Map<?,?>)get(sites,"runs")).clear();
                if(enemy!=null)enemy.remove();((Set<?>)get(trial,"mobs")).clear();
                af.getConfig().set("dungeon-active-run",null);
                ((Map<?,?>)get(af,"teamTeleportAt")).clear();
                for(Player p:List.of(actor,target)){p.setOp(false);p.setGameMode(GameMode.SURVIVAL);gear(p);p.setHealth(Math.min(20,p.getMaxHealth()));p.setFoodLevel(20);}
                World world=Bukkit.getWorld("world");Location departure=new Location(world,0.5,66,.5);floor(departure);actor.teleport(departure);
                Location arrival=new Location(world,-589.5,args[1].equals("trial")?68:90,-304.5);
                if(args[1].equals("site")){
                    var catalog=(Map<String,Object>)get(sites,"sites");Object site=catalog.values().stream().filter(s->{try{return call(s,"id").equals("qa_readiness");}catch(Exception e){return false;}}).findFirst().orElseThrow();
                    Object room=((List<?>)call(site,"rooms")).getFirst();arrival=(Location)call(room,"center",new Class<?>[]{World.class},Bukkit.getWorld((String)call(site,"world")));
                    floor(arrival);target.teleport(arrival);
                    Class<?> mode=af.getClass().getClassLoader().loadClass("org.afuhome.agentfriend.SiteDungeonManager$Mode");
                    Class<?> runClass=af.getClass().getClassLoader().loadClass("org.afuhome.agentfriend.SiteDungeonManager$Run");
                    Constructor<?> ctor=runClass.getDeclaredConstructor(site.getClass(),mode);ctor.setAccessible(true);Object run=ctor.newInstance(site,mode.getEnumConstants()[0]);
                    ((Set<UUID>)get(run,"party")).add(target.getUniqueId());((Map<UUID,Integer>)get(run,"attendance")).put(target.getUniqueId(),0);
                    set(run,"phase","fighting");set(run,"checkpoint",arrival.clone());((Map<String,Object>)get(sites,"runs")).put("qa_readiness",run);
                    enemy=arrival.getWorld().spawn(arrival.clone().add(3,0,3),org.bukkit.entity.Zombie.class);((Mob)enemy).setAI(false);
                    enemy.addScoreboardTag("afu_site_dungeon");enemy.addScoreboardTag("afu_site_qa_readiness");
                    ((Map<UUID,Object>)get(run,"mobs")).put(enemy.getUniqueId(),((List<?>)call(room,"enemies")).getFirst());call(sites,"persist");
                }else{
                    floor(arrival);target.teleport(arrival);set(af,"arenaBuilt",true);set(trial,"built",true);
                    if(args[1].equals("trial")){
                        set(trial,"active",true);set(trial,"floor",1);set(trial,"cleared",false);set(trial,"spawned",true);set(trial,"pausedAt",0L);
                        set(trial,"runStartedAt",System.currentTimeMillis());set(trial,"floorStartedAt",System.currentTimeMillis());set(trial,"runId",UUID.randomUUID().toString());
                        ((Set<UUID>)get(trial,"participants")).add(target.getUniqueId());
                        enemy=world.spawn(arrival.clone().add(3,0,3),org.bukkit.entity.Zombie.class);((Mob)enemy).setAI(false);enemy.addScoreboardTag("afu_dungeon_mob");
                        ((Set<UUID>)get(trial,"mobs")).add(enemy.getUniqueId());call(trial,"persistRun");
                    }
                }
                call(rpg,"refillDungeonMana",new Class<?>[]{Player.class},actor);
                sender.sendMessage("NAV_SETUP "+args[1]);
            }
            case "cancel" -> cancel=Boolean.parseBoolean(args[1]);
            case "failcommit" -> {failCommit=Boolean.parseBoolean(args[1]);if(!failCommit)((Set<?>)get(sites,"blockedCheckpoints")).clear();}
            case "nogear" -> actor.getInventory().clear();
            case "cooldown" -> ((Map<?,?>)get(af,"teamTeleportAt")).clear();
            case "menu" -> call(get(af,"playerAdventureMenus"),"open",new Class<?>[]{Player.class},actor);
            case "particles" -> {
                call(af,"stopTracking",new Class<?>[]{Player.class},actor);
                var at=actor.getLocation();var guide=new JsonObject();var dest=new JsonObject();dest.addProperty("worldUuid",actor.getWorld().getUID().toString());dest.addProperty("x",at.getX()+20);dest.addProperty("y",at.getY());dest.addProperty("z",at.getZ());guide.add("target",dest);
                Player eye=player("NavEyeQA");eye.teleport(actor.getLocation());eye.setGameMode(GameMode.SPECTATOR);eye.setSpectatorTarget(actor);
                set(get(af,"playerNameTags"),"eyeRules",new JsonObject());
                set(get(af,"playerNameTags"),"registeredEyes",Map.of("naveyeqa","NavActorQA"));
                call(get(af,"targetGuides"),"quest",new Class<?>[]{Player.class,String.class,JsonObject.class},actor,"quest:fixture",guide);
                sender.sendMessage("NAV_EYES "+((List<?>)call(af,"attachedEyes",new Class<?>[]{Player.class},actor)).size());
            }
            case "attack" -> {double before=enemy.getHealth();enemy.damage(2,actor);sender.sendMessage("NAV_DAMAGE "+(before-enemy.getHealth()));}
        }
        JsonObject out=new JsonObject();out.addProperty("world",actor.getWorld().getName());JsonArray pos=new JsonArray();pos.add(actor.getX());pos.add(actor.getY());pos.add(actor.getZ());out.add("position",pos);
        out.add("mana",(JsonElement)call(rpg,"mana",new Class<?>[]{Player.class},actor));
        out.addProperty("trial",(Boolean)call(trial,"isParticipant",new Class<?>[]{Player.class},actor));out.addProperty("site",(Boolean)call(sites,"isParticipant",new Class<?>[]{Player.class},actor));
        out.addProperty("trialCommitted",(Boolean)call(trial,"committedCurrentRun"));out.addProperty("targetDistance",actor.getWorld()==target.getWorld()?actor.getLocation().distance(target.getLocation()):-1);
        out.addProperty("inventoryItems",Arrays.stream(actor.getInventory().getContents()).filter(Objects::nonNull).mapToInt(ItemStack::getAmount).sum());
        sender.sendMessage("NAV_STATE "+out);
    }
}
