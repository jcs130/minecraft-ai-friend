package org.qiandengji.mcbot;

import com.google.gson.*;
import java.nio.file.*;
import java.nio.channels.FileChannel;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Only the association is stored here; Numen owns identity and all player data. */
public final class Bindings {
    public record Binding(UUID body,String name,boolean paused){}
    private final Path file;
    private final Map<UUID,Binding> entries=new HashMap<>();
    public Bindings(Path file)throws java.io.IOException{
        this.file=file;
        if(!Files.exists(file))return;
        if(Files.size(file)>1024*1024)throw new IllegalStateException("binding file too large");
        JsonObject root=JsonParser.parseString(Files.readString(file)).getAsJsonObject();
        if(Wire.integer(root,"schemaVersion",1,1)!=1)throw new IllegalStateException("binding schema unavailable");
        JsonObject rows=root.getAsJsonObject("owners");
        for(String owner:rows.keySet()){
            JsonObject b=rows.getAsJsonObject(owner);UUID body=UUID.fromString(Wire.string(b,"body",36,36));
            String name=Wire.string(b,"name",1,16);if(!name.matches("[A-Za-z0-9_]+"))throw new IllegalStateException("invalid stored name");
            entries.put(UUID.fromString(owner),new Binding(body,name,Wire.bool(b,"paused",false)));
        }
    }
    public Binding get(UUID owner){return entries.get(owner);}
    public void put(UUID owner,Binding binding)throws java.io.IOException{
        Map<UUID,Binding> next=new HashMap<>(entries);if(binding==null)next.remove(owner);else next.put(owner,binding);
        JsonObject root=new JsonObject(),rows=new JsonObject();root.addProperty("schemaVersion",1);root.add("owners",rows);
        next.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(e->{
            JsonObject b=new JsonObject();b.addProperty("body",e.getValue().body().toString());b.addProperty("name",e.getValue().name());b.addProperty("paused",e.getValue().paused());rows.add(e.getKey().toString(),b);
        });
        Files.createDirectories(file.toAbsolutePath().getParent());Path temp=file.resolveSibling(file.getFileName()+"."+UUID.randomUUID()+".tmp");
        try{
            byte[] bytes=root.toString().getBytes(StandardCharsets.UTF_8);
            try(FileChannel c=FileChannel.open(temp,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE)){ByteBuffer buffer=ByteBuffer.wrap(bytes);while(buffer.hasRemaining())c.write(buffer);c.force(true);}
            Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);entries.clear();entries.putAll(next);
        }finally{Files.deleteIfExists(temp);}
    }
}
