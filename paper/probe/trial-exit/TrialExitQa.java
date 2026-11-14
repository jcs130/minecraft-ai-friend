package org.afuhome.agentfriend.tests;

import com.google.gson.Gson;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** Synthetic, console-only fixture. Never included in the release JAR. */
public final class TrialExitQa extends JavaPlugin implements Listener {
    private JavaPlugin af;
    private Object tower;
    private final Set<UUID> cancel = new HashSet<>();
    private static final Set<String> ACTORS = Set.of("TrialExitQA", "TrialExitQB", "TrialExitEye", "MaidBrainQA");
    private static Field field(Object object, String name) throws Exception {
        for (Class<?> type=object.getClass(); type!=null; type=type.getSuperclass()) {
            try { Field value=type.getDeclaredField(name); value.setAccessible(true); return value; }
            catch (NoSuchFieldException absent) { }
        }
        throw new NoSuchFieldException(name);
    }
    private static Object get(Object object, String name) throws Exception { return field(object,name).get(object); }
    private static void set(Object object, String name, Object value) throws Exception { field(object,name).set(object,value); }
    private Object call(String name, Class<?>[] types, Object... values) throws Exception {
        Method method=tower.getClass().getDeclaredMethod(name,types); method.setAccessible(true);
        return method.invoke(tower,values);
    }
    private Object call(String name) throws Exception { return call(name,new Class<?>[0]); }
    @Override public void onEnable() {
        try {
            if (!Files.readString(Path.of(".trial-exit-qa")).equals("SYNTHETIC_TRIAL_EXIT_ONLY")
                    || !Bukkit.getIp().equals("127.0.0.1") || Bukkit.getPort()!=26461)
                throw new IllegalStateException("Dedicated loopback fixture required");
            af=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend"); tower=get(af,"dungeon");
            Bukkit.getPluginManager().registerEvents(this,this);
            Bukkit.getCommandMap().register("trialexitqa",new Command("trialexitqa") {
                @Override public boolean execute(CommandSender sender,String label,String[] args) {
                    if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) return false;
                    try { run(sender,args); } catch (Exception error) { throw new IllegalStateException(error); }
                    return true;
                }
            });
        } catch (Exception error) { throw new IllegalStateException(error); }
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void teleport(PlayerTeleportEvent event) {
        if (cancel.contains(event.getPlayer().getUniqueId()) && event.getTo()!=null
                && event.getTo().distanceSquared(entrance())<4) event.setCancelled(true);
    }
    private Location entrance() { return new Location(Bukkit.getWorld("world"),-589.5,91,-321.5); }
    private Player actor(String name) {
        if (!ACTORS.contains(name)) throw new IllegalArgumentException("Synthetic actor required");
        return Objects.requireNonNull(Bukkit.getPlayerExact(name));
    }
    private void ground(Location at) {
        for(int dx=-4;dx<=4;dx++)for(int dz=-4;dz<=4;dz++)for(int dy=-1;dy<=3;dy++)
            at.clone().add(dx,dy,dz).getBlock().setType(dy<0?Material.STONE:Material.AIR,false);
    }
    @SuppressWarnings("unchecked") private void seed(int floor, List<Player> players) throws Exception {
        call("cleanupMobs"); set(tower,"active",false); cancel.clear();
        int[] levels={68,56,44,32,20,8,-4,-16,-28,-40,-40,-28,-16,-4,8};
        Location at=new Location(Bukkit.getWorld("world"),floor<=6?-589.5:floor<=10?-509.5:-349.5,levels[floor-1]+1,-304.5);
        ground(at); ground(entrance());
        Set<UUID> ids=(Set<UUID>)get(tower,"participants"); ids.clear();
        for(Player player:players) {
            player.setGameMode(GameMode.SURVIVAL); player.setInvulnerable(true);
            if (!player.teleport(at)) throw new IllegalStateException("fixture placement rejected");
            player.saveData(); ids.add(player.getUniqueId());
            af.getConfig().set("dungeon-activity-outcomes."+player.getUniqueId(),null);
        }
        set(tower,"built",true);set(tower,"expanded",true);set(tower,"challengeBuilt",true);
        set(tower,"active",true);set(tower,"spawned",true);set(tower,"cleared",false);set(tower,"floor",floor);
        set(tower,"pausedAt",0L);set(tower,"outsideSince",0L);set(tower,"runStartedAt",System.currentTimeMillis());
        set(tower,"floorStartedAt",System.currentTimeMillis());set(tower,"runId",UUID.randomUUID().toString());
        set(tower,"runRevision",0L);set(tower,"committedRun",null);
        af.getConfig().set("dungeon-built",true);af.getConfig().set("dungeon-expanded",true);af.getConfig().set("dungeon-challenge-built",true);
        call("persistRun");
    }
    private void run(CommandSender sender,String[] args) throws Exception {
        switch(args[0]) {
            case "seed" -> seed(Integer.parseInt(args[1]),Arrays.stream(args[2].split(",")).map(this::actor).toList());
            case "clear" -> call("tick");
            case "won" -> call("finish",new Class<?>[]{boolean.class,String.class,String.class},true,"cleared","Synthetic final victory");
            case "failed" -> call("finish",new Class<?>[]{boolean.class,String.class,String.class},false,"timeout","Synthetic timeout");
            case "hold" -> cancel.add(actor(args[1]).getUniqueId());
            case "release" -> cancel.clear();
            case "block" -> entrance().getBlock().setType(Material.STONE,false);
            case "unblock" -> ground(entrance());
            case "persist-clear" -> {
                set(tower,"cleared",true);call("persistRun");
                // Freeze immediately after the durable reward/clear boundary; normal
                // shutdown then preserves exactly the checkpoint a crash would leave.
                set(tower,"active",false);
                for(Player player:Bukkit.getOnlinePlayers())if(ACTORS.contains(player.getName()))player.saveData();
            }
            case "retry" -> call("tick");
            case "restore-old-clear" -> {
                seed(15,List.of(actor(args[1])));set(tower,"cleared",true);call("persistRun");
                af.getConfig().set("dungeon-active-run.saved-at",System.currentTimeMillis()-3_600_000);
                af.getConfig().set("dungeon-active-run.paused-at",System.currentTimeMillis()-3_600_000);
                af.saveConfig();set(tower,"active",false);call("restoreRun");call("tick");
            }
            case "save-failure" -> {
                Player real=actor(args[1]);
                Player proxy=(Player)Proxy.newProxyInstance(Player.class.getClassLoader(),new Class<?>[]{Player.class},(o,m,a)->{
                    if(m.getName().equals("saveData"))throw new IllegalStateException("synthetic_save_failure");
                    try{return m.invoke(real,a);}catch(InvocationTargetException e){throw e.getCause();}
                });
                cancel.remove(real.getUniqueId());
                ((Map<?,?>)get(tower,"returnAttemptAt")).clear();
                call("returnWinner",new Class<?>[]{Player.class},proxy);
            }
            case "snapshot" -> { }
            default -> throw new IllegalArgumentException("Unknown fixture action");
        }
        Map<String,Object> state=new LinkedHashMap<>();
        state.put("active",get(tower,"active"));state.put("cleared",get(tower,"cleared"));state.put("floor",get(tower,"floor"));
        state.put("participants",get(tower,"participants"));
        Map<String,Object> players=new LinkedHashMap<>();
        for(Player player:Bukkit.getOnlinePlayers()) if(ACTORS.contains(player.getName())) {
            Location at=player.getLocation();Map<String,Object> data=new LinkedHashMap<>();
            data.put("uuid",player.getUniqueId());data.put("position",List.of(at.getX(),at.getY(),at.getZ()));
            data.put("world",at.getWorld().getName());data.put("mode",player.getGameMode());
            var outcome=af.getConfig().getConfigurationSection("dungeon-activity-outcomes."+player.getUniqueId());
            data.put("outcome",outcome==null?null:outcome.getValues(false));
            var rewards=af.getConfig().getConfigurationSection("dungeon-rewards."+player.getUniqueId());
            data.put("rewards",rewards==null?Map.of():rewards.getValues(true));
            players.put(player.getName(),data);
        }
        state.put("players",players);
        sender.sendMessage("TRIAL_EXIT_QA "+new Gson().toJson(state));
    }
}
