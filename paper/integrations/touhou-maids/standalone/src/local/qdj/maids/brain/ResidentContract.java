package local.qdj.maids.brain;

import com.google.gson.JsonObject;
import java.util.Map;
import java.util.Set;

/** Shared action contract used by validation, discovery and the model's planning prompt. */
final class ResidentContract {
    static JsonObject modelInput(String reply){
        if(reply==null||reply.length()>4096)throw new IllegalArgumentException("input: JSON object up to 4096 characters required");
        JsonObject parsed;
        try{parsed=com.google.gson.JsonParser.parseString(reply).getAsJsonObject();}
        catch(RuntimeException invalid){throw new IllegalArgumentException("input: one JSON object required; no markdown or trailing prose");}
        validate(parsed);return parsed;
    }
    static Map<String,Object> diagnosis(IllegalArgumentException error){
        String message=String.valueOf(error.getMessage());if(message.length()>300)message=message.substring(0,300);
        return Map.of("problem",message,"executed",false,"minimumReadOnlyExample",Map.of("action","cli","command","status"),
            "nextSafeRead","resident-actions","retrySameInput",false);
    }
    static boolean holdsPosition(JsonObject input) {
        return input != null && input.has("action") && input.get("action").getAsString().equals("cli")
            && input.has("command") && input.get("command").getAsString().strip().matches("photo +take(?: .*|$)");
    }
    static final Map<String,Set<String>> FIELDS=Map.of(
        "rest",Set.of(),"home",Set.of(),"walk",Set.of("at"),"task",Set.of("task"),
        "equip",Set.of("equipmentSlot","slot","expectedItem"),"break",Set.of("at","expectedBlock"),
        "place",Set.of("at","face","slot","expectedItem"),"cast",Set.of("skill"),"say",Set.of("text","channel"),"cli",Set.of("command"));
    static Map<String,Object> describe(){return Map.of("actions",FIELDS,"optionalFields",Map.of("reason","optional nonempty single-line explanation up to 240 characters; not an instruction"),"coordinateSystem","absolute_block_xyz",
        "coordinates","all of x,y,z required; integers; same dimension as this resident",
        "moveLimitBlocks",96,"reachBlocks",5,"deadlineMs",Map.of("default",90_000,"cli",240_000),"maximumInputCharacters",4096,
        "requestId","UUID; query receipt after an uncertain result; never automatically replay",
        "result","accepted is queued; completed verifies this one action, not a wider quest; unknown requires reconciliation");}
    static String string(JsonObject o,String key){
        if(!o.has(key)||!o.get(key).isJsonPrimitive()||!o.getAsJsonPrimitive(key).isString())throw new IllegalArgumentException(key+": string required");
        String s=o.get(key).getAsString();if(s.isBlank()||s.codePoints().anyMatch(Character::isISOControl))throw new IllegalArgumentException(key+": nonempty single line required");return s;
    }
    static int integer(JsonObject o,String key){
        try{if(!o.has(key)||!o.get(key).isJsonPrimitive()||!o.getAsJsonPrimitive(key).isNumber())throw new IllegalArgumentException();return o.get(key).getAsBigDecimal().intValueExact();}
        catch(RuntimeException invalid){throw new IllegalArgumentException(key+": integer required");}
    }
    static void id(JsonObject o,String key){if(!string(o,key).matches("[a-z0-9_.-]+:[a-z0-9_./-]+"))throw new IllegalArgumentException(key+": namespaced ID required");}
    static String validate(JsonObject o){
        if(o==null||o.toString().length()>4096)throw new IllegalArgumentException("input: JSON object up to 4096 characters required");
        String action=string(o,"action");var required=FIELDS.get(action);
        if(required==null)throw new IllegalArgumentException("action: unsupported action; read resident-actions");
        for(String key:required)if(!o.has(key))throw new IllegalArgumentException(key+": required for "+action);
        for(String key:o.keySet())if(!key.equals("action")&&!key.equals("reason")&&!required.contains(key))throw new IllegalArgumentException(key+": not a field of "+action);
        if(o.has("reason")&&string(o,"reason").codePointCount(0,string(o,"reason").length())>240)throw new IllegalArgumentException("reason: at most 240 characters");
        if(o.has("at")){
            if(!o.get("at").isJsonObject())throw new IllegalArgumentException("at: absolute {x,y,z} object required");
            var p=o.getAsJsonObject("at");if(!p.keySet().equals(Set.of("x","y","z")))throw new IllegalArgumentException("at: exactly x,y,z required");
            for(String key:Set.of("x","y","z"))try{integer(p,key);}catch(IllegalArgumentException bad){throw new IllegalArgumentException("at."+bad.getMessage());}
        }
        if(o.has("slot")&&integer(o,"slot")<0)throw new IllegalArgumentException("slot: nonnegative inventory index required");
        for(String key:Set.of("task","expectedItem","expectedBlock"))if(o.has(key))id(o,key);
        if(o.has("equipmentSlot")&&!Set.of("mainhand","offhand","head","chest","legs","feet").contains(string(o,"equipmentSlot")))throw new IllegalArgumentException("equipmentSlot: mainhand/offhand/head/chest/legs/feet required");
        if(o.has("face")&&!Set.of("up","down","north","south","east","west").contains(string(o,"face")))throw new IllegalArgumentException("face: up/down/north/south/east/west required");
        if(o.has("skill")&&!string(o,"skill").matches("[a-z0-9_.:-]{1,64}"))throw new IllegalArgumentException("skill: lowercase ID required");
        if(o.has("text")&&string(o,"text").codePointCount(0,string(o,"text").length())>140)throw new IllegalArgumentException("text: at most 140 characters");
        if(o.has("channel")&&!Set.of("nearby","public").contains(string(o,"channel")))throw new IllegalArgumentException("channel: nearby/public required; private dialogue uses whisper");
        if(action.equals("cli")&&string(o,"command").length()>3500)throw new IllegalArgumentException("command: at most 3500 characters");
        return action;
    }
}
