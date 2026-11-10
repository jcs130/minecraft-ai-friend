package dev.god.godvoice;

import com.google.gson.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** stdin synthetic protocol adapter to the REAL VoiceUploads class. No Paper/SVC/TTS.
 * Framing follows PaperVoicePlugin; output "sent" is a synthetic completion ONLY. */
public final class VoiceWireProbe {
    public static void main(String[] args)throws Exception {
        var uploads=new VoiceUploads();var gson=new Gson();
        try(var input=new Scanner(System.in,StandardCharsets.UTF_8)) {while(input.hasNextLine()) {
            var row=JsonParser.parseString(input.nextLine()).getAsJsonObject();
            UUID actor=UUID.fromString(row.get("actor").getAsString()),session=UUID.fromString(row.get("session").getAsString()),id=null;
            byte[] message=Base64.getDecoder().decode(row.get("frame").getAsString());
            var out=new JsonObject();out.addProperty("token",row.get("token").getAsInt());
            try {
                String state=null;long now=System.currentTimeMillis();
                if(message[0]==2) {
                    var buffer=ByteBuffer.wrap(message,1,message.length-1);id=new UUID(buffer.getLong(),buffer.getLong());
                    var key=new VoiceUploads.Key(actor,id);int sequence=buffer.getInt();byte[] data=new byte[buffer.remaining()];buffer.get(data);
                    out.addProperty("sequence",sequence);out.addProperty("chunkBytes",data.length);
                    out.add("before",gson.toJsonTree(uploads.progress(key,session)));
                    try {uploads.chunk(key,session,sequence,data,now);}catch(IllegalArgumentException e){uploads.discard(key,session);throw e;}
                }else {
                    var control=JsonParser.parseString(new String(message,1,message.length-1,StandardCharsets.UTF_8)).getAsJsonObject();
                    id=UUID.fromString(control.get("requestId").getAsString());var key=new VoiceUploads.Key(actor,id);
                    switch(control.get("op").getAsString()) {
                        case "subscribe"->state="subscribed";
                        case "begin"->state=uploads.begin(key,session,control.get("bytes").getAsInt(),control.get("sha256").getAsString(),"wav",now);
                        case "finish"->{uploads.finish(key,session,now);state="sent";out.addProperty("syntheticCompletion",true);}
                    }
                }
                if(state!=null)out.addProperty("state",state);
            }catch(Exception error){out.addProperty("state","failed");out.addProperty("reason",error.getMessage());}
            if(id!=null)out.addProperty("requestId",id.toString());
            System.out.println(gson.toJson(out));
        }}
    }
}
