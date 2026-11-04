package org.afuhome.agentfriend;

import com.google.gson.Gson;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;

/** One writer, immutable fsynced images. A published YAML file is a projection;
 * a complete private commit record is also durable when Windows denies rename.
 * No game callback is stored, rerun, or inferred by this class. */
final class DurableConfigFiles implements AutoCloseable {
    static final int MAX_IMAGE=16*1024*1024,MAX_RECORDS=128;
    private static final Gson JSON=new Gson();
    private final Path target,directory;
    private final FileChannel lockChannel;
    private final FileLock lock;
    private long revision,publishedRevision;
    private String publishedHash,lastError="";
    private byte[] accepted;
    private Commit pending;
    private boolean initialized,poisoned,cleanupDeferred;
    private record Commit(int format,long revision,String image,long bytes,String sha256,
                          long baseRevision,String baseSha256,String recordSha256){}
    private record Located(Path path,Commit value){}
    DurableConfigFiles(Path requested)throws IOException {
        Path parent=requested.toAbsolutePath().getParent().toRealPath();
        target=parent.resolve(requested.getFileName());
        if(Files.isSymbolicLink(target))throw new IOException("state_target_is_link");
        directory=parent.resolve(".state-pending");Files.createDirectories(directory);
        if(Files.isSymbolicLink(directory))throw new IOException("state_directory_is_link");
        FileChannel channel=FileChannel.open(directory.resolve("writer.lock"),StandardOpenOption.CREATE,StandardOpenOption.WRITE);
        try {lock=channel.tryLock();if(lock==null)throw new IOException("state_writer_already_present");lockChannel=channel;}
        catch(Exception error){channel.close();throw new IOException("state_writer_unavailable",error);}
    }
    synchronized byte[] initialize(byte[] published,long sequence)throws IOException {
        if(initialized)throw new IOException("state_already_initialized");
        checkImage(published);if(sequence<0)throw new IOException("invalid_state_revision");
        List<Located> records=records();
        revision=publishedRevision=sequence;publishedHash=sha(published);accepted=published.clone();
        Located newest=null;
        for(Located row:records){
            if(newest!=null&&row.value.revision==newest.value.revision&&!row.value.equals(newest.value))throw new IOException("conflicting_state_commits");
            if(newest==null||row.value.revision>newest.value.revision)newest=row;
        }
        if(newest!=null){
            Commit commit=newest.value;
            if(sequence<commit.revision){
                if(sequence!=commit.baseRevision||!publishedHash.equals(commit.baseSha256))throw new IOException("state_projection_conflict_preserved");
                byte[] image=readImage(commit);revision=commit.revision;accepted=image;pending=commit;
            }else if(sequence==commit.revision&&!publishedHash.equals(commit.sha256))throw new IOException("state_projection_hash_conflict_preserved");
        }
        initialized=true;
        if(pending==null)cleanup(records);
        return accepted.clone();
    }
    synchronized void adoptPublished(byte[] image,long sequence)throws IOException {
        ready();if(pending!=null)throw new IOException("pending_state_reload_requires_recovery");
        checkImage(image);if(sequence<revision)throw new IOException("state_revision_would_go_backwards");
        accepted=image.clone();revision=publishedRevision=sequence;publishedHash=sha(image);
    }
    synchronized void commit(byte[] image,long next)throws IOException {
        ready();checkImage(image);
        if(next!=revision+1||next<=0)throw new IOException("state_revision_conflict");
        List<Located> older=records();
        if(older.size()>=MAX_RECORDS)throw new IOException("state_commit_capacity_preserve_existing");
        try(var staged=AtomicConfigFile.stage(target,image,directory,".state")){
            try {
                staged.commitOnce();
                accepted=image.clone();revision=publishedRevision=next;publishedHash=sha(image);pending=null;lastError="";
                // A successful durable publication must not be reported as a
                // failed game action merely because obsolete files are busy.
                cleanup(older);return;
            }catch(IOException blocked){lastError=blocked.getClass().getSimpleName();}
            String imageHash=sha(image);
            if(!Files.isRegularFile(staged.image())||Files.size(staged.image())!=image.length||!sha(Files.readAllBytes(staged.image())).equals(imageHash)){
                poisoned=true;staged.retain();throw new IOException("state_publication_unknown_preserve_receipt");
            }
            Commit value=new Commit(1,next,staged.image().getFileName().toString(),image.length,imageHash,
                    publishedRevision,publishedHash,recordHash(next,staged.image().getFileName().toString(),image.length,imageHash,publishedRevision,publishedHash));
            Path marker=directory.resolve("commit-"+UUID.randomUUID()+".json");
            staged.retain(); // Preserve both sides if a force has uncertain completion.
            try {
                byte[] descriptor=(JSON.toJson(value)+"\n").getBytes(StandardCharsets.UTF_8);
                try(FileChannel out=FileChannel.open(marker,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE)){
                    ByteBuffer bytes=ByteBuffer.wrap(descriptor);while(bytes.hasRemaining())out.write(bytes);out.force(true);
                }
                DurableFileMove.forceDirectory(directory);
            }catch(IOException unknown){poisoned=true;throw new IOException("state_commit_unknown_preserve_receipt",unknown);}
            accepted=image.clone();revision=next;pending=value;
            cleanup(older);
        }
    }
    synchronized boolean flush(){
        if(!initialized||poisoned)return false;
        if(pending!=null){
            try(var staged=new AtomicConfigFile.Staged(target,directory.resolve(pending.image))){
                staged.retain();staged.commitOnce();publishedRevision=revision;publishedHash=sha(accepted);pending=null;lastError="";
            }catch(IOException error){lastError=error.getClass().getSimpleName();return false;}
        }
        try{cleanup(records());}catch(IOException error){cleanupDeferred=true;lastError=error.getClass().getSimpleName();}
        return pending==null&&!cleanupDeferred;
    }
    synchronized long revision(){return revision;}
    synchronized boolean pending(){return pending!=null;}
    synchronized boolean needsFlush(){return pending!=null||cleanupDeferred;}
    synchronized byte[] accepted(){return accepted.clone();}
    synchronized Map<String,Object> audit(){return Map.of("durableRevision",revision,"publishedRevision",publishedRevision,
            "projectionPending",pending!=null,"cleanupPending",cleanupDeferred,"commitUnknown",poisoned,"lastMirrorError",lastError);}
    Path directory(){return directory;}
    private void ready()throws IOException {if(!initialized||poisoned||!lock.isValid())throw new IOException(poisoned?"state_commit_unknown_read_original_receipt":"state_writer_not_ready");}
    private static void checkImage(byte[] bytes)throws IOException {if(bytes==null||bytes.length==0||bytes.length>MAX_IMAGE)throw new IOException("state_image_size_limit");}
    private byte[] readImage(Commit value)throws IOException {
        Path path=directory.resolve(value.image);
        if(Files.isSymbolicLink(path)||Files.size(path)!=value.bytes)throw new IOException("state_image_size_mismatch");
        byte[] bytes=Files.readAllBytes(path);checkImage(bytes);
        if(!sha(bytes).equals(value.sha256))throw new IOException("state_image_hash_mismatch");return bytes;
    }
    private List<Located> records()throws IOException {
        List<Located> result=new ArrayList<>();
        try(var stream=Files.newDirectoryStream(directory,"commit-*.json")){
            int count=0;for(Path path:stream){
                if(++count>MAX_RECORDS)throw new IOException("state_record_scan_budget");
                if(Files.isSymbolicLink(path)||Files.size(path)>4096)throw new IOException("invalid_state_record_file");
                byte[] bytes=Files.readAllBytes(path);
                // A record lacking its final newline was never fully written.
                // Preserve incomplete evidence; never infer an accepted action.
                if(bytes.length==0||bytes[bytes.length-1]!='\n')continue;
                Commit value;
                try{value=JSON.fromJson(new String(bytes,StandardCharsets.UTF_8),Commit.class);}catch(RuntimeException invalid){throw new IOException("invalid_state_record_json",invalid);}
                String prefix=target.getFileName()+".site-dungeon-";
                if(value==null||value.format!=1||value.revision<=0||value.baseRevision<0||value.revision<=value.baseRevision||value.bytes<=0||value.bytes>MAX_IMAGE
                        ||value.image==null||!value.image.startsWith(prefix)||!value.image.substring(prefix.length()).matches("[A-Za-z0-9_-]+\\.(?:tmp|state)")
                        ||value.sha256==null||!value.sha256.matches("[a-f0-9]{64}")||value.baseSha256==null||!value.baseSha256.matches("[a-f0-9]{64}")
                        ||!recordHash(value.revision,value.image,value.bytes,value.sha256,value.baseRevision,value.baseSha256).equals(value.recordSha256))throw new IOException("invalid_state_record_preserved");
                result.add(new Located(path,value));
            }
        }
        result.sort(Comparator.comparingLong(row->row.value.revision));return result;
    }
    private void cleanup(List<Located> obsolete){
        cleanupDeferred=false;
        for(Located row:obsolete){
            if(pending!=null&&row.value.revision>=pending.revision)continue;
            try {
                Files.deleteIfExists(row.path);
                Path image=directory.resolve(row.value.image);
                if(!Files.isSymbolicLink(image))Files.deleteIfExists(image);
            }catch(IOException busy){cleanupDeferred=true;lastError="obsolete_state_cleanup_deferred";}
        }
    }
    private static String recordHash(long seq,String name,long bytes,String imageHash,long base,String baseHash){
        return sha(("1\n"+seq+"\n"+name+"\n"+bytes+"\n"+imageHash+"\n"+base+"\n"+baseHash+"\n").getBytes(StandardCharsets.US_ASCII));
    }
    static String sha(byte[] bytes){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}catch(NoSuchAlgorithmException impossible){throw new AssertionError(impossible);}}
    @Override public synchronized void close()throws IOException {try{lock.release();}finally{lockChannel.close();}}
}
