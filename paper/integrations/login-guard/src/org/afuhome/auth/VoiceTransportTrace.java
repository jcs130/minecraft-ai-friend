package org.afuhome.auth;

import com.google.gson.*;
import com.velocitypowered.api.event.connection.PluginMessageEvent;
import com.velocitypowered.api.proxy.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;

/** Explicit one-window diagnostics, disabled by default. Never changes event results. */
final class VoiceTransportTrace {
    private final boolean enabled;private int count;
    VoiceTransportTrace(boolean enabled){this.enabled=enabled;}
    synchronized Map<String,Object> record(PluginMessageEvent event,Player player,ServerConnection backend){
        if(!enabled||count>=256)return null;
        var row=new LinkedHashMap<String,Object>();byte[] data=event.getData();
        row.put("schema",1);row.put("event","guard_decision_not_delivery");row.put("ordinal",++count);row.put("at",System.currentTimeMillis());
        row.put("direction",event.getSource() instanceof Player?"C2S":"S2C");row.put("actor",player.getUniqueId());
        row.put("playerConnection",System.identityHashCode(player));row.put("backendConnection",System.identityHashCode(backend));
        row.put("allowedAtGuard",event.getResult().isAllowed());row.put("frameBytes",data.length);
        if(data.length<=65_536)try{row.put("frameSha256",HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data)));}catch(NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}
        try{
            if(data.length>=17&&data[0]==2){var b=ByteBuffer.wrap(data,1,data.length-1);row.put("requestId",new UUID(b.getLong(),b.getLong()).toString());row.put("op","chunk");if(data.length>=21){row.put("sequence",b.getInt());row.put("chunkBytes",data.length-21);}}
            else if(data.length>1&&data.length<=16_001&&data[0]==1){var c=JsonParser.parseString(new String(data,1,data.length-1,StandardCharsets.UTF_8)).getAsJsonObject();
                for(String key:List.of("requestId","op","state","reason"))if(c.has(key)&&c.get(key).isJsonPrimitive()){
                    String value=c.get(key).getAsString();if(value.matches("[A-Za-z0-9_-]{1,80}"))row.put(key,value);
                }
            }
        }catch(RuntimeException ignored){row.put("headerInvalid",true);}
        return row;
    }
}
