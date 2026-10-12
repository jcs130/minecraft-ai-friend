package dev.qiandeng.maw;

import com.google.gson.JsonObject;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppedEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import java.lang.management.ManagementFactory;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Bounded local diagnostics. No player names, positions, packets or chat.
 * Tick thread only measures/copies 1,200 longs every five seconds; sorting,
 * JVM inspection and atomic disk writes run off the server thread. */
final class ServerPerformance {
    private static final long[] TICKS = new long[1200];
    private static final AtomicBoolean WRITING = new AtomicBoolean();
    private static ExecutorService writer;
    private static long started, tickStart, lastPublish, total;
    private static int count, cursor;
    private static String runId;
    static void register() {
        NeoForge.EVENT_BUS.addListener(ServerPerformance::started);
        NeoForge.EVENT_BUS.addListener(ServerPerformance::pre);
        NeoForge.EVENT_BUS.addListener(ServerPerformance::post);
        NeoForge.EVENT_BUS.addListener(ServerPerformance::stopped);
    }
    private static void started(ServerStartedEvent event) {
        started=lastPublish=System.nanoTime(); total=0; count=cursor=0;
        runId=UUID.randomUUID().toString(); WRITING.set(false);
        writer=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"maw-performance-writer");t.setDaemon(true);return t;});
    }
    private static void pre(ServerTickEvent.Pre event) {tickStart=System.nanoTime();}
    private static void post(ServerTickEvent.Post event) {
        long now=System.nanoTime();
        if(writer==null||tickStart==0)return;
        TICKS[cursor]=Math.max(0,now-tickStart);cursor=(cursor+1)%TICKS.length;
        count=Math.min(count+1,TICKS.length);total++;
        if(now-lastPublish<5_000_000_000L||!WRITING.compareAndSet(false,true))return;
        lastPublish=now;
        long[] sample=Arrays.copyOf(TICKS,count);
        long sampledTicks=total, elapsed=now-started;
        int online=event.getServer().getPlayerCount();
        Path path=event.getServer().getServerDirectory().resolve("ops/maw-performance/metrics.json");
        String sampledAt=Instant.now().toString(), identity=runId;
        writer.execute(()->{
            Path temporary=path.resolveSibling("metrics."+identity+".tmp");
            try {
                Arrays.sort(sample);long sum=0,slow=0;for(long t:sample){sum+=t;if(t>50_000_000L)slow++;}
                JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("runId",identity);
                out.addProperty("sampledAt",sampledAt);out.addProperty("pid",ProcessHandle.current().pid());
                out.addProperty("sampleCount",sample.length);out.addProperty("windowCapacity",TICKS.length);
                out.addProperty("totalTicks",sampledTicks);out.addProperty("uptimeSeconds",elapsed/1e9);
                out.addProperty("playersOnline",online);out.addProperty("slowTicksOver50Ms",slow);
                out.addProperty("meanMs",sum/1e6/sample.length);out.addProperty("p50Ms",percentile(sample,.50));
                out.addProperty("p95Ms",percentile(sample,.95));out.addProperty("p99Ms",percentile(sample,.99));
                out.addProperty("maxMs",sample[sample.length-1]/1e6);
                var heap=ManagementFactory.getMemoryMXBean().getHeapMemoryUsage();
                out.addProperty("heapUsedBytes",heap.getUsed());out.addProperty("heapCommittedBytes",heap.getCommitted());out.addProperty("heapMaxBytes",heap.getMax());
                long gcCount=0,gcMs=0;for(var gc:ManagementFactory.getGarbageCollectorMXBeans()){
                    if(gc.getCollectionCount()>0)gcCount+=gc.getCollectionCount();if(gc.getCollectionTime()>0)gcMs+=gc.getCollectionTime();
                }
                out.addProperty("gcCount",gcCount);out.addProperty("gcTimeMs",gcMs);
                Files.createDirectories(path.getParent());Files.writeString(temporary,out.toString()+"\n",StandardCharsets.UTF_8);
                Files.move(temporary,path,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
            }catch(Exception error){
                // Diagnostics failure must not stall a game tick or a player's action.
                org.slf4j.LoggerFactory.getLogger(ServerPerformance.class).warn("MAW_PERFORMANCE snapshot unavailable: {}",error.getClass().getSimpleName());
            }finally{try{Files.deleteIfExists(temporary);}catch(Exception ignored){}WRITING.set(false);}
        });
    }
    static double percentile(long[] sorted,double fraction) {return sorted[Math.max(0,(int)Math.ceil(sorted.length*fraction)-1)]/1e6;}
    private static void stopped(ServerStoppedEvent event) {if(writer!=null){writer.shutdown();writer=null;}tickStart=0;}
}
