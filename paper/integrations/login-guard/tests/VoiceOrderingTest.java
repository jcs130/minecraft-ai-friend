package org.afuhome.auth;

import com.velocitypowered.api.plugin.*;
import com.velocitypowered.proxy.event.VelocityEventManager;
import java.util.*;
import java.util.concurrent.*;

/** Real pinned dispatcher + full LoginGuard annotations; a legal adversarial worker schedule.
 * No socket, account database, audio, sleep or production service is used. */
public final class VoiceOrderingTest {
    static final class Workers extends AbstractExecutorService {
        final List<Runnable> jobs=new ArrayList<>();
        public void execute(Runnable job){jobs.add(job);}
        void reverse(){while(!jobs.isEmpty())jobs.removeLast().run();}
        public void shutdown(){} public List<Runnable> shutdownNow(){return List.of();}
        public boolean isShutdown(){return false;} public boolean isTerminated(){return false;}
        public boolean awaitTermination(long timeout,TimeUnit unit){return true;}
    }
    public static void main(String[] args)throws Exception {
        for(boolean reply:new boolean[]{false,true}) {
            var fixture=new VoiceTransportTest.Fixture();var workers=new Workers();
            var description=(PluginDescription)AuthObservationTest.stub(PluginDescription.class,(m,a)->switch(m.getName()){
                case "getId"->"voice-ordering-qa";case "getName"->Optional.of("Voice ordering QA");
                default->AuthObservationTest.empty(m.getReturnType());
            });
            var plugin=(PluginContainer)AuthObservationTest.stub(PluginContainer.class,(m,a)->switch(m.getName()){
                case "getDescription"->description;case "getExecutorService"->workers;
                case "getInstance"->Optional.of(fixture.guard);default->AuthObservationTest.empty(m.getReturnType());
            });
            var manager=(PluginManager)AuthObservationTest.stub(PluginManager.class,(m,a)->Optional.of(plugin));
            var events=new VelocityEventManager(manager);events.registerInternally(plugin,fixture.guard);
            var observed=new ArrayList<Integer>();var futures=new ArrayList<CompletableFuture<?>>();
            for(int sequence=0;sequence<3;sequence++) {
                int n=sequence;byte[] payload={(byte)2,(byte)n};
                futures.add(events.fire(fixture.event(reply,payload)).thenAccept(e->{
                    if(e.getResult().isAllowed())observed.add((int)e.getData()[1]);
                }));
            }
            // Independent cached-pool tasks may complete in any order. The candidate
            // must not submit these read-only gates to that pool in the first place.
            workers.reverse();CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new)).join();
            if(!observed.equals(List.of(0,1,2)))throw new AssertionError((reply?"S2C":"C2S")+" reordered: "+observed);
            if(!workers.jobs.isEmpty())throw new AssertionError("stray event work");
        }
        System.out.println("PASS real Velocity dispatcher preserves C2S chunks/finish and S2C receipts");
    }
}
