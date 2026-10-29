package io.vortexcore.quest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
public final class QuestWritesTest {
    public static void main(String[] args){
        var writes=new QuestWrites();var id=UUID.randomUUID();var held=new CompletableFuture<Integer>();var count=new AtomicInteger();
        var first=writes.run(id,()->held);var second=writes.run(id,()->CompletableFuture.completedFuture(count.incrementAndGet()));
        if(second.isDone()||count.get()!=0)throw new AssertionError("out of order");
        if(writes.run(UUID.randomUUID(),()->CompletableFuture.completedFuture(8)).join()!=8)throw new AssertionError("other player blocked");
        held.complete(1);if(first.join()!=1||second.join()!=1)throw new AssertionError();
        var failed=writes.run(id,()->CompletableFuture.failedFuture(new IllegalStateException("interrupted")));
        if(!failed.isCompletedExceptionally())throw new AssertionError();
        if(writes.run(id,()->CompletableFuture.completedFuture(2)).join()!=2)throw new AssertionError("queue stuck after failure");
        System.out.println("5 ordered quest write checks passed");
    }
}
