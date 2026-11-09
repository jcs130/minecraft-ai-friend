package org.qiandengji.cryptqa;

import com.google.gson.*;
import com.comphenix.protocol.*;
import com.comphenix.protocol.events.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.block.*;
import org.bukkit.event.player.*;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.generator.ChunkGenerator;
import org.bukkit.plugin.java.JavaPlugin;

/** Marked, loopback-only synthetic movement audit. Never a production plugin. */
public final class CryptRouteFixture extends JavaPlugin implements Listener {
    private static final String WORLD="world";
    private final Map<UUID,Run> runs=new HashMap<>();
    private static final Gson JSON=new Gson();
    private World world;
    private static final class Run {
        String label="setup",phase="ready";int moves,breaks,placements,digPackets,teleports,interactions,waterSamples;
        double distance,damage;long began=System.currentTimeMillis();
        final List<List<Number>> trace=new ArrayList<>();
        Location last;
    }
    @Override public void onEnable(){try{
        if(getServer().getPort()!=25928||!getServer().getIp().equals("127.0.0.1")
                ||!Files.readString(Path.of(".shop-qa")).equals("FRESH_RPG_SHOP_QA_NO_PLAYER_DATA"))throw new IllegalStateException("Isolated marked stage only");
        getServer().getPluginManager().registerEvents(this,this);
        ProtocolLibrary.getProtocolManager().addPacketListener(new PacketAdapter(this,ListenerPriority.HIGHEST,PacketType.Play.Client.BLOCK_DIG){
            @Override public void onPacketReceiving(PacketEvent e){Run r=runs.get(e.getPlayer().getUniqueId());
                if(r==null||!r.phase.equals("walking")||!inWorld(e.getPlayer()))return;
                String action=e.getPacket().getPlayerDigTypes().read(0).name();
                if(action.contains("DESTROY_BLOCK")){r.digPackets++;e.setCancelled(true);}
            }
        });
    }catch(Exception e){throw new IllegalStateException(e);}}
    private boolean inWorld(Player p){return world!=null&&p.getWorld()==world;}
    private Player actor(String name){Player p=Bukkit.getPlayerExact(name);
        if(p==null||!name.matches("ag_RUCrypt[a-z0-9]{1,4}")||!p.getUniqueId().equals(UUID.nameUUIDFromBytes(("OfflinePlayer:"+name).getBytes(java.nio.charset.StandardCharsets.UTF_8))))throw new IllegalArgumentException("Synthetic original offline identity only");return p;
    }
    @Override public boolean onCommand(CommandSender sender,Command command,String label,String[] args){try{
        if(sender instanceof Player||args.length<1)throw new IllegalArgumentException("Console QA only");
        if(args[0].equals("load")){
            if(world!=null)throw new IllegalStateException("Geometry already loaded");
            Path marker=Path.of(WORLD,".geometry-only");if(!Files.readString(marker).equals("CRYPT_GEOMETRY_NO_ENTITIES_NO_INVENTORIES"))throw new IllegalStateException("Sanitized geometry required");
            // Use the already loaded synthetic world, avoiding unrelated dynamic-realm initialization.
            world=Bukkit.getWorld(WORLD);
            if(world==null||!world.getName().equals(WORLD))throw new IllegalStateException("New geometry world unavailable");
            world.setKeepSpawnInMemory(false);world.setDifficulty(Difficulty.NORMAL);world.setTime(6000);world.setStorm(false);
            world.setGameRule(GameRule.DO_MOB_SPAWNING,false);world.setGameRule(GameRule.DO_DAYLIGHT_CYCLE,false);world.setGameRule(GameRule.DO_WEATHER_CYCLE,false);world.setGameRule(GameRule.DO_FIRE_TICK,false);world.setGameRule(GameRule.RANDOM_TICK_SPEED,0);world.setGameRule(GameRule.NATURAL_REGENERATION,false);
            world.setSpawnLocation(1096,66,232);sender.sendMessage("CRYPT_QA geometry_loaded=true world="+world.getUID());return true;
        }
        if(args.length<2||world==null)throw new IllegalArgumentException("Load geometry, then provide original synthetic actor");Player p=actor(args[1]);
        if(args[0].equals("setup")){
            if(args.length!=3||!Set.of("outside","room").contains(args[2]))throw new IllegalArgumentException("outside/room setup only");
            runs.remove(p.getUniqueId());p.closeInventory();p.getInventory().clear();p.setOp(false);p.setGameMode(GameMode.ADVENTURE);p.setFlying(false);p.setAllowFlight(false);p.setInvulnerable(false);p.setFoodLevel(20);p.setSaturation(5);p.setHealth(Math.min(20,p.getMaxHealth()));
            p.teleport(args[2].equals("outside")?new Location(world,1096.5,66,232.5):new Location(world,1159.5,46,209.5));
            Run r=new Run();r.last=p.getLocation().clone();runs.put(p.getUniqueId(),r);sender.sendMessage("CRYPT_QA setup="+args[2]);return true;
        }
        Run r=runs.get(p.getUniqueId());if(r==null||!inWorld(p))throw new IllegalStateException("Original synthetic setup required");
        if(args[0].equals("begin")){
            if(args.length!=3||!args[2].matches("[a-z0-9_-]{1,40}")||r.phase.equals("walking"))throw new IllegalArgumentException("Unique bounded case label required");
            r=new Run();r.label=args[2];r.phase="walking";r.last=p.getLocation().clone();runs.put(p.getUniqueId(),r);sample(p,r);sender.sendMessage("CRYPT_QA walking=true");return true;
        }
        if(args[0].equals("finish")){
            sample(p,r);r.phase="finished";Path out=getDataFolder().toPath().resolve(r.label+"-"+p.getUniqueId()+".json");Files.createDirectories(out.getParent());
            JsonObject full=report(p,r);full.add("trace",JSON.toJsonTree(r.trace));Files.writeString(out,full.toString());sender.sendMessage("CRYPT_QA report="+out.getFileName());return true;
        }
        if(!args[0].equals("read"))throw new IllegalArgumentException("Known read/begin/finish command only");
        sender.sendMessage("CRYPT_QA "+report(p,r));return true;
    }catch(Exception e){throw new IllegalStateException(e);}}
    private void sample(Player p,Run r){Location a=p.getLocation();if(r.trace.size()<12000)r.trace.add(List.of(System.currentTimeMillis()-r.began,a.getX(),a.getY(),a.getZ()));}
    private JsonObject report(Player p,Run r){JsonObject a=new JsonObject();Location l=p.getLocation();
        a.addProperty("label",r.label);a.addProperty("phase",r.phase);a.addProperty("uuid",p.getUniqueId().toString());a.add("position",JSON.toJsonTree(List.of(l.getX(),l.getY(),l.getZ())));a.addProperty("dimension",p.getWorld().getName());
        a.addProperty("inFirstRoom",Math.hypot(l.getX()-1159.5,l.getZ()-209.5)<=3&&l.getY()>=44&&l.getY()<=48);a.addProperty("outside",Math.hypot(l.getX()-1096.5,l.getZ()-232.5)<=2&&l.getY()>=64);
        a.addProperty("moves",r.moves);a.addProperty("walkedDistance",r.distance);a.addProperty("breakAttempts",r.breaks);a.addProperty("placeAttempts",r.placements);a.addProperty("digPackets",r.digPackets);a.addProperty("teleportsWhileWalking",r.teleports);a.addProperty("interactions",r.interactions);a.addProperty("waterSamples",r.waterSamples);a.addProperty("damage",r.damage);a.addProperty("health",p.getHealth());a.addProperty("op",p.isOp());a.addProperty("flying",p.isFlying());a.addProperty("mode",p.getGameMode().name());a.addProperty("elapsedMs",System.currentTimeMillis()-r.began);return a;
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void move(PlayerMoveEvent e){Run r=runs.get(e.getPlayer().getUniqueId());if(r==null||!r.phase.equals("walking")||!inWorld(e.getPlayer())||e.getTo()==null)return;Location t=e.getTo();if(r.last!=null&&r.last.getWorld()==t.getWorld())r.distance+=r.last.distance(t);r.last=t.clone();r.moves++;if(t.getBlock().isLiquid())r.waterSamples++;if(r.moves%3==0)sample(e.getPlayer(),r);}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void teleport(PlayerTeleportEvent e){Run r=runs.get(e.getPlayer().getUniqueId());if(r!=null&&r.phase.equals("walking"))r.teleports++;}
    @EventHandler(priority=EventPriority.HIGHEST) public void breakBlock(BlockBreakEvent e){if(!inWorld(e.getPlayer()))return;Run r=runs.get(e.getPlayer().getUniqueId());if(r!=null)r.breaks++;e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void place(BlockPlaceEvent e){if(!inWorld(e.getPlayer()))return;Run r=runs.get(e.getPlayer().getUniqueId());if(r!=null)r.placements++;e.setCancelled(true);}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void interact(PlayerInteractEvent e){Run r=runs.get(e.getPlayer().getUniqueId());if(r!=null&&r.phase.equals("walking")&&inWorld(e.getPlayer()))r.interactions++;}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void damage(EntityDamageEvent e){if(e.getEntity() instanceof Player p){Run r=runs.get(p.getUniqueId());if(r!=null&&r.phase.equals("walking"))r.damage+=e.getFinalDamage();}}
}
