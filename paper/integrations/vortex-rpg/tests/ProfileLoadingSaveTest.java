import io.vortexcore.persistence.*;
import io.vortexcore.persistence.model.*;
import io.vortexcore.player.*;
import io.vortexcore.rpg.*;
import io.vortexcore.scheduling.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.logging.*;
public final class ProfileLoadingSaveTest {
    static int checks;
    static void check(boolean value,String name){if(!value)throw new AssertionError(name);checks++;}
    public static void main(String[] args)throws Exception{
        Path dir=Files.createTempDirectory("qd-loading-save-");Logger logger=Logger.getLogger("qa-profile-save");
        try(var repository=new PlayerDataRepository(logger,dir,Duration.ofMinutes(1))){
            var scheduler=(FoliaExecutionFacade)Proxy.newProxyInstance(ProfileLoadingSaveTest.class.getClassLoader(),new Class<?>[]{FoliaExecutionFacade.class},(p,m,a)->{if(m.getName().equals("runGlobal")){((Runnable)a[1]).run();return null;}throw new UnsupportedOperationException(m.getName());});
            var service=new PlayerProfileService(null,logger,scheduler,repository,null,null,null,null,null);
            UUID blocked=UUID.randomUUID(),ready=UUID.randomUUID();var saved=repository.saveAtomically(PlayerSnapshot.create(blocked)).join();byte[] before=Files.readAllBytes(dir.resolve(blocked+".json"));
            var blockedProfile=new UnifiedPlayer(blocked,"qa-blocked");blockedProfile.applySnapshot(saved);
            var field=PlayerProfileService.class.getDeclaredField("profiles");field.setAccessible(true);var profiles=(Map<UUID,UnifiedPlayer>)field.get(service);profiles.put(blocked,blockedProfile);
            var loadingField=PlayerProfileService.class.getDeclaredField("loadingPlayers");loadingField.setAccessible(true);((Set<UUID>)loadingField.get(service)).add(blocked);
            var queue=PlayerProfileService.class.getDeclaredMethod("queueSave",UUID.class,String.class,UnifiedPlayer.class);queue.setAccessible(true);
            var refused=(CompletableFuture<?>)queue.invoke(service,blocked,"qa-blocked",blockedProfile);
            boolean failed=false;try{refused.join();}catch(CompletionException expected){failed=true;}
            check(failed,"unloaded snapshot save is refused");check(Arrays.equals(before,Files.readAllBytes(dir.resolve(blocked+".json"))),"refused save preserves exact native file");
            var readyProfile=new UnifiedPlayer(ready,"qa-ready");profiles.put(ready,readyProfile);var accepted=(CompletableFuture<?>)queue.invoke(service,ready,"qa-ready",readyProfile);accepted.join();check(Files.isRegularFile(dir.resolve(ready+".json")),"loaded profile still saves");
            var drained=service.flushAndClose(Duration.ofSeconds(2));int tracked=(Integer)drained.getClass().getRecordComponents()[0].getAccessor().invoke(drained);
            check(tracked==1,"shutdown only tracks the loaded profile");check(Arrays.equals(before,Files.readAllBytes(dir.resolve(blocked+".json"))),"shutdown preserves unverified file");
        }
        System.out.println("ProfileLoadingSaveTest: "+checks+" passed");
    }
}
