package org.afuhome.auth;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.nio.file.*;

/** Retry only an atomic observation write, never an authentication action. */
final class AtomicHeartbeatSnapshot {
    @FunctionalInterface interface Attempt { void run() throws IOException; }
    @FunctionalInterface interface Pause { void sleep(long millis) throws InterruptedException; }
    static void write(Path target,String json) throws IOException {
        Path temporary=target.resolveSibling(target.getFileName()+".tmp");
        retry(()->{Files.writeString(temporary,json);Files.move(temporary,target,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);},Thread::sleep);
    }
    static void retry(Attempt write,Pause pause) throws IOException {
        for(int attempt=0;;attempt++)try{write.run();return;}
        catch(FileSystemException sharingViolation){
            if(attempt>=9)throw sharingViolation;
            try{pause.sleep(25);}catch(InterruptedException interrupted){
                Thread.currentThread().interrupt();var failure=new InterruptedIOException("Heartbeat publication interrupted");failure.initCause(interrupted);throw failure;
            }
        }
    }
}
