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
        System.out.println("OptionalPayloadPolicyTest: "+checks+" checks passed");
    }
}
