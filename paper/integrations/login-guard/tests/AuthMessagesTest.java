package org.afuhome.auth;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.lang.reflect.*;
import java.net.InetSocketAddress;
import java.util.*;
import com.velocitypowered.api.proxy.Player;

public final class AuthMessagesTest {
    public static void main(String[] args)throws Exception {
        String hello="{\"op\":\"hello\",\"protocol\":1,\"transport\":\"payload\"}";
        AuthObservationTest.check(AuthMessages.hello(hello.getBytes(StandardCharsets.UTF_8)),"valid transport hello");
        for(String bad:new String[]{"{}","null",hello.replace("1","2"),hello.replace("hello","authenticate"),hello.replace("\"op\"","\"authorized\":true,\"op\"")})
            AuthObservationTest.check(!AuthMessages.hello(bad.getBytes(StandardCharsets.UTF_8)),"reject untrusted capability "+bad);
        JsonObject state=JsonParser.parseString("{\"playerUuid\":\"uuid\",\"authSessionId\":\"session\",\"observedAt\":1,\"authorized\":true,\"status\":\"authenticated\",\"passwordSet\":false,\"nextCommand\":\"/mycli status\"}").getAsJsonObject();
        JsonObject compact=AuthMessages.compact(state);
        AuthObservationTest.check(!compact.has("authSessionId")&&!compact.has("playerUuid")&&!compact.has("observedAt"),"compact stable hints");
        AuthObservationTest.check(compact.get("authorized").getAsBoolean()&&!compact.get("passwordSet").getAsBoolean()&&compact.get("nextCommand").getAsString().equals("/mycli status"),"keep auth and next step");
        JsonObject frame=JsonParser.parseString(new String(AuthMessages.payload(state),StandardCharsets.UTF_8)).getAsJsonObject();
        AuthObservationTest.check(frame.get("type").getAsString().equals("MC_AUTH_STATE")&&frame.getAsJsonObject("data").has("authSessionId"),"payload retains full correlation");
        AuthObservationTest.check(state.has("authSessionId"),"presentation never mutates observation");
        AuthObservationTest.check(AuthMessages.agent("AG_NEKO")&&!AuthMessages.agent("Not_ag_A"),"agent prefix only");
        List<String> sent=new ArrayList<>();Player human=(Player)AuthObservationTest.stub(Player.class,(m,a)->switch(m.getName()){
            case "getUsername"->"Visitor";case "sendMessage"->{sent.add(Arrays.toString(a));yield null;}
            default->AuthObservationTest.empty(m.getReturnType());
        });
        LoginGuard guard=new LoginGuard(null,null);Method send=LoginGuard.class.getDeclaredMethod("sendAuthentication",Player.class,JsonObject.class,boolean.class);send.setAccessible(true);
        send.invoke(guard,human,state,false);AuthObservationTest.check(sent.isEmpty(),"humans get no unsolicited auth JSON");
        send.invoke(guard,human,state,true);AuthObservationTest.check(sent.size()==1&&sent.getFirst().contains("authSessionId"),"explicit authstatus keeps complete observation");
        sent.clear();Player unavailable=(Player)AuthObservationTest.stub(Player.class,(m,a)->switch(m.getName()){
            case "getUsername"->"ag_Fallback";case "sendPluginMessage"->false;
            case "sendMessage"->{sent.add(Arrays.toString(a));yield null;}
            default->AuthObservationTest.empty(m.getReturnType());
        });
        @SuppressWarnings("unchecked") Set<Player> peers=(Set<Player>)AuthObservationTest.get(guard,"payloadPeers");peers.add(unavailable);
        send.invoke(guard,unavailable,state,false);AuthObservationTest.check(sent.size()==1&&sent.getFirst().contains("authenticated")&&!sent.getFirst().contains("authSessionId"),"failed payload write retains safe private fallback");
        System.out.println("PASS "+AuthObservationTest.checks+" auth message checks");
    }
}
