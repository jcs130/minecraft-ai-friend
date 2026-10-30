package io.vortexcore.rpg;

import io.vortexcore.scheduling.FoliaExecutionFacade;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Logger;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;

/** Retries only the validated join-snapshot callback, never gameplay actions or file reads. */
public final class ProfileJoinDispatch {
    private ProfileJoinDispatch() { }
    public static boolean runWhenReady(FoliaExecutionFacade scheduler,Entity entity,String name,Runnable action){
        var inFlight=new AtomicBoolean();var finished=new AtomicBoolean();int[] ticks={0};
        scheduler.runGlobalTimer(name+"-entity-ready",1L,1L,task->{
            if(finished.get()||entity instanceof Player p&&!p.isOnline()){task.cancel();return;}
            if(++ticks[0]>200){task.cancel();Logger.getLogger("VortexRPG").warning("Profile actor did not become ready; persisted data retained. Wait for recovery before reconnecting.");return;}
            if(!inFlight.compareAndSet(false,true))return;
            boolean accepted=scheduler.runEntity(entity,name,()->{
                task.cancel();if(finished.compareAndSet(false,true))action.run();
            },()->inFlight.set(false));
            if(!accepted)inFlight.set(false);
        });
        return true; // Scheduled, not a claim that the snapshot has been applied.
    }
}
