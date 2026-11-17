package local.qdj.maids.brain;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

/** Real disk reloads and failure injection, no world actions or model calls. */
public final class ResidentPlanningHealthTest {
    static int checks;
    static void check(boolean value){if(!value)throw new AssertionError("planning check "+(checks+1));checks++;}
    static long wait(ResidentPlanningHealth health,UUID id,long now)throws Exception{return ((Number)health.status(id,now).get("retryAfterMs")).longValue();}
    interface Attempt{void run()throws Exception;}
    static void fails(Attempt fn)throws Exception {try{fn.run();throw new AssertionError("expected failure");}catch(java.io.IOException|IllegalArgumentException expected){checks++;}}
    public static void main(String[] args)throws Exception {
        Path root=Path.of(args[0]);Files.createDirectories(root);UUID body=UUID.randomUUID(),peer=UUID.randomUUID(),first=UUID.randomUUID();
        var health=new ResidentPlanningHealth(root,30_000);long now=1_000_000;
        check(wait(health,body,now)==0);
        health.failed(body,first,"model_unavailable",now);
        check(wait(health,body,now)==30_000);check(wait(health,peer,now)==0);
        check(Boolean.FALSE.equals(health.status(body,now).get("nativeTasksPaused")));
        health.failed(body,first,"model_unavailable",now+1000);
        check(wait(health,body,now+1000)==29_000);check(health.status(body,now).get("consecutiveFailures").equals(1));
        health=new ResidentPlanningHealth(root,30_000);
        check(wait(health,body,now+10_000)==20_000);check(wait(health,body,now-999_999)==30_000);
        now+=30_000;check(wait(health,body,now)==0);
        health.failed(body,UUID.randomUUID(),"invalid_model_action",now);
        check(wait(health,body,now)==60_000);
        health.failed(body,UUID.randomUUID(),"model_deadline_no_action",now+60_000);
        check(wait(health,body,now+60_000)==120_000);
        for(int i=0;i<30;i++)health.failed(body,UUID.randomUUID(),"model_unavailable",now+1_000_000+i);
        check(wait(health,body,now+1_000_029)==300_000);check(health.status(body,now).get("consecutiveFailures").equals(16));
        health.healthy(body,UUID.randomUUID());
        var restored=new ResidentPlanningHealth(root,30_000);
        check(wait(restored,body,now)==0);check(restored.status(body,now).get("consecutiveFailures").equals(0));
        var slow=new ResidentPlanningHealth(root.resolve("slow"),3_600_000);slow.failed(body,UUID.randomUUID(),"model_unavailable",now);
        check(wait(slow,body,now)==3_600_000);
        Path wrong=root.resolve(peer+".json");Files.copy(root.resolve(body+".json"),wrong);
        fails(()->new ResidentPlanningHealth(root,30_000).status(peer,2_000_000));
        Files.writeString(wrong,"not-json");fails(()->new ResidentPlanningHealth(root,30_000).status(peer,2_000_000));
        Files.writeString(wrong," ".repeat(4097));fails(()->new ResidentPlanningHealth(root,30_000).status(peer,2_000_000));
        fails(()->new ResidentPlanningHealth(root,1));
        Path denied=root.resolve("denied");Files.createDirectories(denied.resolve(body+".json"));Files.writeString(denied.resolve(body+".json/keep"),"test");
        fails(()->new ResidentPlanningHealth(denied,30_000).failed(body,first,"model_unavailable",2_000_000));
        System.out.println("Resident inference restart/backoff checks passed: "+checks);
    }
}
