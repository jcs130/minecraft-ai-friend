package org.afuhome.appearance;

import com.google.gson.*;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;

/** Fresh local server-authoritative state; never reads a player's submitted model claim. */
final class BedrockState {
    static final String YSM_SHA="ec51cfae84d219a45fac5098a31bfe980bcb7c2d8b413e8fffbd05a411a85680";
    static final String NATIVE_265_SHA="b285c73d4ec010d9a9be3c53c1bee890cf269645be5f1bcf1c27a2e8e82807cb";
    record Entry(UUID uuid,int entityId,String epoch,String modelId,String texture,String sha256,String animation) {
        Entry(UUID uuid,int entityId,String epoch,String modelId,String texture,String sha256){this(uuid,entityId,epoch,modelId,texture,sha256,"");}
    }
    static Map<UUID,Entry> read(Path path,long now) throws Exception {
        return read(path,now,"2.4.1");
    }
    static Map<UUID,Entry> read(Path path,long now,String ysmVersion) throws Exception {
        boolean native265="2.6.5".equals(ysmVersion);
        if(!native265&&!"2.4.1".equals(ysmVersion))throw new IOException("YSM_BEDROCK_PROFILE_MISMATCH");
        String source=native265?"ysm_native_backend":"freesia_worker",hash=native265?NATIVE_265_SHA:YSM_SHA,protocol=native265?"2.6.0":"2.4.0";
        if(!path.isAbsolute() || Files.isSymbolicLink(path) || !Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS) || Files.size(path)>96*1024)throw new IOException("YSM_BEDROCK_STATE_UNAVAILABLE");
        JsonObject root=JsonParser.parseString(Files.readString(path)).getAsJsonObject();
        long written=root.get("writtenAt").getAsLong();
        if(root.get("schemaVersion").getAsInt()!=1 || !source.equals(root.get("source").getAsString()) || written>now+2000 || now-written>15000)throw new IOException("YSM_BEDROCK_STATE_EXPIRED");
        String epoch=root.get("epoch").getAsString();UUID.fromString(epoch);
        JsonArray players=root.getAsJsonArray("players");if(players.size()>40)throw new IOException("YSM_BEDROCK_STATE_BUDGET");
        Map<UUID,Entry> out=new HashMap<>();
        for(JsonElement element:players) {
            JsonObject row=element.getAsJsonObject();
            if(!row.get("available").getAsBoolean() || !row.get("webAvailable").getAsBoolean())continue;
            if(!epoch.equals(row.get("epoch").getAsString()) || !hash.equals(row.get("jarSha256").getAsString()) || !ysmVersion.equals(row.get("ysmVersion").getAsString()) || !protocol.equals(row.get("protocolVersion").getAsString())
                || native265&&(!row.has("source")||!source.equals(row.get("source").getAsString())))throw new IOException("YSM_BEDROCK_PROFILE_MISMATCH");
            UUID uuid=UUID.fromString(row.get("playerUuid").getAsString());String model=row.get("modelId").getAsString(),texture=row.get("texture").getAsString(),sha=row.get("assetSha256").getAsString();
            int entityId=row.get("entityId").getAsInt();
            if(!ModelCatalog.validId(model) || !texture.matches("[\\p{L}\\p{N}_.-]{1,96}") || !sha.matches("[0-9a-f]{64}") || entityId<0 || out.containsKey(uuid))throw new IOException("YSM_BEDROCK_STATE_INVALID");
            String animation=row.has("animation")?row.get("animation").getAsString():"";
            if(animation.length()>96)throw new IOException("YSM_BEDROCK_STATE_INVALID");
            out.put(uuid,new Entry(uuid,entityId,epoch,model,texture,sha,animation));
        }
        return Map.copyOf(out);
    }
}
