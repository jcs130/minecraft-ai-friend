package org.afuhome.agentfriend;

import java.lang.reflect.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import sun.misc.Unsafe;

/** Executes real presentation/eligibility code; no server, save, damage or teleport. */
public final class DungeonLifecycleTest {
    private static int checks;
    private static void check(boolean value,String name){if(!value)throw new AssertionError(name);checks++;}
    private static void set(Object target,String name,Object value)throws Exception{
        var field=target.getClass().getDeclaredField(name);field.setAccessible(true);field.set(target,value);
    }
    public static void main(String[] args)throws Exception{
        var field=Unsafe.class.getDeclaredField("theUnsafe");field.setAccessible(true);var unsafe=(Unsafe)field.get(null);
        var manager=(SiteDungeonManager)unsafe.allocateInstance(SiteDungeonManager.class);
        var plugin=(AgentFriendPlugin)unsafe.allocateInstance(AgentFriendPlugin.class);set(manager,"plugin",plugin);
        var id=UUID.randomUUID();var place=new Location(null,0,81,0);
        Player player=(Player)Proxy.newProxyInstance(DungeonLifecycleTest.class.getClassLoader(),new Class<?>[]{Player.class},(p,m,a)->switch(m.getName()){
            case "getUniqueId"->id;case "getLocation"->place;case "getGameMode"->GameMode.SURVIVAL;
            case "isOnline"->true;case "isDead"->false;default->throw new UnsupportedOperationException(m.getName());
        });
        Class<?> runClass=Class.forName(SiteDungeonManager.class.getName()+"$Run");
        Object run=unsafe.allocateInstance(runClass);set(run,"party",new LinkedHashSet<>(Set.of(id)));
        set(run,"id","qa-live-run");set(run,"fault","");set(run,"started",System.currentTimeMillis()-30_000L);
        var lifecycle=SiteDungeonManager.class.getDeclaredMethod("lifecycle",Map.class,runClass,Player.class,Map.class);lifecycle.setAccessible(true);
        var state=new LinkedHashMap<String,Object>();
        lifecycle.invoke(manager,state,run,player,Map.of());
        check(state.get("lifecycle").equals("active")&&state.get("participantRun").equals("qa-live-run"),"active identity is current participant run");
        check(state.get("timeLimitSeconds").equals(1800L),"reports the real 30 minute limit");
        long remaining=(Long)state.get("remainingSeconds");check(remaining>=1768&&remaining<=1770,"remaining time is computed from the real clock");
        check(state.get("rescueActive").equals(false),"missing rescue service is never a guarantee");
        set(run,"fault","data_unavailable");long paused=System.currentTimeMillis()-60_000L;
        set(run,"started",paused-300_000L);set(run,"pausedAt",paused);set(run,"faultPausedMillis",60_000L);
        state.clear();lifecycle.invoke(manager,state,run,player,Map.of());
        check(state.get("remainingSeconds").equals(1560L),"current fault freezes clock and prior fault pause is excluded");
        set(run,"fault","");set(run,"started",System.currentTimeMillis()-2_000_000L);set(run,"faultPausedMillis",0L);
        state.clear();lifecycle.invoke(manager,state,run,player,Map.of());check(state.get("remainingSeconds").equals(0L),"expired clock never goes negative");
        var outcome=Map.<String,Object>of("reason","time_limit","endedAt",123L,"run","qa-old-run");
        state.clear();lifecycle.invoke(manager,state,null,player,outcome);
        check(state.get("lifecycle").equals("ended")&&state.get("participantRun").equals("")&&state.get("rescueActive").equals(false),"terminal state invalidates old membership and rescue");
        check(state.get("endReason").equals("time_limit")&&state.get("endedAt").equals(123L),"terminal evidence retained");
        check(!state.containsKey("remainingSeconds")&&!state.containsKey("checkpoint"),"terminal state does not advertise a live checkpoint or countdown");
        set(run,"party",Set.of(UUID.randomUUID()));state.clear();lifecycle.invoke(manager,state,run,player,outcome);
        check(state.get("lifecycle").equals("ended")&&state.get("rescueActive").equals(false),"another team's run never revives old membership");
        state.clear();lifecycle.invoke(manager,state,null,player,Map.of());check(state.get("lifecycle").equals("none")&&state.get("rescueActive").equals(false),"no history means none, not a fault");
        var rescue=(TrialRescueManager)unsafe.allocateInstance(TrialRescueManager.class);
        var covers=TrialRescueManager.class.getDeclaredMethod("covers",TrialRescueManager.Team.class,Player.class);covers.setAccessible(true);
        var at=List.of(false,true);for(boolean inside:at)for(int size:List.of(1,2))for(String prefix:List.of("site:","tower:")){
            Set<UUID> members=size==1?Set.of(id):Set.of(id,UUID.randomUUID());
            var team=new TrialRescueManager.Team(prefix+"qa",members,l->inside,false,()->false,()->{},place);
            check(covers.invoke(rescue,team,player).equals(inside&&(size==2||prefix.equals("site:"))),"shared lethal guard: "+prefix+size+" inside="+inside);
        }
        check(covers.invoke(rescue,null,player).equals(false),"ended team cannot intercept a lethal hit");
        System.out.println("DungeonLifecycleTest: "+checks+" passed");
    }
}
