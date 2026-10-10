package org.afuhome.appearance;

import com.google.gson.*;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;

/** Fresh local server-authoritative state; never reads a player's submitted model claim. */
final class BedrockState {
    static final String YSM_SHA="ec51cfae84d219a45fac5098a31bfe980bcb7c2d8b413e8fffbd05a411a85680";
    record Entry(UUID uuid,int entityId,String epoch,String modelId,String texture,String sha256) { }
    static Map<UUID,Entry> read(Path path,long now) throws Exception {
        if(!path.isAbsolute() || Files.isSymbolicLink(path) || !Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS) || Files.size(path)>96*1024)throw new IOException("YSM_BEDROCK_STATE_UNAVAILABLE");
        JsonObject root=JsonParser.parseString(Files.readString(path)).getAsJsonObject();
        long written=root.get("writtenAt").getAsLong();
        if(root.get("schemaVersion").getAsInt()!=1 || !"freesia_worker".equals(root.get("source").getAsString()) || written>now+2000 || now-written>15000)throw new IOException("YSM_BEDROCK_STATE_EXPIRED");
        String epoch=root.get("epoch").getAsString();UUID.fromString(epoch);
        JsonArray players=root.getAsJsonArray("players");if(players.size()>40)throw new IOException("YSM_BEDROCK_STATE_BUDGET");
        Map<UUID,Entry> out=new HashMap<>();
        for(JsonElement element:players) {
            JsonObject row=element.getAsJsonObject();
            if(!row.get("available").getAsBoolean() || !row.get("webAvailable").getAsBoolean())continue;
            if(!epoch.equals(row.get("epoch").getAsString()) || !YSM_SHA.equals(row.get("jarSha256").getAsString()) || !"2.4.1".equals(row.get("ysmVersion").getAsString()) || !"2.4.0".equals(row.get("protocolVersion").getAsString()))throw new IOException("YSM_BEDROCK_PROFILE_MISMATCH");
            UUID uuid=UUID.fromString(row.get("playerUuid").getAsString());String model=row.get("modelId").getAsString(),texture=row.get("texture").getAsString(),sha=row.get("assetSha256").getAsString();
            int entityId=row.get("entityId").getAsInt();
            if(!ModelCatalog.validId(model) || !texture.matches("[\\p{L}\\p{N}_.-]{1,96}") || !sha.matches("[0-9a-f]{64}") || entityId<0 || out.containsKey(uuid))throw new IOException("YSM_BEDROCK_STATE_INVALID");
            out.put(uuid,new Entry(uuid,entityId,epoch,model,texture,sha));
        }
        return Map.copyOf(out);
    }
}
