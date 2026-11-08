package local.tlmcompat.hybrid;
import com.google.gson.*;
public final class MaidChatReplyFixture {
    private static int count;
    private static void check(boolean yes){if(!yes)throw new AssertionError("case "+(count+1));count++;}
    public static void main(String[] args){
        JsonObject reply=JsonParser.parseString("{\"action\":\"follow\",\"requestId\":\"same-request\",\"ok\":true,\"data\":{\"status\":\"applied\",\"goalCompleted\":false,\"observation\":{\"hostKind\":\"original_touhou_little_maid\",\"maidId\":\"original\",\"lifeState\":\"alive\",\"ownerDistance\":2.5}}}").getAsJsonObject();
        check(MaidChatReply.text(reply).equals("QD_MAID "+reply));
        JsonObject context=reply.getAsJsonObject("data").getAsJsonObject("observation"),brain=new JsonObject();brain.addProperty("meaning","long help ".repeat(450));context.add("brain",brain);
        String before=reply.toString(),wire=MaidChatReply.text(reply);check(wire.length()<4000);check(reply.toString().equals(before));
        JsonObject parsed=JsonParser.parseString(wire.substring(8)).getAsJsonObject();check(parsed.get("requestId").getAsString().equals("same-request"));
        JsonObject facts=parsed.getAsJsonObject("data");check(facts.get("status").getAsString().equals("applied")&&!facts.get("goalCompleted").getAsBoolean());
        facts=facts.getAsJsonObject("observation");check(facts.get("maidId").getAsString().equals("original")&&facts.get("lifeState").getAsString().equals("alive")&&facts.get("ownerDistance").getAsDouble()==2.5);
        context.addProperty("unboundedTestFact","x".repeat(5000));wire=MaidChatReply.text(reply);parsed=JsonParser.parseString(wire.substring(8)).getAsJsonObject();
        check(wire.length()<4000&&!parsed.get("ok").getAsBoolean());check(parsed.get("error").getAsString().equals("response_requires_plugin_channel")&&parsed.get("requestId").getAsString().equals("same-request"));
        check(reply.getAsJsonObject("data").getAsJsonObject("observation").get("unboundedTestFact").getAsString().length()==5000);
        System.out.println("PASS "+count+" chat reply checks");
    }
}
