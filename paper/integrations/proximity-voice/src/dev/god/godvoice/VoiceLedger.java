package dev.god.godvoice;

import com.google.gson.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Append-only receipt identities survive reconnects and restarts; speech/audio are not logged. */
final class VoiceLedger {
    record Entry(String fingerprint,String state,String reason,long at) { }
    private final Path directory;
    private final Map<String,Entry> rows=new java.util.concurrent.ConcurrentHashMap<>();
    private final Gson gson=new Gson();
    VoiceLedger(Path directory)throws IOException {
        this.directory=directory;Files.createDirectories(directory);
        try(var files=Files.list(directory)){
            for(Path file:files.filter(p->p.getFileName().toString().matches("[0-9a-f-]{36}\\.jsonl")).toList()){
                if(Files.isSymbolicLink(file)||Files.size(file)>32*1024*1024)throw new IOException("VOICE_LEDGER_REQUIRES_REVIEW");
                UUID actor=UUID.fromString(file.getFileName().toString().substring(0,36));
                try(var lines=Files.newBufferedReader(file)){
                    for(String line;(line=lines.readLine())!=null;){
                        if(line.length()>2048)throw new IOException("VOICE_LEDGER_RECORD_INVALID");
                        JsonObject row=JsonParser.parseString(line).getAsJsonObject();
                        UUID request=UUID.fromString(row.get("requestId").getAsString());
                        rows.put(key(actor,request),new Entry(row.get("fingerprint").getAsString(),row.get("state").getAsString(),row.get("reason").getAsString(),row.get("at").getAsLong()));
                    }
                }catch(RuntimeException invalid){throw new IOException("VOICE_LEDGER_RECORD_INVALID",invalid);}
            }
        }
        // An interrupted transmission has an unknown outcome; never replay it.
        for(var row:new ArrayList<>(rows.entrySet()))if(!Set.of("sent","cancelled","failed","unknown").contains(row.getValue().state)){
            String[] ids=row.getKey().split("/");transition(UUID.fromString(ids[0]),UUID.fromString(ids[1]),row.getValue().fingerprint,"unknown","RESTART_RECONCILIATION_REQUIRED");
        }
    }
    static String key(UUID actor,UUID request){return actor+"/"+request;}
    Entry get(UUID actor,UUID request){return rows.get(key(actor,request));}
    synchronized boolean reserve(UUID actor,UUID request,String fingerprint)throws IOException {
        Entry old=get(actor,request);
        if(old!=null){if(!old.fingerprint.equals(fingerprint))throw new IllegalArgumentException("REQUEST_ID_REUSED");return false;}
        transition(actor,request,fingerprint,"queued","");return true;
    }
    synchronized void transition(UUID actor,UUID request,String fingerprint,String state,String reason)throws IOException {
        long at=System.currentTimeMillis();JsonObject row=new JsonObject();
        row.addProperty("requestId",request.toString());row.addProperty("fingerprint",fingerprint);row.addProperty("state",state);row.addProperty("reason",reason);row.addProperty("at",at);
        Path file=directory.resolve(actor+".jsonl");
        if(Files.isSymbolicLink(file))throw new IOException("VOICE_LEDGER_LINK_REJECTED");
        byte[] bytes=(gson.toJson(row)+"\n").getBytes(StandardCharsets.UTF_8);
        try(var channel=FileChannel.open(file,StandardOpenOption.CREATE,StandardOpenOption.WRITE,StandardOpenOption.APPEND)){
            ByteBuffer buffer=ByteBuffer.wrap(bytes);while(buffer.hasRemaining())channel.write(buffer);channel.force(true);
        }
        rows.put(key(actor,request),new Entry(fingerprint,state,reason,at));
    }
}
