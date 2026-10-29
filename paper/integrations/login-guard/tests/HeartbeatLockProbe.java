package org.afuhome.auth;
import java.nio.file.Path;
/** Test-only real Windows sharing-lock reproducer. */
public final class HeartbeatLockProbe {
 public static void main(String[] args)throws Exception{System.out.println("READY");System.out.flush();AtomicHeartbeatSnapshot.write(Path.of(args[0]),"new generation");System.out.println("DONE");}
}
