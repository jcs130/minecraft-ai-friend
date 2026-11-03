package org.qiandengji.test;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.plugin.java.JavaPlugin;

/** Disposable loopback-only reproducer. Never install on a live server. */
public final class YouerUpstreamProbe extends JavaPlugin {
    private final Properties result = new Properties();
    private boolean running;
    private void put(String key, Object value) { result.setProperty(key, String.valueOf(value)); }
    private void write(String file) {
        try (OutputStream out = Files.newOutputStream(getDataFolder().toPath().resolve(file))) {
            result.store(out, "Synthetic, disposable test world only");
        } catch (IOException ex) { throw new UncheckedIOException(ex); }
    }
    @Override public void onEnable() {
        try {
            if (!Set.of(25992,25994).contains(Bukkit.getPort()) || !"127.0.0.1".equals(Bukkit.getIp())
                    || !"UPSTREAM_QA_ONLY".equals(Files.readString(Path.of(".upstream-qa"))))
                throw new IllegalStateException("Disposable loopback fixture required");
            Files.createDirectories(getDataFolder().toPath());
            put("version", Bukkit.getVersion()); put("mainThread", Bukkit.isPrimaryThread());
            Objects.requireNonNull(getCommand("upstreamprobe")).setExecutor(this);
        } catch (Exception ex) { getLogger().severe(ex.toString()); Bukkit.getPluginManager().disablePlugin(this); }
    }
    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) return false;
        if (args.length != 1 || running) return false;
        running = true;
        sender.sendMessage("UPSTREAM_PROBE_STARTED "+args[0]);
        try {
            if (args[0].equals("prepare")) prepare();
            else if (args[0].equals("verify")) verify(0);
            else throw new IllegalArgumentException("prepare or verify");
        } catch (Exception ex) { put("error",ex.toString()); write("error.properties"); running=false; }
        return true;
    }
    private World world() { return Bukkit.getWorlds().getFirst(); }
    private void prepare() {
        World w=world();
        w.setGameRule(GameRule.DO_MOB_SPAWNING,false); w.setGameRule(GameRule.SPAWN_CHUNK_RADIUS,0);
        w.loadChunk(64,64,true);
        for(boolean persistent: List.of(false,true)) {
            Villager v=w.spawn(new Location(w,1030,90,persistent?1032:1030),Villager.class);
            v.setAI(false); v.setGravity(false); v.setInvulnerable(true); v.setSilent(true);
            v.setPersistent(persistent); v.addScoreboardTag(persistent?"UP_PERSIST":"UP_TRANSIENT");
            put(persistent?"persistentUUID":"transientUUID",v.getUniqueId());
            put(persistent?"persistentFlag":"transientFlag",v.isPersistent());
        }
        w.loadChunk(80,80,true); w.getBlockAt(1281,90,1281).setType(Material.STONE);
        put("coldGeneratedBeforeRestart",w.isChunkGenerated(80,80));
        w.loadChunk(0,0,true);
        probe("loaded",0,0,false,()->{
            put("newGeneratedBefore",w.isChunkGenerated(96,96));
            probe("new",96,96,true,()->{w.save();write("prepare.properties");running=false;getLogger().info("UPSTREAM_PROBE_PREP_DONE");});
        });
    }
    private void probe(String prefix,int x,int z,boolean generate,Runnable next) {
        long start=System.nanoTime();
        world().getChunkAtAsync(x,z,generate).orTimeout(15,TimeUnit.SECONDS).whenComplete((chunk,error)->
            Bukkit.getScheduler().runTask(this,()->{
                put(prefix+"ReturnedNull",chunk==null); put(prefix+"Error",error==null?"":error.toString());
                put(prefix+"Millis",TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start));
                put(prefix+"LoadedAfter",world().isChunkLoaded(x,z)); put(prefix+"GeneratedAfter",world().isChunkGenerated(x,z));
                next.run();
            }));
    }
    private void verify(int tries) {
        World w=world();
        if(tries==0) {
            put("coldAfterRestartLoadedBefore",w.isChunkLoaded(80,80));
            put("coldAfterRestartGeneratedBefore",w.isChunkGenerated(80,80));
            if(w.isChunkLoaded(80,80)||!w.isChunkGenerated(80,80)) throw new IllegalStateException("Saved unloaded chunk required");
            probe("coldAfterRestart",80,80,false,()->verify(1)); return;
        }
        w.loadChunk(64,64,false);
        boolean persistent=Arrays.stream(w.getChunkAt(64,64).getEntities()).anyMatch(e->e.getScoreboardTags().contains("UP_PERSIST"));
        if(tries<4 || (!persistent && tries<40)) {
            Bukkit.getScheduler().runTaskLater(this,()->verify(tries+1),5L); return;
        }
        for(String tag:List.of("UP_PERSIST","UP_TRANSIENT")) {
            List<Entity> entities=Arrays.stream(w.getChunkAt(64,64).getEntities()).filter(e->e.getScoreboardTags().contains(tag)).toList();
            String prefix=tag.equals("UP_PERSIST")?"persistent":"transient";
            put(prefix+"CountAfterRestart",entities.size());
            if(!entities.isEmpty()) { put(prefix+"UUIDAfterRestart",entities.getFirst().getUniqueId());put(prefix+"FlagAfterRestart",entities.getFirst().isPersistent()); }
        }
        write("verify.properties");running=false;getLogger().info("UPSTREAM_PROBE_VERIFY_DONE");
    }
}
