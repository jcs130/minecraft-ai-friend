package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;

/** Lossless data and freshness are correctness/security boundaries, not layout tests. */
public final class AgentObservationTest {
    private static int checks;
    private static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
    public static void main(String[] args) {
        JsonObject small=new JsonObject();small.addProperty("id","small");small.addProperty("stage","active");
        JsonObject large=new JsonObject();large.addProperty("id","large");large.addProperty("stage","ready_to_submit");
        large.addProperty("nextCommand","/mycli guild claim");large.addProperty("playerText",("中文😀\\\"\n\t\u0000").repeat(800));
        large.add("rewards",JsonParser.parseString("[{\"item\":\"diamond\",\"count\":64}]"));
        String before=large.toString();List<JsonObject> source=List.of(small,large,small.deepCopy());var pages=AgentReplyPages.pack(source);
        StringBuilder reconstructed=new StringBuilder();int parts=0,expected=0;boolean overview=false;
        for(var page:pages) {
            check(page.items().toString().length()<=AgentReplyPages.BODY_LIMIT+200,"bounded escaped page");
            // Generous envelope allowance, then one extra chat-component JSON escaping layer.
            String message="MC_PAGE {\"padding\":\""+"x".repeat(650)+"\",\"items\":"+page.items()+"}";
            check(new JsonPrimitive(message).toString().length()<4000,"wire-safe JSON escaping");
            for(JsonElement element:page.items()) {
                JsonObject row=element.getAsJsonObject();
                if(!row.has("encoding"))continue;
                if(row.get("encoding").getAsString().equals("summary")) {overview=true;check(row.get("stage").getAsString().equals("ready_to_submit"),"stage visible before full detail");continue;}
                check(row.get("part").getAsInt()==++parts,"ordered complete fragments");expected=row.get("parts").getAsInt();
                String chunk=row.get("data").getAsString();
                check(!Character.isLowSurrogate(chunk.charAt(0))&&!Character.isHighSurrogate(chunk.charAt(chunk.length()-1)),"emoji boundary preserved");
                reconstructed.append(chunk);
            }
        }
        check(overview&&parts==expected,"detail inventory complete");check(before.equals(reconstructed.toString()),"player text/rewards/errors not truncated");
        check(JsonParser.parseString(reconstructed.toString()).equals(large),"full row reconstructed");check(large.toString().equals(before),"source unchanged");
        check(AgentReplyPages.pack(List.of()).size()==1&&AgentReplyPages.pack(List.of()).getFirst().items().isEmpty(),"empty list honest");
        JsonObject enormous=new JsonObject();enormous.addProperty("text","x".repeat(131073));
        try{AgentReplyPages.pack(List.of(enormous));throw new AssertionError("capacity was silently truncated");}catch(IllegalArgumentException expectedFailure){checks++;}
        UUID player=UUID.randomUUID();long now=System.currentTimeMillis();
        JsonObject auth=new JsonObject();auth.addProperty("source","login_guard");auth.addProperty("playerUuid",player.toString());
        auth.addProperty("authSessionId",UUID.randomUUID().toString());auth.addProperty("observedAt",now);auth.addProperty("status","authenticated");auth.addProperty("authorized",true);
        JsonObject heartbeat=new JsonObject();heartbeat.addProperty("at",now);heartbeat.addProperty("ready",true);JsonArray states=new JsonArray();states.add(auth);heartbeat.add("sessionStates",states);
        check(AgentAuthObservation.current(heartbeat,player,now-1000,now).get("authorized").getAsBoolean(),"fresh current authentication");
        check(AgentAuthObservation.current(heartbeat,UUID.randomUUID(),now-1000,now)==null,"other player's auth private");
        check(AgentAuthObservation.current(heartbeat,player,now+1,now)==null,"old connection observation rejected");
        check(AgentAuthObservation.current(heartbeat,player,now-1000,now+16000)==null,"expired observation unknown");
        check(AgentAuthObservation.current(heartbeat,player,now-1000,now-6000)==null,"future observation rejected");
        check(AgentAuthObservation.current(null,player,now-1000,now)==null,"absent producer unknown");
        auth.addProperty("authorized","true");check(AgentAuthObservation.current(heartbeat,player,now-1000,now)==null,"string is not boolean authorization");
        auth.addProperty("authorized",false);check(AgentAuthObservation.current(heartbeat,player,now-1000,now)==null,"contradictory auth rejected");
        auth.addProperty("status","pending");check(!AgentAuthObservation.current(heartbeat,player,now-1000,now).get("authorized").getAsBoolean(),"fresh pending distinguishable");
        auth.addProperty("status","unavailable");auth.add("authorized",JsonNull.INSTANCE);
        check(AgentAuthObservation.current(heartbeat,player,now-1000,now).get("authorized").isJsonNull(),"unavailable not reported as failed login");
        heartbeat.addProperty("ready",false);auth.addProperty("status","authenticated");auth.addProperty("authorized",true);
        check(AgentAuthObservation.current(heartbeat,player,now-1000,now).get("authorized").isJsonNull(),"failed global heartbeat cannot retain old authorized claim");
        System.out.println("PASS "+checks+" page/freshness assertions; long text lossless and unknown auth preserved");
    }
}
