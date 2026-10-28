package dev.qiandeng.maw.taunative;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Pure contract validation and bounded action receipts, independently testable. */
final class NativePolicy {
    record Problem(String field, String expected, String issue) {}
    private final JsonObject contract;
    NativePolicy(JsonObject contract) { this.contract=contract.deepCopy(); }
    JsonObject contract() { return contract.deepCopy(); }
    int limit(String name) { return contract.getAsJsonObject("limits").get(name).getAsInt(); }
    JsonObject operation(String id) {
        for(var row:contract.getAsJsonArray("operations"))
            if(row.getAsJsonObject().get("id").getAsString().equals(id))return row.getAsJsonObject();
        return null;
    }
    JsonObject query(String kind) {
        for(var row:contract.getAsJsonArray("operations")){
            var op=row.getAsJsonObject();
            if(op.has("query")&&op.get("query").getAsString().equals(kind))return op;
        }return null;
    }
    static Problem validate(JsonElement value, JsonObject schema, String path) {
        String type=schema.get("type").getAsString();
        if(value==null||value.isJsonNull())return new Problem(path,type,"missing or null");
        switch(type){
            case "object" -> {
                if(!value.isJsonObject())return new Problem(path,type,"not an object");
                JsonObject object=value.getAsJsonObject(), props=schema.getAsJsonObject("properties");
                if(schema.has("required"))for(var required:schema.getAsJsonArray("required")){
                    String field=required.getAsString();if(!object.has(field))return new Problem(path+"."+field,"required field","missing");
                }
                for(var entry:object.entrySet()){
                    if(!props.has(entry.getKey()))return new Problem(path+"."+entry.getKey(),"declared field","unexpected field");
                    Problem problem=validate(entry.getValue(),props.getAsJsonObject(entry.getKey()),path+"."+entry.getKey());
                    if(problem!=null)return problem;
                }
            }
            case "integer" -> {
                if(!value.isJsonPrimitive()||!value.getAsJsonPrimitive().isNumber())return new Problem(path,type,"not a number");
                double n=value.getAsDouble();
                if(!Double.isFinite(n)||n!=Math.rint(n))return new Problem(path,type,"not a finite integer");
                if(schema.has("minimum")&&n<schema.get("minimum").getAsDouble()||schema.has("maximum")&&n>schema.get("maximum").getAsDouble())
                    return new Problem(path,"integer in declared range","out of range");
            }
            case "string" -> {
                if(!value.isJsonPrimitive()||!value.getAsJsonPrimitive().isString())return new Problem(path,type,"not a string");
                String text=value.getAsString();
                if(schema.has("maxLength")&&text.length()>schema.get("maxLength").getAsInt())return new Problem(path,"bounded string","too long");
                if(schema.has("pattern")&&!text.matches(schema.get("pattern").getAsString()))return new Problem(path,schema.get("pattern").getAsString(),"pattern mismatch");
            }
            default -> {return new Problem(path,"supported schema","unsupported schema type");}
        }return null;
    }
    static String canonical(JsonElement value){
        if(value.isJsonObject()){
            JsonObject out=new JsonObject();value.getAsJsonObject().keySet().stream().sorted().forEach(k->out.add(k,JsonParser.parseString(canonical(value.getAsJsonObject().get(k)))));return out.toString();
        }if(value.isJsonArray()){JsonArray out=new JsonArray();for(var item:value.getAsJsonArray())out.add(JsonParser.parseString(canonical(item)));return out.toString();}
        return value.toString();
    }
    static String sha(String text){
        try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));}
        catch(Exception impossible){throw new IllegalStateException(impossible);}
    }
    /** Keep a confirmed action result even when its attached observation is too large. */
    static JsonObject bounded(JsonObject value,int maximum){
        if(value.toString().getBytes(StandardCharsets.UTF_8).length<=maximum)return value;
        JsonObject out=value.deepCopy();
        for(String key:List.of("menu","state","receipt"))if(out.has(key)){
            if(key.equals("receipt")&&out.get(key).isJsonObject()){
                JsonObject receipt=out.getAsJsonObject(key);receipt.add("state",JsonNull.INSTANCE);
                receipt.addProperty("stateUnavailable",true);receipt.addProperty("stateUnavailableReason","native_state_byte_budget");
            }else out.add(key,JsonNull.INSTANCE);
        }
        out.addProperty("complete",false);out.addProperty("stateUnavailable",true);out.addProperty("stateUnavailableReason","native_state_byte_budget");
        if(out.has("readOnly")&&out.get("readOnly").getAsBoolean()&&out.has("status")&&out.get("status").getAsString().equals("ok"))out.addProperty("status","partial");
        if(out.toString().getBytes(StandardCharsets.UTF_8).length<=maximum)return out;
        JsonObject small=new JsonObject();
        for(String key:List.of("schemaVersion","kind","requestId","playerUuid","bodyId","bodyKind","serverEpoch","capturedAt","capturedTick","query","action","status","ok","changed","outcomeKnown","outcomeUnknown"))
            if(out.has(key))small.add(key,out.get(key));
        if(small.has("kind")&&small.get("kind").getAsString().equals("menu_state"))small.addProperty("kind","menu_state_error");
        small.addProperty("complete",false);small.addProperty("code","native_state_byte_budget");small.addProperty("stateUnavailable",true);
        small.addProperty("retryAutomatically",false);return small;
    }
    static final class Receipts {
        record Entry(String fingerprint, long expiresAt, JsonObject receipt) {}
        private final LinkedHashMap<String,Entry> rows=new LinkedHashMap<>();
        private final int maximum;private final long ttl;
        Receipts(int maximum,long ttl){if(maximum<1||ttl<1)throw new IllegalArgumentException("receipt limits");this.maximum=maximum;this.ttl=ttl;}
        Entry get(String id,long now){rows.entrySet().removeIf(e->e.getValue().expiresAt<=now);return rows.get(id);}
        void put(String id,String fingerprint,long now,JsonObject receipt){
            rows.entrySet().removeIf(e->e.getValue().expiresAt<=now);
            if(rows.size()>=maximum&&!rows.containsKey(id))rows.remove(rows.keySet().iterator().next());
            rows.put(id,new Entry(fingerprint,now+ttl,receipt.deepCopy()));
        }
        boolean empty(long now){rows.entrySet().removeIf(e->e.getValue().expiresAt<=now);return rows.isEmpty();}
    }
}
