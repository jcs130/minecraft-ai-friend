package org.qiandengji.vortex;

import io.vortexcore.quest.RewardJournal;
import java.io.*;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

/** An audit index, never a money store. One bounded read replaces a history scan. */
final class EconomyReceipts {
    private final Path root;
    private final RewardJournal journal;
    EconomyReceipts(Path root){this.root=root;this.journal=new RewardJournal(root);}
    private Path index(UUID owner){return root.resolve(owner.toString()).resolve("pending.txt");}
    private String hash(UUID owner,String request){
        try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest((owner+"\n"+request+"\n"+Instant.EPOCH).getBytes(StandardCharsets.UTF_8)));}
        catch(Exception impossible){throw new AssertionError(impossible);}
    }
    private boolean completeFile(UUID owner,String hash)throws IOException{
        if(!hash.matches("[a-f0-9]{64}"))throw new IOException("invalid receipt index");
        Path file=root.resolve(owner.toString()).resolve(hash+".properties");
        if(!Files.exists(file))return false;
        if(Files.size(file)>65536)throw new IOException("oversized receipt");
        Properties data=new Properties();try(var in=Files.newInputStream(file)){data.load(in);}
        if(!owner.toString().equals(data.getProperty("player")))throw new IOException("receipt owner mismatch");
        return "COMPLETE".equals(data.getProperty("state"));
    }
    boolean completed(UUID owner,String request)throws IOException{return completeFile(owner,hash(owner,request));}
    boolean pending(UUID owner)throws IOException{
        Path file=index(owner);if(!Files.exists(file))return false;
        if(Files.size(file)>128)throw new IOException("invalid pending index");
        return !completeFile(owner,Files.readString(file).trim());
    }
    RewardJournal.Ticket begin(UUID owner,String request,List<String> evidence)throws IOException{
        if(pending(owner))throw new IOException("money pending reconciliation");
        Path file=index(owner);Files.createDirectories(file.getParent());
        Path tmp=Files.createTempFile(file.getParent(),"pending-",".tmp");
        try{
            Files.writeString(tmp,hash(owner,request),StandardCharsets.UTF_8);
            try(var channel=FileChannel.open(tmp,StandardOpenOption.WRITE)){channel.force(true);}
            Files.move(tmp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        }finally{Files.deleteIfExists(tmp);}
        // The pending reservation is durable before any state or bank mutation.
        return journal.prepare(owner,request,Instant.EPOCH,evidence);
    }
    void finish(UUID owner,RewardJournal.Ticket ticket)throws IOException{
        ticket.complete(); // A stale index pointing at COMPLETE is harmless, including after a crash.
        Files.deleteIfExists(index(owner));
    }
}
