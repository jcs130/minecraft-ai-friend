package org.afuhome.auth;
import java.nio.file.*;import java.io.*;import java.util.concurrent.atomic.AtomicInteger;
public final class AtomicHeartbeatSnapshotTest {
 public static void main(String[] args)throws Exception{
  int checks=0;var attempts=new AtomicInteger();var pauses=new AtomicInteger();AtomicHeartbeatSnapshot.retry(()->{if(attempts.incrementAndGet()<3)throw new AccessDeniedException("fixture");},n->{if(n!=25)throw new AssertionError();pauses.incrementAndGet();});if(attempts.get()!=3||pauses.get()!=2)throw new AssertionError();checks++;
  attempts.set(0);pauses.set(0);try{AtomicHeartbeatSnapshot.retry(()->{attempts.incrementAndGet();throw new AccessDeniedException("fixture");},n->pauses.incrementAndGet());throw new AssertionError();}catch(AccessDeniedException expected){}if(attempts.get()!=10||pauses.get()!=9)throw new AssertionError();checks++;
  attempts.set(0);try{AtomicHeartbeatSnapshot.retry(()->{attempts.incrementAndGet();throw new IOException("not a sharing error");},n->{throw new AssertionError();});throw new AssertionError();}catch(IOException expected){}if(attempts.get()!=1)throw new AssertionError();checks++;
  try{AtomicHeartbeatSnapshot.retry(()->{throw new AccessDeniedException("fixture");},n->{throw new InterruptedException();});throw new AssertionError();}catch(InterruptedIOException expected){}if(!Thread.interrupted())throw new AssertionError();checks++;
  Path file=Path.of(args[0]);Files.writeString(file,"old");AtomicHeartbeatSnapshot.write(file,"{\"ready\":true}");if(!Files.readString(file).equals("{\"ready\":true}")||Files.exists(Path.of(file+".tmp")))throw new AssertionError();checks++;
  if(!java.lang.reflect.Modifier.isSynchronized(LoginGuard.class.getDeclaredMethod("publishHeartbeat").getModifiers()))throw new AssertionError();checks++;
  System.out.println("PASS "+checks+" atomic publication/retry/interruption/serialization checks");
 }
}
