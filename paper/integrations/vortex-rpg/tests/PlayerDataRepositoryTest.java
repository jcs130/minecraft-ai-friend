import io.vortexcore.persistence.PlayerDataRepository;
import io.vortexcore.persistence.model.PlayerSnapshot;
import java.nio.file.*;import java.time.*;import java.util.*;import java.util.logging.*;
public final class PlayerDataRepositoryTest {
 public static void main(String[] args)throws Exception{
  Path root=Files.createTempDirectory("qd-profile-test-");UUID id=UUID.randomUUID();int checks=0;
  try(var repo=new PlayerDataRepository(Logger.getLogger("test"),root,Duration.ofMinutes(1))){
   var initial=repo.loadPlayer(id).join();if(initial.revision()!=0)throw new AssertionError();checks++;
   var saved=repo.saveAtomically(initial).join();if(saved.revision()!=1)throw new AssertionError();checks++;
   if(repo.loadPlayer(id).join().revision()!=1)throw new AssertionError("cached read");checks++;
   try{repo.saveAtomically(initial).join();throw new AssertionError("stale revision accepted");}catch(java.util.concurrent.CompletionException expected){checks++;}
   if(repo.loadPlayer(id).join().revision()!=1)throw new AssertionError("failed save changed cache");checks++;
   byte[] before=Files.readAllBytes(root.resolve(id+".json"));repo.invalidate(id).join();
   if(repo.loadPlayer(id).join().revision()!=1)throw new AssertionError("cold read");checks++;
   if(!Arrays.equals(before,Files.readAllBytes(root.resolve(id+".json"))))throw new AssertionError("read rewrites data");checks++;
   UUID broken=UUID.randomUUID();Path file=root.resolve(broken+".json");Files.writeString(file,"{broken");
   try{repo.loadPlayer(broken).join();throw new AssertionError("corrupt file reset to empty");}catch(java.util.concurrent.CompletionException expected){checks++;}
   if(!Files.readString(file).equals("{broken"))throw new AssertionError("corrupt preimage overwritten");checks++;
   try{repo.saveAtomically(PlayerSnapshot.create(broken)).join();throw new AssertionError("corrupt revision ignored");}catch(java.util.concurrent.CompletionException expected){checks++;}
   if(!Files.readString(file).equals("{broken"))throw new AssertionError("save destroyed corrupt preimage");checks++;
  }
  System.out.println(checks+" native profile persistence checks passed");
 }
}
