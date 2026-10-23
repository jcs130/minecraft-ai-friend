import org.agentmc.bridge.MethodCalls;
import com.google.gson.JsonNull;
import java.util.concurrent.atomic.AtomicInteger;

public final class MethodCallsCheck {
    private static void check(boolean ok){if(!ok)throw new AssertionError();}
    private static void rejects(Runnable run){try{run.run();throw new AssertionError("Expected rejection");}catch(IllegalArgumentException|IllegalStateException expected){}}
    public static void main(String[] args){
        MethodCalls calls=new MethodCalls();AtomicInteger dispatched=new AtomicInteger(),effect=new AtomicInteger();
        calls.call(1,"look:0",1,()->{dispatched.incrementAndGet();return JsonNull.INSTANCE;},()->effect::incrementAndGet);
        calls.call(1,"look:0",1,()->{throw new AssertionError("Replayed");},()->null);
        rejects(()->calls.call(1,"look:1",1,()->JsonNull.INSTANCE,()->null));
        rejects(()->calls.call(2,"move",1,()->JsonNull.INSTANCE,()->null));
        check(dispatched.get()==1&&calls.pending());calls.tick();check(calls.pending()&&effect.get()==0);
        calls.tick();check(!calls.pending()&&effect.get()==1&&calls.result(1).get("status").getAsString().equals("completed"));
        calls.call(2,"ticks:20",20,()->JsonNull.INSTANCE,()->null);for(int i=0;i<20;i++)calls.tick();check(calls.pending());calls.tick();check(!calls.pending());
        calls.call(3,"interaction",1,()->JsonNull.INSTANCE,()->()->{throw new IllegalStateException("Target changed");});calls.tick();calls.tick();check(calls.result(3).get("status").getAsString().equals("failed"));
        rejects(()->calls.result(4));rejects(()->calls.call(5,"skip",1,()->JsonNull.INSTANCE,()->null));
        for(int i=4;i<=32;i++){calls.call(i,"bounded",1,()->JsonNull.INSTANCE,()->null);calls.tick();calls.tick();}
        rejects(()->calls.call(33,"overflow",1,()->JsonNull.INSTANCE,()->null));
        MethodCalls async=new MethodCalls();AtomicInteger sent=new AtomicInteger(),reply=new AtomicInteger();
        async.call(1,"equip",1,()->{sent.incrementAndGet();return JsonNull.INSTANCE;},()->null,()->()->reply.get()>0);
        for(int i=0;i<30;i++)async.tick();check(async.pending()&&sent.get()==1);
        async.call(1,"equip",1,()->{throw new AssertionError("Repeated dispatch");},()->null,()->null);
        reply.incrementAndGet();async.tick();check(!async.pending()&&async.result(1).get("status").getAsString().equals("completed"));
        async.call(2,"lost",1,()->JsonNull.INSTANCE,()->null,()->()->{throw new IllegalStateException("confirmation unknown");});async.tick();async.tick();check(async.result(2).get("status").getAsString().equals("failed"));
        System.out.println("Native method deduplication, ordered admission, actual tick waits, deferred dispatch and failure receipts passed");
    }
}
