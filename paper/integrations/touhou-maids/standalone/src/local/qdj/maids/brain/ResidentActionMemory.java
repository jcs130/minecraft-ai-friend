package local.qdj.maids.brain;

import com.google.gson.*;
import java.util.*;

/** Compact facts from execution receipts, not a model's claim that its goal was achieved. */
final class ResidentActionMemory {
    private static final Gson JSON=new Gson();
    static Map<String,Object> summarize(Map<String,Object> receipt) {
        JsonObject source=JSON.toJsonTree(receipt).getAsJsonObject(),out=new JsonObject();
        copy(source,out,"requestId","action","status","reason","completed","observedAt","consumed","remaining","manaSpent","before","after");
        out.addProperty("historical",true);
        out.addProperty("completionScope","single_action_not_overall_objective");
        String command=source.has("command")?source.get("command").getAsString():"";
        JsonObject input=source.has("input")&&source.get("input").isJsonObject()?source.getAsJsonObject("input"):new JsonObject();
        if(command.isEmpty()&&input.has("command"))command=input.get("command").getAsString();
        if(!command.isEmpty()){
            out.addProperty("command",command.length()>512?command.substring(0,512):command);
            if(command.length()>512)out.addProperty("commandTruncated",true);
        }
        JsonObject selected=new JsonObject();copy(input,selected,"skill","task","slot","equipmentSlot","expectedItem","expectedBlock");
        point(input,selected,"at");if(!selected.isEmpty())out.add("input",selected);
        point(source,out,"actualPosition");
        JsonObject service=source.has("serviceReceipt")&&source.get("serviceReceipt").isJsonObject()?source.getAsJsonObject("serviceReceipt"):new JsonObject();
        JsonObject evidence=new JsonObject();
        copy(service,evidence,"action","success","reason","errorCode","goalCompleted","actorId","requestId",
            "quoteId","expiresAt","expiresInMs","balance","price","totalPrice","quantity","pending","queued",
            "moved","remaining","queuedRemaining","fame","fameBefore","nextSafeRead","offerId","spent","pendingCount",
            "destination","transferredToInventory","queueCompleted","deliveryStatus","paymentPending","nextAction","id","baseId","name");
        for(String key:List.of("before","after"))if(service.has(key)&&service.get(key).isJsonObject()){
            JsonObject state=new JsonObject();copy(service.getAsJsonObject(key),state,"joined","completed","activeId","title","status","progress","target");
            if(!state.isEmpty())evidence.add(key,state);
        }
        if(service.has("item")&&service.get("item").isJsonObject()){
            JsonObject item=new JsonObject();copy(service.getAsJsonObject("item"),item,"id","baseId","name","displayName","count","quantity","damage","maxDamage","slot");
            if(!item.isEmpty())evidence.add("item",item);
        }
        if(!evidence.isEmpty())out.add("service",evidence);
        if(!command.isEmpty()){
            var contract=JSON.toJsonTree(ResidentCliContract.describe(command)).getAsJsonObject();
            for(String key:List.of("operation","operationEffect","completionScope","queryOnly","operationNotice","nextSafeRead"))
                if(contract.has(key))out.add(key,contract.get(key));
        }else out.addProperty("queryOnly",false);
        // New receipts carry the executor's contract. Older receipts use the same public definition.
        copy(source,out,"operation","operationEffect","completionScope","queryOnly","operationNotice","nextSafeRead");
        // Original immutable receipt remains available by requestId, including omitted components.
        @SuppressWarnings("unchecked") Map<String,Object> row=JSON.fromJson(out,Map.class);return row;
    }
    private static void copy(JsonObject source,JsonObject target,String... keys){
        for(String key:keys)if(source.has(key)&&source.get(key).isJsonPrimitive()){
            JsonPrimitive value=source.getAsJsonPrimitive(key);
            if(value.isString()&&value.getAsString().length()>256){target.addProperty(key,value.getAsString().substring(0,256));target.addProperty(key+"Truncated",true);}
            else target.add(key,value.deepCopy());
        }
    }
    private static void point(JsonObject source,JsonObject target,String key){
        if(source.has(key)&&source.get(key).isJsonObject()){JsonObject at=new JsonObject();copy(source.getAsJsonObject(key),at,"x","y","z");target.add(key,at);}
    }
}
