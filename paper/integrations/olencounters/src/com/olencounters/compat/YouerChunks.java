package com.olencounters.compat;

import java.util.Locale;
import java.util.concurrent.*;
import net.minecraft.world.level.chunk.status.ChunkStatus;
import org.bukkit.*;
import org.bukkit.craftbukkit.CraftWorld;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

/** Bridge the loaded-only Youer Bukkit stub to the real asynchronous server
 * chunk future. Search generation policy and its existing budget remain authoritative. */
public final class YouerChunks {
    private YouerChunks(){}
    public static CompletableFuture<Chunk> load(World world,int x,int z,boolean generate,CompletableFuture<?> search){
        if(search.isDone())return CompletableFuture.failedFuture(new CancellationException("location search ended"));
        if(!Bukkit.getName().toLowerCase(Locale.ROOT).contains("youer"))return world.getChunkAtAsync(x,z,generate);
        Plugin owner=JavaPlugin.getProvidingPlugin(YouerChunks.class);
        CompletableFuture<Chunk> result=new CompletableFuture<>();
        main(owner,result,()->{
            if(search.isDone()||result.isDone()){result.completeExceptionally(new CancellationException("location search ended"));return;}
            if(!owner.isEnabled()||Bukkit.getWorld(world.getUID())!=world){result.completeExceptionally(new IllegalStateException("location world unavailable"));return;}
            if(!generate&&!world.isChunkGenerated(x,z)){result.complete(null);return;}
            var timeout=Bukkit.getScheduler().runTaskLater(owner,()->result.completeExceptionally(new TimeoutException("location chunk unavailable within five seconds")),100L);
            result.whenComplete((chunk,error)->timeout.cancel());
            // true acquires Minecraft's expiring load ticket. The check above
            // enforces no-generation searches before requesting that ticket.
            var future=((CraftWorld)world).getHandle().getChunkSource().getChunkFuture(x,z,ChunkStatus.FULL,true);
            future.whenComplete((loaded,error)->main(owner,result,()->{
                if(result.isDone())return;
                if(search.isDone()){result.completeExceptionally(new CancellationException("location search ended"));return;}
                if(error!=null){result.completeExceptionally(error);return;}
                if(!owner.isEnabled()||Bukkit.getWorld(world.getUID())!=world){result.completeExceptionally(new IllegalStateException("location world unavailable"));return;}
                if(loaded==null||loaded.orElse(null)==null){result.complete(null);return;}
                if(!world.isChunkLoaded(x,z)){result.completeExceptionally(new IllegalStateException("location chunk unloaded before snapshot"));return;}
                result.complete(world.getChunkAt(x,z,false));
            }));
        });
        return result;
    }
    private static void main(Plugin owner,CompletableFuture<?> result,Runnable action){
        try{if(Bukkit.isPrimaryThread())action.run();else Bukkit.getScheduler().runTask(owner,()->{try{action.run();}catch(Throwable error){result.completeExceptionally(error);}});}
        catch(Throwable error){result.completeExceptionally(error);}
    }
}
