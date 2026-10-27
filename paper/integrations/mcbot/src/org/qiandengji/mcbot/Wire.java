package org.qiandengji.mcbot;

import com.google.gson.*;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.*;

/** Independent implementation of Minecraft's UTF-8 string framing. */
public final class Wire {
    public static final String IN="mcbot:c2s", OUT="mcbot:s2c";
    public static final int MAX_BODY=32765;
    private static final Gson JSON=new GsonBuilder().disableHtmlEscaping().create();
    private Wire() {}
    public static JsonObject decode(byte[] packet) {
        if(packet==null||packet.length<2||packet.length>32768)throw new IllegalArgumentException("invalid message size");
        int length=0,offset=0;
        for(int shift=0;shift<21;shift+=7){
            if(offset>=packet.length)throw new IllegalArgumentException("incomplete length");
            int b=packet[offset++]&255;length|=(b&127)<<shift;
            if((b&128)==0){
                if(length<2||length>MAX_BODY||length!=packet.length-offset)throw new IllegalArgumentException("invalid message length");
                final String text;
                try{text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(packet,offset,length)).toString();}
                catch(CharacterCodingException bad){throw new IllegalArgumentException("invalid UTF-8");}
                depth(text);
                JsonElement parsed=JsonParser.parseString(text);
                if(!parsed.isJsonObject())throw new IllegalArgumentException("expected object");
                JsonObject object=parsed.getAsJsonObject();
                String kind=string(object,"kind",1,48);
                if(!kind.matches("[a-z_]+"))throw new IllegalArgumentException("invalid kind");
                return object;
            }
        }
        throw new IllegalArgumentException("invalid length prefix");
    }
    private static void depth(String text){
        int depth=0;boolean quoted=false,escaped=false;
        for(int i=0;i<text.length();i++){
            char c=text.charAt(i);
            if(quoted){if(escaped)escaped=false;else if(c=='\\')escaped=true;else if(c=='"')quoted=false;}
            else if(c=='"')quoted=true;
            else if(c=='{'||c=='['){if(++depth>32)throw new IllegalArgumentException("message nesting limit");}
            else if(c=='}'||c==']'){if(--depth<0)throw new IllegalArgumentException("invalid nesting");}
        }
        if(quoted||depth!=0)throw new IllegalArgumentException("incomplete object");
    }
    public static byte[] encode(JsonObject object){
        byte[] body=JSON.toJson(object).getBytes(StandardCharsets.UTF_8);
        if(body.length>MAX_BODY)throw new IllegalArgumentException("result size limit");
        var out=new ByteArrayOutputStream(body.length+3);int n=body.length;
        do{int b=n&127;n>>>=7;out.write(b|(n!=0?128:0));}while(n!=0);
        out.writeBytes(body);return out.toByteArray();
    }
    public static JsonObject envelope(String kind){JsonObject out=new JsonObject();out.addProperty("kind",kind);return out;}
    public static String string(JsonObject object,String key,int min,int max){
        JsonElement e=object.get(key);
        if(e==null||!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isString())throw new IllegalArgumentException(key+" must be text");
        String value=e.getAsString();if(value.length()<min||value.length()>max||value.chars().anyMatch(c->c<32||c==127))throw new IllegalArgumentException("invalid "+key);
        return value;
    }
    public static long integer(JsonObject object,String key,long min,long max){
        JsonElement e=object.get(key);
        if(e==null||!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isNumber())throw new IllegalArgumentException(key+" must be an integer");
        long value;
        try{value=e.getAsBigDecimal().longValueExact();}catch(ArithmeticException bad){throw new IllegalArgumentException("invalid "+key);}
        if(value<min||value>max)throw new IllegalArgumentException("out of range "+key);return value;
    }
    public static boolean bool(JsonObject object,String key,boolean fallback){
        JsonElement e=object.get(key);if(e==null)return fallback;
        if(!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isBoolean())throw new IllegalArgumentException(key+" must be boolean");
        return e.getAsBoolean();
    }
    public static JsonObject args(JsonObject object){
        if(!object.has("args")||!object.get("args").isJsonObject())throw new IllegalArgumentException("args must be an object");
        return object.getAsJsonObject("args");
    }
}
