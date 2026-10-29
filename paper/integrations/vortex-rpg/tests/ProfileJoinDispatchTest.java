import io.vortexcore.rpg.ProfileJoinDispatch;
import io.vortexcore.scheduling.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.atomic.*;
import java.util.function.Consumer;
import org.bukkit.entity.Player;
public final class ProfileJoinDispatchTest {
    static int checks;
    static void check(boolean value,String name){if(!value)throw new AssertionError(name);checks++;}
    static final class Task implements VortexTask {boolean cancelled;public void cancel(){cancelled=true;}public boolean isCancelled(){return cancelled;}}
    static final class Fake implements InvocationHandler {
        final List<Map.Entry<Task,Consumer<VortexTask>>> timers=new ArrayList<>();final List<Runnable> queued=new ArrayList<>();int refused,attempts;boolean retireOnce;
        final FoliaExecutionFacade facade=(FoliaExecutionFacade)Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{FoliaExecutionFacade.class},this);
        public Object invoke(Object proxy,Method method,Object[] args){
            if(method.getName().equals("runGlobalTimer")){check((long)args[1]>=1&&(long)args[2]>=1,"deferred bounded timer");Task task=new Task();timers.add(Map.entry(task,(Consumer<VortexTask>)args[3]));return task;}
            if(method.getName().equals("runEntity")){attempts++;if(refused-->0)return false;if(retireOnce){retireOnce=false;((Runnable)args[3]).run();return true;}queued.add((Runnable)args[2]);return true;}
            throw new UnsupportedOperationException(method.getName());
        }
        void tick(){var ready=List.copyOf(queued);queued.clear();ready.forEach(Runnable::run);for(var row:timers)if(!row.getKey().cancelled)row.getValue().accept(row.getKey());}
        boolean stopped(){return timers.stream().allMatch(row->row.getKey().cancelled);}
    }
    static Player actor(AtomicBoolean online){return (Player)Proxy.newProxyInstance(ProfileJoinDispatchTest.class.getClassLoader(),new Class<?>[]{Player.class},(p,m,a)->m.getName().equals("isOnline")?online.get():m.getName().equals("toString")?"qa-player":null);}
    public static void main(String[] args){
        var online=new AtomicBoolean(true);Fake delayed=new Fake();delayed.refused=3;AtomicInteger applied=new AtomicInteger();
        ProfileJoinDispatch.runWhenReady(delayed.facade,actor(online),"qa-delayed",applied::incrementAndGet);check(applied.get()==0,"no inline snapshot application");
        for(int i=0;i<10;i++)delayed.tick();check(applied.get()==1&&delayed.attempts==4&&delayed.stopped(),"transient invalid body retried then applied once");
        Fake retired=new Fake();retired.retireOnce=true;AtomicInteger resumed=new AtomicInteger();ProfileJoinDispatch.runWhenReady(retired.facade,actor(online),"qa-retired",resumed::incrementAndGet);for(int i=0;i<5;i++)retired.tick();check(resumed.get()==1&&retired.attempts==2&&retired.stopped(),"retired callback retried without duplicate application");
        Fake disconnected=new Fake();online.set(false);AtomicInteger wrong=new AtomicInteger();ProfileJoinDispatch.runWhenReady(disconnected.facade,actor(online),"qa-offline",wrong::incrementAndGet);disconnected.tick();check(wrong.get()==0&&disconnected.attempts==0&&disconnected.stopped(),"offline body is not touched");
        Fake bounded=new Fake();online.set(true);bounded.refused=1000;ProfileJoinDispatch.runWhenReady(bounded.facade,actor(online),"qa-bounded",wrong::incrementAndGet);for(int i=0;i<250;i++)bounded.tick();check(bounded.attempts==200&&wrong.get()==0&&bounded.stopped(),"unready body bounded and does not claim loaded");
        System.out.println("ProfileJoinDispatchTest: "+checks+" passed");
    }
}
