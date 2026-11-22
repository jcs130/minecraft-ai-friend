package local.tlmcompat.hybrid;

import com.google.gson.JsonObject;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

public final class MaidLifecyclePersistenceFixture {
    private static void check(boolean yes,String reason){if(!yes)throw new AssertionError(reason);}
    private static void waitFor(MaidLifecyclePersistence persistence,BooleanSupplier ready)throws Exception{
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
        while(!ready.getAsBoolean()&&System.nanoTime()<deadline){persistence.pump();Thread.sleep(5);}
        check(ready.getAsBoolean(),"writer did not reach expected state");
    }
    public static void main(String[] args)throws Exception{
        UUID owner=UUID.randomUUID(),first=UUID.randomUUID(),second=UUID.randomUUID();
        JsonObject root=new JsonObject(),facts=new JsonObject();facts.addProperty("name","fixture");
        MaidLifeEpisodes lifecycle=new MaidLifeEpisodes(root);
        CountDownLatch started=new CountDownLatch(1),unblock=new CountDownLatch(1),secondStarted=new CountDownLatch(1),secondUnblock=new CountDownLatch(1);
        AtomicInteger writes=new AtomicInteger(); AtomicReference<Throwable> failure=new AtomicReference<>();
        Thread caller=Thread.currentThread();
        try(var persistence=new MaidLifecyclePersistence(lifecycle,data->{
            check(Thread.currentThread()!=caller,"disk I/O on owner thread");
            int n=writes.incrementAndGet();
            if(n==1){
                started.countDown();check(unblock.await(5,TimeUnit.SECONDS),"first write timed out");
                check(!data.has(second.toString()),"in-flight snapshot changed");
            }else if(n==2){
                secondStarted.countDown();check(secondUnblock.await(5,TimeUnit.SECONDS),"second write timed out");
                check(data.has(first.toString())&&data.has(second.toString()),"missing coalesced death");
            }
        },failure::set)){
            lifecycle.died(owner,first,10_000,facts,null);
            String a=lifecycle.view(owner,first,10_000,null,null).getAsJsonObject("death").get("eventId").getAsString();
            persistence.pump();check(started.await(5,TimeUnit.SECONDS),"first write not dispatched");
            lifecycle.died(owner,second,11_000,facts,null);
            String b=lifecycle.view(owner,second,11_000,null,null).getAsJsonObject("death").get("eventId").getAsString();
            for(int i=0;i<100;i++)persistence.pump();
            check(writes.get()==1&&!lifecycle.durable(a)&&!lifecycle.durable(b),"duplicate write or early durability");
            unblock.countDown();waitFor(persistence,()->secondStarted.getCount()==0);
            check(lifecycle.durable(a)&&!lifecycle.durable(b),"older snapshot acknowledged newer event");
            secondUnblock.countDown();waitFor(persistence,()->lifecycle.durable(b));
            check(writes.get()==2&&!lifecycle.dirty()&&failure.get()==null,"did not retain clean verified state");
        }finally{unblock.countDown();secondUnblock.countDown();}
        UUID third=UUID.randomUUID();AtomicInteger attempts=new AtomicInteger();
        try(var persistence=new MaidLifecyclePersistence(lifecycle,data->{
            if(attempts.incrementAndGet()==1)throw new java.io.IOException("fixture");
        },failure::set)){
            lifecycle.died(owner,third,12_000,facts,null);
            String c=lifecycle.view(owner,third,12_000,null,null).getAsJsonObject("death").get("eventId").getAsString();
            waitFor(persistence,()->failure.get()!=null);
            check(!lifecycle.durable(c)&&attempts.get()==1,"failed write was acknowledged or retried immediately");
            waitFor(persistence,()->lifecycle.durable(c));
            check(attempts.get()==2,"dirty state was not retried once");
        }
        System.out.println("Maid lifecycle persistence: blocked I/O, bounded in-flight writes, exact acknowledgements and retry passed");
    }
}
