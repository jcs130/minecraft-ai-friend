package local.tlmcompat.hybrid;

import com.google.gson.*;

public final class MaidReplyPresentationFixture {
    static int count;
    static void check(boolean value,String label){count++;if(!value)throw new AssertionError(label);}
    static JsonObject receipt(String state,String route){var data=new JsonObject();data.addProperty("status",state);var observation=new JsonObject();if(route!=null)observation.addProperty("textPresentation",route);data.add("observation",observation);return data;}
    public static void main(String[] args){
        for(String route:new String[]{"nearby_canonical","original_tlm"}){
            var data=receipt("replied",route);
            check(MaidReplyPresentation.alreadyShown("chat-result",data,null),route+" automatic result does not echo visible speech");
            check(!MaidReplyPresentation.alreadyShown("receipt",data,null),route+" explicit query still displays the original answer");
            check(!MaidReplyPresentation.alreadyShown("chat",data,null),route+" explicit original command remains readable");
            check(!MaidReplyPresentation.alreadyShown("chat-result",data,"unavailable"),route+" errors are never hidden");
            for(String state:new String[]{"pending","unknown","rejected"})check(!MaidReplyPresentation.alreadyShown("chat-result",receipt(state,route),null),state+" remains visible");
        }
        check(!MaidReplyPresentation.alreadyShown("chat-result",receipt("replied",null),null),"old reply metadata keeps readable fallback");
        check(!MaidReplyPresentation.alreadyShown("chat-result",receipt("replied","invented"),null),"unknown route cannot silence a reply");
        check(!MaidReplyPresentation.alreadyShown("chat-result",null,null),"missing receipt keeps normal path");
        var malformed=receipt("replied",null);malformed.addProperty("observation",true);
        check(!MaidReplyPresentation.alreadyShown("chat-result",malformed,null),"malformed metadata keeps normal path");
        System.out.println("PASS "+count+" single-presentation rules");
    }
}
