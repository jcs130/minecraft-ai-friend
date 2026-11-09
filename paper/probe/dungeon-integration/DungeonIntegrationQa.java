package local.dungeonqa;

import com.google.gson.Gson;
import com.comphenix.protocol.*;
import com.comphenix.protocol.events.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.player.*;
import org.bukkit.generator.ChunkGenerator;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;

/** Console-only synthetic instrumentation; observes protection without cancelling it. */
public final class DungeonIntegrationQa extends JavaPlugin implements Listener {
    private final Gson json=new Gson();private Object manager;private JavaPlugin af;
    private final Map<UUID,Trace> traces=new HashMap<>();
    private static final class Trace {boolean walking;int moves,digPackets,teleports,water;double damage;}
    @Override public void onEnable(){try{
        if(Bukkit.getPort()!=25960||!Bukkit.getIp().equals("127.0.0.1")||!Files.readString(Path.of(".dungeon-integration-qa")).equals("FRESH_DUNGEON_INTEGRATION_NO_PLAYER_INVENTORIES"))throw new IllegalStateException("Fixed loopback QA only");
        af=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");
        if(af==null){
            if(Bukkit.getWorld("aincrad")==null)Bukkit.createWorld(new WorldCreator("aincrad").generator(new ChunkGenerator(){@Override public ChunkData generateChunkData(World w,Random random,int x,int z,BiomeGrid grid){return createChunkData(w);}}));
            getLogger().info("DUNGEON_BOOTSTRAP_READY");return;
        }
        if(!af.isEnabled())throw new IllegalStateException("AF did not enable");manager=field(af,"siteDungeons");
        Bukkit.getPluginManager().registerEvents(this,this);
        ProtocolLibrary.getProtocolManager().addPacketListener(new PacketAdapter(this,ListenerPriority.MONITOR,PacketType.Play.Client.BLOCK_DIG){@Override public void onPacketReceiving(PacketEvent e){Trace t=traces.get(e.getPlayer().getUniqueId());if(t!=null&&t.walking)t.digPackets++;}});
        getLogger().info("DUNGEON_INTEGRATION_READY");
    }catch(Exception e){throw new IllegalStateException(e);}}
    private static Object field(Object owner,String name)throws Exception{var f=owner.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(owner);}
    private static Object call(Object owner,String name,Class<?>[] types,Object... args)throws Exception{var m=owner.getClass().getDeclaredMethod(name,types);m.setAccessible(true);return m.invoke(owner,args);}
    private Player actor(String name){Player p=Bukkit.getPlayerExact(name);if(p==null||!name.matches("ag_DungeonQA[1-3]")||!p.getUniqueId().equals(UUID.nameUUIDFromBytes(("OfflinePlayer:"+name).getBytes(java.nio.charset.StandardCharsets.UTF_8))))throw new IllegalArgumentException("Synthetic identity only");return p;}
    private void refill(Player p)throws Exception{Object v=Bukkit.getPluginManager().getPlugin("VortexRPG");Object mana=v.getClass().getMethod("qiandengjiMana").invoke(v);double max=((Number)mana.getClass().getMethod("getMaxMana",Player.class).invoke(mana,p)).doubleValue();mana.getClass().getMethod("setMana",UUID.class,double.class).invoke(mana,p.getUniqueId(),max);p.setHealth(p.getMaxHealth());p.setFoodLevel(20);}
    @Override public boolean onCommand(CommandSender sender,Command command,String label,String[] args){try{
        if(sender instanceof Player||args.length==0||manager==null)throw new IllegalArgumentException("Console after full bootstrap only");
        Map<String,Object> out=new LinkedHashMap<>();out.put("productionChanged",false);
        if(args[0].equals("inspect")){
            out.put("ready",field(manager,"ready"));out.put("blocked",field(manager,"blockedCheckpoints"));
            var sites=(Map<?,?>)field(manager,"sites");out.put("sites",sites.keySet());out.put("activeRuns",((Map<?,?>)field(manager,"runs")).keySet());
            Map<String,Object> states=new LinkedHashMap<>();for(var row:((Map<?,?>)field(manager,"runs")).entrySet()){
                Object run=row.getValue();Map<String,Object> saved=new LinkedHashMap<>();for(String key:List.of("id","stage","phase","fault","pausedAt","pauseReason","storageFault"))saved.put(key,field(run,key));
                saved.put("partySize",((Set<?>)field(run,"party")).size());saved.put("attendanceSize",((Map<?,?>)field(run,"attendance")).size());states.put(row.getKey().toString(),saved);
            }out.put("runStates",states);
            if(args.length==2){Object site=sites.get(args[1]);out.put("definition",call(manager,"definition",new Class<?>[]{site.getClass()},site));}
            out.put("enabledPlugins",Arrays.stream(Bukkit.getPluginManager().getPlugins()).filter(p->p.isEnabled()).map(p->p.getName()).toList());
        }else if(args[0].equals("block")){
            out.put("state",Bukkit.getWorld("world").getBlockAt(Integer.parseInt(args[1]),Integer.parseInt(args[2]),Integer.parseInt(args[3])).getBlockData().getAsString());
        }else{
            Player p=actor(args[1]);Trace t=traces.computeIfAbsent(p.getUniqueId(),id->new Trace());
            switch(args[0]){
                case "prepare"->{p.setOp(false);p.setGameMode(GameMode.SURVIVAL);p.getInventory().setArmorContents(new ItemStack[]{new ItemStack(Material.IRON_BOOTS),new ItemStack(Material.IRON_LEGGINGS),new ItemStack(Material.IRON_CHESTPLATE),new ItemStack(Material.IRON_HELMET)});p.getInventory().setItemInMainHand(new ItemStack(Material.DIAMOND_SWORD));refill(p);}
                case "refill"->refill(p);
                case "teleport"->{if(t.walking)throw new IllegalStateException("No fixture teleport during route");p.teleport(new Location(Bukkit.getWorld(args[2]),Double.parseDouble(args[3]),Double.parseDouble(args[4]),Double.parseDouble(args[5])),PlayerTeleportEvent.TeleportCause.COMMAND);}
                case "break-check"->{var block=Bukkit.getWorld("world").getBlockAt(Integer.parseInt(args[2]),Integer.parseInt(args[3]),Integer.parseInt(args[4]));var event=new BlockBreakEvent(block,p);Bukkit.getPluginManager().callEvent(event);out.put("cancelled",event.isCancelled());}
                case "begin"->{t=new Trace();t.walking=true;traces.put(p.getUniqueId(),t);}
                case "finish"->t.walking=false;
                case "read"->{}
                default->throw new IllegalArgumentException("Unknown synthetic fixture action");
            }
            Location l=p.getLocation();out.put("position",List.of(l.getX(),l.getY(),l.getZ()));out.put("world",l.getWorld().getName());out.put("op",p.isOp());out.put("health",p.getHealth());out.put("mode",p.getGameMode().name());out.put("moves",t.moves);out.put("digPackets",t.digPackets);out.put("teleports",t.teleports);out.put("water",t.water);out.put("damage",t.damage);out.put("inFirstRoom",l.getWorld().getName().equals("world")&&Math.hypot(l.getX()-1159.5,l.getZ()-209.5)<=3&&l.getY()>=44&&l.getY()<=48);
        }
        sender.sendMessage("DGI_QA "+json.toJson(out));return true;
    }catch(Exception e){sender.sendMessage("DGI_QA_ERROR "+e.getClass().getSimpleName()+":"+e.getMessage());return true;}}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)public void move(PlayerMoveEvent e){var t=traces.get(e.getPlayer().getUniqueId());if(t!=null&&t.walking){t.moves++;if(e.getTo().getBlock().isLiquid())t.water++;}}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)public void teleport(PlayerTeleportEvent e){var t=traces.get(e.getPlayer().getUniqueId());if(t!=null&&t.walking)t.teleports++;}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)public void damage(EntityDamageEvent e){if(e.getEntity() instanceof Player p){var t=traces.get(p.getUniqueId());if(t!=null&&t.walking)t.damage+=e.getFinalDamage();}}
}
