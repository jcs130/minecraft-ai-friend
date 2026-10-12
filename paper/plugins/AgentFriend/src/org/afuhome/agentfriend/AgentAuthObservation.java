package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.UUID;

/** Validation of trusted local observations, not an authorization mechanism. */
final class AgentAuthObservation {
    static JsonObject current(JsonObject heartbeat,UUID player,long joinedAt,long now) {
        try {
            long heartbeatAt=heartbeat.get("at").getAsLong();
            if(heartbeatAt>now+5000||now-heartbeatAt>AgentCommunication.AUTH_TTL)return null;
            if(!heartbeat.has("ready")||!heartbeat.get("ready").isJsonPrimitive()||!heartbeat.get("ready").getAsJsonPrimitive().isBoolean())return null;
            for(JsonElement row:heartbeat.getAsJsonArray("sessionStates")) {
                JsonObject auth=row.getAsJsonObject();long at=auth.get("observedAt").getAsLong();
                if(!auth.get("playerUuid").getAsString().equals(player.toString())||at<joinedAt||at>now+5000||now-at>AgentCommunication.AUTH_TTL)continue;
                UUID.fromString(auth.get("authSessionId").getAsString());
                if(!auth.get("source").getAsString().equals("login_guard"))return null;
                JsonElement authorized=auth.get("authorized");String status=auth.get("status").getAsString();
                boolean unavailable=status.equals("unavailable")&&authorized.isJsonNull();
                if(!unavailable&&(!authorized.isJsonPrimitive()||!authorized.getAsJsonPrimitive().isBoolean()
                        ||!status.equals(authorized.getAsBoolean()?"authenticated":"pending")))return null;
                JsonObject result=auth.deepCopy();
                if(!heartbeat.get("ready").getAsBoolean()){result.addProperty("status","unavailable");result.add("authorized",JsonNull.INSTANCE);}
                return result;
            }
        }catch(RuntimeException malformed){/* Missing fields and malformed types are unknown. */}
        return null;
    }
}
