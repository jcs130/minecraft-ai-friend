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
        return stage(target,bytes,target.toAbsolutePath().getParent());
    }
    static Staged stage(Path target,byte[] bytes,Path directory)throws IOException {
        return stage(target,bytes,directory,".tmp");
    }
    static Staged stage(Path target,byte[] bytes,Path directory,String suffix)throws IOException {
        if(!suffix.equals(".tmp")&&!suffix.equals(".state"))throw new IllegalArgumentException("unsupported owned image suffix");
        Path file=target.toAbsolutePath();
        Path temporary=Files.createTempFile(directory,file.getFileName()+".site-dungeon-",suffix);
        try {
            try(FileChannel out=FileChannel.open(temporary,StandardOpenOption.WRITE)){
                ByteBuffer buffer=ByteBuffer.wrap(bytes);
                while(buffer.hasRemaining())out.write(buffer);
                out.force(true);
            }
            DurableFileMove.forceDirectory(directory);
            return new Staged(file,temporary);
        } catch(IOException failure) {
            try{Files.deleteIfExists(temporary);}catch(IOException cleanup){failure.addSuppressed(cleanup);}
            throw failure;
        }
    }
    static final class Staged implements AutoCloseable {
        private final Path target,temporary;
        private boolean committed,retained;
        Staged(Path target,Path temporary){this.target=target;this.temporary=temporary;}
        Path image(){return temporary;}
        void retain(){retained=true;}
        void commit()throws IOException {
            commit(3);
        }
        void commitOnce()throws IOException {commit(0);}
        private void commit(int retries)throws IOException {
            if(committed)throw new IllegalStateException("configuration image already committed");
            long[] waits={2_000_000L,6_000_000L,14_000_000L};
            for(int attempt=0;;attempt++){
                if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("configuration commit interrupted");
                try {
                    DurableFileMove.replace(temporary,target);
                    committed=true;return;
                } catch(AccessDeniedException denied) {
                    // Total requested wait is 22 ms; permanent denial still fails
                    // closed. No plain overwrite or alternate destination.
                    if(attempt==retries)throw denied;
                    LockSupport.parkNanos(waits[attempt]);
                }
            }
        }
        @Override public void close()throws IOException {if(!committed&&!retained)Files.deleteIfExists(temporary);}
    }
}
