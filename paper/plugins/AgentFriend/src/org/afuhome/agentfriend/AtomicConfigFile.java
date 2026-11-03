package org.afuhome.agentfriend;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.util.concurrent.locks.LockSupport;

/** One fsynced image, one atomic commit. A transient Windows reader may deny
 * replacement; retry only that same image, never the game operation producing it. */
final class AtomicConfigFile {
    private AtomicConfigFile() {}
    static Staged stage(Path target,byte[] bytes)throws IOException {
        Path file=target.toAbsolutePath();
        Path temporary=Files.createTempFile(file.getParent(),file.getFileName()+".site-dungeon-",".tmp");
        try {
            try(FileChannel out=FileChannel.open(temporary,StandardOpenOption.WRITE)){
                ByteBuffer buffer=ByteBuffer.wrap(bytes);
                while(buffer.hasRemaining())out.write(buffer);
                out.force(true);
            }
            return new Staged(file,temporary);
        } catch(IOException failure) {
            try{Files.deleteIfExists(temporary);}catch(IOException cleanup){failure.addSuppressed(cleanup);}
            throw failure;
        }
    }
    static final class Staged implements AutoCloseable {
        private final Path target,temporary;
        private boolean committed;
        Staged(Path target,Path temporary){this.target=target;this.temporary=temporary;}
        void commit()throws IOException {
            if(committed)throw new IllegalStateException("configuration image already committed");
            long[] waits={2_000_000L,6_000_000L,14_000_000L};
            for(int attempt=0;;attempt++){
                if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("configuration commit interrupted");
                try {
                    Files.move(temporary,target,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
                    committed=true;return;
                } catch(AccessDeniedException denied) {
                    // Total requested wait is 22 ms; permanent denial still fails
                    // closed. No plain overwrite or alternate destination.
                    if(attempt==waits.length)throw denied;
                    LockSupport.parkNanos(waits[attempt]);
                }
            }
        }
        @Override public void close()throws IOException {if(!committed)Files.deleteIfExists(temporary);}
    }
}
