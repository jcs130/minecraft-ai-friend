package org.afuhome.auth;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Wire metadata is retained in payload/explicit status, never needed in an
 * automatic model-facing chat hint. This class cannot grant authentication. */
final class AuthMessages {
    private AuthMessages() { }
    static boolean agent(String name) { return name != null && name.toLowerCase(Locale.ROOT).startsWith("ag_"); }
    static boolean hello(byte[] bytes) {
        if(bytes == null || bytes.length > 256)return false;
        try {
            JsonObject o=JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject();
            return o.size()==3 && o.get("op").getAsString().equals("hello") && o.get("protocol").getAsInt()==1
                    && o.get("transport").getAsString().equals("payload");
        }catch(RuntimeException invalid){return false;}
    }
    static JsonObject compact(JsonObject state) {
        JsonObject out=state.deepCopy();
        for(String key:java.util.List.of("playerUuid","authSessionId","observedAt"))out.remove(key);
        return out;
    }
    static byte[] payload(JsonObject state) {
        JsonObject frame=new JsonObject();frame.addProperty("protocol",1);frame.addProperty("type","MC_AUTH_STATE");frame.add("data",state);
        return frame.toString().getBytes(StandardCharsets.UTF_8);
    }
}
