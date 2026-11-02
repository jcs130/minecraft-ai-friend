package org.qiandengji.payload;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
public final class OptionalPayloadPolicyTest {
    private static int checks;
    private static void check(boolean value,String message){if(!value)throw new AssertionError(message);checks++;}
    private static byte[] bytes(String value){return value.getBytes(StandardCharsets.UTF_8);}
    private static void number(ByteArrayOutputStream out,int value){while((value&~127)!=0){out.write((value&127)|128);value>>>=7;}out.write(value);}
    private static void text(ByteArrayOutputStream out,String value){byte[] data=bytes(value);number(out,data.length);out.writeBytes(data);}
    private static byte[] common(int version,String protocol,String... channels){var out=new ByteArrayOutputStream();number(out,version);text(out,protocol);number(out,channels.length);for(String channel:channels)text(out,channel);return out.toByteArray();}
    private static byte[] nativeQuery(int protocol,int flow,String... channels){var out=new ByteArrayOutputStream();number(out,1);number(out,protocol);number(out,channels.length);for(String channel:channels){text(out,channel);text(out,"2.6.0");out.write(flow<0?0:1);if(flow>=0)number(out,flow);out.write(1);}return out.toByteArray();}
    public static void main(String[] args){
        var policy=new OptionalPayloadPolicy();Object first=new Object(),other=new Object();
        check(!policy.allowed(first,"mcagent:state"),"unsolicited state does not reach a vanilla/NeoForge recipient");
        check(!policy.allowed(first,"yes_steve_model:2_4_0"),"a missing YSM decoder never receives its protocol");
        for(String channel:List.of("minecraft:brand","minecraft:register","c:register","c:version","freesia:message","voicechat:secret","qiandengji:agent"))check(policy.allowed(first,channel),"unrelated negotiation/auth/voice route remains untouched: "+channel);
        check(policy.registration(first,"minecraft:register",bytes("mcagent:state\0mcagent:appearance")),"Minecraft registration accepted");
        check(policy.allowed(first,"mcagent:state")&&!policy.allowed(other,"mcagent:state"),"capability binds the original connection rather than its name");
        check(policy.registration(first,"minecraft:unregister",bytes("mcagent:state"))&&!policy.allowed(first,"mcagent:state"),"unregistration revokes only its declared decoder");
        check(policy.allowed(first,"mcagent:appearance"),"other registered channels remain");
        check(policy.registration(first,"minecraft:register",bytes("mcagent:state\0"))&&policy.allowed(first,"mcagent:state"),"standard NUL-terminated channel lists accepted");
        check(policy.registration(other,"c:register",common(1,"play","yes_steve_model:2_4_0")),"actual NeoForge common-registration encoding accepted");
        check(policy.allowed(other,"yes_steve_model:2_4_0")&&!policy.allowed(first,"yes_steve_model:2_4_0"),"native capability never leaks to another client");
        check(!policy.registration(other,"c:register",common(2,"play","mcagent:state"))&&!policy.allowed(other,"mcagent:state"),"unknown native registration version is not a decoder claim");
        check(!policy.registration(other,"c:register",common(1,"configuration","mcagent:state")),"a configuration-only declaration does not authorize play data");
        check(!policy.registration(other,"minecraft:register",new byte[]{(byte)0xff}),"malformed UTF8 is ignored without changing game entry");
        check(!policy.registration(other,"minecraft:register",bytes("mcagent:state\0bad\nchannel"))&&!policy.allowed(other,"mcagent:state"),"malformed lists never partially register");
        check(!policy.registration(other,"minecraft:register",new byte[32768]),"registration memory budget retained");
        for(String channel:List.of("vv:proxy_details","vv:server_details"))check(!policy.allowed(other,channel),"optional version diagnostics remain suppressed: "+channel);
        policy.left(other);check(!policy.allowed(other,"yes_steve_model:2_4_0"),"disconnect clears connection capability");
        policy.clear();check(!policy.allowed(first,"mcagent:appearance"),"shutdown clears all capabilities");
        Object nativeClient=new Object(),unrelated=new Object();byte[] query=nativeQuery(1,-1,"yes_steve_model:2_6_0");
        check(policy.registration(nativeClient,"neoforge:register",query),"original NeoForge native registration accepted");
        check(policy.allowed(nativeClient,"yes_steve_model:2_6_0")&&!policy.allowed(unrelated,"yes_steve_model:2_6_0"),"bidirectional native decoder remains per connection");
        check(policy.registration(nativeClient,"neoforge:register",nativeQuery(1,1,"mcagent:state"))&&policy.allowed(nativeClient,"mcagent:state"),"native clientbound PLAY decoder accepted");
        check(policy.registration(unrelated,"neoforge:register",nativeQuery(1,0,"mcagent:state"))&&!policy.allowed(unrelated,"mcagent:state"),"serverbound-only declaration is not a client decoder");
        check(policy.registration(unrelated,"neoforge:register",nativeQuery(4,-1,"mcagent:state"))&&!policy.allowed(unrelated,"mcagent:state"),"CONFIG registration cannot authorize PLAY delivery");
        check(!policy.registration(unrelated,"neoforge:register",nativeQuery(5,-1,"mcagent:state")),"unknown protocol rejected");
        check(!policy.registration(unrelated,"neoforge:register",nativeQuery(1,2,"mcagent:state")),"unknown flow rejected");
        for(int length=0;length<query.length;length++){
            Object isolated=new Object();check(!policy.registration(isolated,"neoforge:register",Arrays.copyOf(query,length))&&!policy.allowed(isolated,"yes_steve_model:2_6_0"),"truncated native query never partially grants decoder "+length);
        }
        byte[] extra=Arrays.copyOf(query,query.length+1);check(!policy.registration(unrelated,"neoforge:register",extra)&&!policy.allowed(unrelated,"yes_steve_model:2_6_0"),"trailing native data rejected atomically");
        byte[] badBoolean=query.clone();badBoolean[badBoolean.length-1]=2;check(!policy.registration(unrelated,"neoforge:register",badBoolean),"invalid native optional flag rejected");
        var huge=new ByteArrayOutputStream();number(huge,1);number(huge,1);number(huge,513);check(!policy.registration(unrelated,"neoforge:register",huge.toByteArray()),"native channel budget retained");
        check(!policy.registration(unrelated,"neoforge:register",nativeQuery(1,-1,"mcagent:state","bad\nchannel"))&&!policy.allowed(unrelated,"mcagent:state"),"malformed native list never partially registers");
        policy.left(nativeClient);check(!policy.allowed(nativeClient,"yes_steve_model:2_6_0")&&!policy.allowed(nativeClient,"mcagent:state"),"native decoder claims removed on disconnect");
        System.out.println("OptionalPayloadPolicyTest: "+checks+" checks passed");
    }
}
