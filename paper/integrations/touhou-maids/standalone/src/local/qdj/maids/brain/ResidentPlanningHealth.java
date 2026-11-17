package local.qdj.maids.brain;

import com.google.gson.Gson;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Persisted inference backoff. It never changes body tasks, permissions or action receipts. */
final class ResidentPlanningHealth {
    record Failure(UUID maidId,UUID requestId,int consecutive,String reason,long failedAt,long delayMs) {}
    private final Path root;
    private final long baseDelay;
    private final Map<UUID,Failure> cache=new java.util.HashMap<>();
    ResidentPlanningHealth(Path root,long baseDelay) {
        if(baseDelay<30_000||baseDelay>3_600_000)throw new IllegalArgumentException("planning_interval_out_of_range");
        this.root=root;this.baseDelay=baseDelay;
    }
    private Failure read(UUID id)throws IOException {
        if(cache.containsKey(id))return cache.get(id);
        Path file=root.resolve(id+".json");if(!Files.exists(file))return null;
        if(Files.size(file)>4096)throw new IOException("planning_health_oversized");
        Failure row;
        try {row=new Gson().fromJson(Files.readString(file),Failure.class);}
        catch(RuntimeException invalid){throw new IOException("planning_health_invalid",invalid);}
        if(row==null||!id.equals(row.maidId())||row.requestId()==null||row.consecutive()<0||row.consecutive()>16
            ||row.failedAt()<0||row.delayMs()<0||row.delayMs()>3_600_000||row.reason()==null
            ||!row.reason().matches("[a-z_]{1,80}"))throw new IOException("planning_health_invalid");
        cache.put(id,row);return row;
    }
    private void write(Failure row)throws IOException {
        ResidentReceipts.replace(root.resolve(row.maidId()+".json"),row);cache.put(row.maidId(),row);
    }
    Map<String,Object> status(UUID id,long now)throws IOException {
        Failure row=read(id);int count=row==null?0:row.consecutive();
        // A backwards wall-clock correction cannot extend a pause beyond its original delay.
        long remaining=row==null?0:Math.max(0,row.delayMs()-Math.max(0,now-row.failedAt()));
        var out=new LinkedHashMap<String,Object>();out.put("status",remaining>0?"backoff":"ready");
        out.put("consecutiveFailures",count);out.put("retryAfterMs",remaining);
        out.put("retryable",remaining==0);out.put("nativeTasksPaused",false);
        if(row!=null&&count>0){out.put("lastFailureRequestId",row.requestId().toString());out.put("lastReason",row.reason());}
        return out;
    }
    Map<String,Object> failed(UUID id,UUID request,String reason,long now)throws IOException {
        if(reason==null||!reason.matches("[a-z_]{1,80}")||now<0)throw new IllegalArgumentException("planning_failure_invalid");
        Failure old=read(id);
        if(old!=null&&request.equals(old.requestId()))return status(id,now);
        int count=old==null?1:Math.min(16,old.consecutive()+1);
        long delay=Math.max(baseDelay,Math.min(300_000,baseDelay*(1L<<Math.min(4,count-1))));
        write(new Failure(id,request,count,reason,now,delay));return status(id,now);
    }
    void healthy(UUID id,UUID request)throws IOException {
        Failure old=read(id);if(old==null||old.consecutive()==0)return;
        write(new Failure(id,request,0,"healthy",0,0));
    }
}
