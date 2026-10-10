package org.afuhome.appearance;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;

/** Private, atomic local handoff. Never accepts client supplied appearance state. */
final class BedrockProjection {
    private final Path config;
    BedrockProjection(Path config) { this.config=config; }
    void write(String epoch, Collection<Map<String,Object>> states) throws Exception {
        JsonObject options=JsonParser.parseString(Files.readString(config)).getAsJsonObject();
        if(!options.has("bedrockStateFile"))return; // Explicit opt-in; no new listener.
        Path target=Path.of(options.get("bedrockStateFile").getAsString());
        if(!target.isAbsolute() || !Files.isDirectory(target.getParent()) || Files.isSymbolicLink(target))
            throw new IllegalArgumentException("YSM_BEDROCK_STATE_PATH_INVALID");
        if(states.size()>40)throw new IllegalArgumentException("YSM_BEDROCK_STATE_BUDGET");
        Map<String,Object> data=Map.of("schemaVersion",1,"source","freesia_worker","epoch",epoch,
            "writtenAt",System.currentTimeMillis(),"players",states);
        byte[] bytes=new Gson().toJson(data).getBytes(java.nio.charset.StandardCharsets.UTF_8);
        if(bytes.length>96*1024)throw new IllegalArgumentException("YSM_BEDROCK_STATE_BUDGET");
        Path pending=Files.createTempFile(target.getParent(),".appearance-",".tmp");
        try { Files.write(pending,bytes);Files.move(pending,target,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING); }
        finally { Files.deleteIfExists(pending); }
    }
}
