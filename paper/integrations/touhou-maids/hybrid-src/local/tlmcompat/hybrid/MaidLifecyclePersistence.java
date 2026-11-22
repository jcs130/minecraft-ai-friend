package local.tlmcompat.hybrid;

import com.google.gson.JsonObject;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Only the owner thread touches the reducer; a single writer takes detached snapshots. */
final class MaidLifecyclePersistence implements AutoCloseable {
    @FunctionalInterface interface Writer { void write(JsonObject data) throws Exception; }
    private record Write(MaidLifeEpisodes.Save snapshot, CompletableFuture<Void> completion) {}
    private final MaidLifeEpisodes lifecycle;
    private final Writer writer;
    private final Consumer<Throwable> onFailure;
    private final ExecutorService executor=Executors.newSingleThreadExecutor(task->{
        Thread thread=new Thread(task,"maid-lifecycle-writer");
        thread.setDaemon(true);
        return thread;
    });
    private Write pending;
    private long lastFailure;
    private boolean closed;

    MaidLifecyclePersistence(MaidLifeEpisodes lifecycle,Writer writer,Consumer<Throwable> onFailure){
        this.lifecycle=lifecycle;this.writer=writer;this.onFailure=onFailure;
    }

    private Write submit(MaidLifeEpisodes.Save snapshot){
        return new Write(snapshot,CompletableFuture.runAsync(()->{
            try { writer.write(snapshot.data()); }
            catch(Exception error){throw new CompletionException(error);}
        },executor));
    }

    private void acknowledge(Write write){
        try {
            write.completion().join();
            lifecycle.saved(write.snapshot());
        } catch(CompletionException failure){
            lastFailure=System.nanoTime();
            onFailure.accept(failure.getCause());
        }
    }

    void pump(){
        if(closed)return;
        if(pending!=null){
            if(!pending.completion().isDone())return;
            acknowledge(pending);
            pending=null;
        }
        if(lifecycle.dirty()&&(lastFailure==0||System.nanoTime()-lastFailure>=TimeUnit.SECONDS.toNanos(1)))
            pending=submit(lifecycle.snapshot());
    }

    @Override public void close(){
        if(closed)return;
        closed=true;
        Write last=pending;
        if(last!=null&&last.completion().isDone()){
            acknowledge(last);
            last=null;
        }
        if(lifecycle.dirty()){
            var latest=lifecycle.snapshot();
            if(last==null||!latest.equals(last.snapshot()))last=submit(latest);
        }
        executor.shutdown();
        // Clean shutdown gets a bounded opportunity to flush. Never wait on disk in pump().
        if(last!=null){
            try {
                last.completion().get(1,TimeUnit.SECONDS);
                acknowledge(last);
            } catch(ExecutionException failure){
                onFailure.accept(failure.getCause());
            } catch(InterruptedException failure){
                Thread.currentThread().interrupt();
                onFailure.accept(failure);
            } catch(TimeoutException failure){
                onFailure.accept(failure);
            }
        }
    }
}
