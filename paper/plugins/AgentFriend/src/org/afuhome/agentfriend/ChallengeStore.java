package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

/** One bounded writer; success is published only after the complete evidence record is durable. */
final class ChallengeStore implements AutoCloseable {
    private final Path directory;
    private final ThreadPoolExecutor writer=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(128),r->{Thread t=new Thread(r,"AgentFriend-challenge-journal");t.setDaemon(true);return t;});
    final ConcurrentMap<UUID,Integer> persisted=new ConcurrentHashMap<>();
    final AtomicReference<String> error=new AtomicReference<>("");
    ChallengeStore(Path directory){this.directory=directory;}
    List<ChallengeRun> load() throws Exception {
        Files.createDirectories(directory);var result=new ArrayList<ChallengeRun>();
        try(var paths=Files.list(directory)){
            for(Path p:paths.filter(x->x.getFileName().toString().endsWith(".json")).toList()){
                if(result.size()>=10_000 || Files.size(p)>131_072)throw new IllegalArgumentException("challenge archive limit");
                ChallengeRun run=ChallengeRun.decode(JsonParser.parseString(Files.readString(p,StandardCharsets.UTF_8)).getAsJsonObject());
                if(!p.getFileName().toString().equals(run.id+".json"))throw new IllegalArgumentException("record filename");
                result.add(run);persisted.put(run.id,run.revision);
            }
        }
        return result;
    }
    CompletableFuture<Void> save(ChallengeRun run) {
        byte[] bytes=run.encode().toString().getBytes(StandardCharsets.UTF_8);UUID id=run.id;int revision=run.revision;
        CompletableFuture<Void> future=new CompletableFuture<>();
        if(bytes.length>131_072||!error.get().isEmpty()){future.completeExceptionally(new IllegalStateException("journal_unavailable"));return future;}
        try{writer.execute(()->{
            try{
                if(!error.get().isEmpty())throw new IllegalStateException("journal_unavailable");
                Path file=directory.resolve(id+".json"),tmp=directory.resolve(id+".tmp");
                try(FileChannel channel=FileChannel.open(tmp,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING,StandardOpenOption.WRITE)){
                    ByteBuffer buffer=ByteBuffer.wrap(bytes);while(buffer.hasRemaining())channel.write(buffer);channel.force(true);
                }
                Files.move(tmp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
                persisted.put(id,revision);future.complete(null);
            }catch(Exception e){error.compareAndSet("",e.getClass().getSimpleName());future.completeExceptionally(e);}
        });}catch(RejectedExecutionException e){error.compareAndSet("","queue_full");future.completeExceptionally(e);}
        return future;
    }
    boolean durable(ChallengeRun run){return error.get().isEmpty()&&persisted.getOrDefault(run.id,0)>=run.revision;}
    public void close(){writer.shutdown();try{if(!writer.awaitTermination(5,TimeUnit.SECONDS))error.compareAndSet("","shutdown_timeout");}catch(InterruptedException e){Thread.currentThread().interrupt();error.compareAndSet("","shutdown_interrupted");}}
}
