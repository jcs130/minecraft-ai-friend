package io.vortexcore.quest;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Supplier;
/** Serializes this player's read-modify-save operations, retaining real event order. */
public final class QuestWrites {
    private final Map<UUID,CompletableFuture<Void>> tails=new HashMap<>();
    public <T> CompletableFuture<T> run(UUID player,Supplier<CompletableFuture<T>> operation){
        CompletableFuture<Void> previous,slot=new CompletableFuture<>();
        synchronized(tails){previous=tails.getOrDefault(player,CompletableFuture.completedFuture(null));tails.put(player,slot);}
        CompletableFuture<T> result=previous.handle((v,e)->null).thenCompose(ignored->{
            try{return operation.get();}catch(Exception e){return CompletableFuture.failedFuture(e);}
        });
        result.whenComplete((v,e)->{slot.complete(null);synchronized(tails){tails.remove(player,slot);}});
        return result;
    }
}
