package org.qiandengji.payload;

import java.nio.*;
import java.nio.charset.*;
import java.util.*;
import java.util.concurrent.*;

/** A declared decoder capability is not an identity, permission, or authentication grant. */
final class OptionalPayloadPolicy {
    private final Map<Object,Set<String>> sessions=new ConcurrentHashMap<>();
    private static final Set<String> DETAILS=Set.of("vv:proxy_details","vv:server_details");
    private static boolean valid(String channel){return channel.length()<=128&&channel.matches("[a-z0-9_.-]+:[a-z0-9_./-]+");}
    private static String utf8(byte[] bytes) throws CharacterCodingException {
        return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
    }
    private static int integer(ByteBuffer input){
        int value=0;for(int i=0;i<5;i++){int part=Byte.toUnsignedInt(input.get());value|=(part&127)<<(i*7);if((part&128)==0)return value;}
        throw new IllegalArgumentException("Malformed registration size");
    }
    private static String string(ByteBuffer input) throws CharacterCodingException {
        int size=integer(input);if(size<0||size>128||size>input.remaining())throw new IllegalArgumentException("Registration string budget");
        byte[] bytes=new byte[size];input.get(bytes);return utf8(bytes);
    }
    synchronized boolean registration(Object session,String channel,byte[] bytes){
        if(session==null||bytes==null||bytes.length>32767)return false;
        try{
            Set<String> declared=new HashSet<>();boolean remove=channel.equals("minecraft:unregister");
            if(channel.equals("minecraft:register")||remove){
                if(bytes.length==0)return true;
                String[] items=utf8(bytes).split("\u0000",-1);
                for(int i=0;i<items.length;i++){
                    String item=items[i];if(i==items.length-1&&item.isEmpty())continue;
                    if(!valid(item)||declared.size()>=512)throw new IllegalArgumentException();declared.add(item);
                }
            }else if(channel.equals("c:register")){
                // NeoForge 21.1.x CommonRegisterPayload: VarInt version, UTF8 protocol, resource-location set.
                ByteBuffer input=ByteBuffer.wrap(bytes);if(integer(input)!=1||!string(input).equals("play"))return false;
                int count=integer(input);if(count<0||count>512)return false;
                for(int i=0;i<count;i++){String item=string(input);if(!valid(item))return false;declared.add(item);}
                if(input.hasRemaining())return false;
            }else return false;
            if(!sessions.containsKey(session)&&sessions.size()>=512)return false;
            Set<String> next=new HashSet<>(sessions.getOrDefault(session,Set.of()));
            if(remove)next.removeAll(declared);else next.addAll(declared);
            if(next.size()>512)return false;sessions.put(session,Set.copyOf(next));return true;
        }catch(RuntimeException|CharacterCodingException invalid){return false;}
    }
    boolean allowed(Object session,String channel){
        if(DETAILS.contains(channel))return false; // Official optional diagnostics, not protocol conversion.
        if(channel.startsWith("mcagent:")||channel.startsWith("yes_steve_model:"))
            return sessions.getOrDefault(session,Set.of()).contains(channel);
        return true; // Authentication, mod negotiation, voice and other plugins keep their existing transports.
    }
    void left(Object session){if(session!=null)sessions.remove(session);}
    void clear(){sessions.clear();}
}
