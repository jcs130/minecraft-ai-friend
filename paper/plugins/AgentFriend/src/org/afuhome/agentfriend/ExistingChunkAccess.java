package org.afuhome.agentfriend;

import java.util.concurrent.CompletableFuture;
import org.bukkit.Bukkit;
import org.bukkit.Chunk;
import org.bukkit.World;
import org.bukkit.plugin.java.JavaPlugin;

/** Paper's async path first; one bounded, non-generating fallback for native kernels. */
final class ExistingChunkAccess {
    private ExistingChunkAccess() {}
    static CompletableFuture<Chunk> load(JavaPlugin owner,World world,int x,int z) {
        var result=new CompletableFuture<Chunk>();
        world.getChunkAtAsync(x,z,false).whenComplete((chunk,error)->{
            if(error!=null){result.completeExceptionally(error);return;}
            if(chunk!=null){result.complete(chunk);return;}
            Runnable fallback=()->{
                try{
                    if(!owner.isEnabled()||Bukkit.getWorld(world.getUID())!=world)throw new IllegalStateException("world_or_plugin_unavailable");
                    // The current Youer getChunkAtAsync only inspects loaded chunks.
                    // Do not generate terrain, retry an I/O error, or relax travel checks.
                    if(!world.isChunkGenerated(x,z)||!world.loadChunk(x,z,false)){result.complete(null);return;}
                    result.complete(world.getChunkAt(x,z));
                }catch(Exception|LinkageError failure){result.completeExceptionally(failure);}
            };
            if(Bukkit.isPrimaryThread())fallback.run();else Bukkit.getScheduler().runTask(owner,fallback);
        });
        return result;
    }
}
