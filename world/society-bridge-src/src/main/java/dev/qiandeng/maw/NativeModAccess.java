package dev.qiandeng.maw;

import com.google.gson.*;
import net.minecraft.server.level.ServerPlayer;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;

/** In-process same-body facade. No operator, socket, fake inventory or packet replay. */
public final class NativeModAccess {
    private static final Map<String, JsonObject> OPERATIONS = load();
    private static final ThreadLocal<Capture> CURRENT = new ThreadLocal<>();
    private static final class Capture {
        final UUID player; final String requestId; JsonObject result;
        Capture(UUID player, String requestId) { this.player=player; this.requestId=requestId; }
    }
    private NativeModAccess() {}
    private static Map<String, JsonObject> load() {
        try (var stream=NativeModAccess.class.getResourceAsStream("/maw-native-operations.json")) {
            if(stream==null)throw new IllegalStateException("native_mod_contract_missing");
            var root=JsonParser.parseReader(new InputStreamReader(stream, StandardCharsets.UTF_8)).getAsJsonObject();
            Map<String,JsonObject> rows=new LinkedHashMap<>();
            for(var value:root.getAsJsonArray("operations")) {var row=value.getAsJsonObject(); if(rows.put(row.get("id").getAsString(),row)!=null)throw new IllegalStateException("duplicate_native_mod_operation");}
            if(rows.size()!=root.get("operationCount").getAsInt())throw new IllegalStateException("native_mod_contract_count");
            return Collections.unmodifiableMap(rows);
        }catch(java.io.IOException e){throw new IllegalStateException("native_mod_contract_unreadable",e);}
    }
    public static JsonObject catalog(String operation) {
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("ok",true);
        out.addProperty("source","same_player_native_handlers");out.addProperty("operationCount",OPERATIONS.size());
        if(operation!=null&&!operation.isBlank()) {
            var row=OPERATIONS.get(operation);if(row==null)throw new IllegalArgumentException("mod_operation_not_found");
            out.add("operation",publicRow(row,true));
        }else {JsonArray rows=new JsonArray();OPERATIONS.values().forEach(r->rows.add(publicRow(r,false)));out.add("operations",rows);}
        return out;
    }
    private static JsonObject publicRow(JsonObject row,boolean schema) {
        JsonObject out=new JsonObject();for(String k:List.of("id","readOnly","description"))out.add(k,row.get(k).deepCopy());
        if(schema)out.add("parameters",row.get("parameters").deepCopy());
        out.addProperty("availableWithoutClient",true);out.addProperty("permissions","same_body_native_rules");return out;
    }
    static boolean capturing(ServerPlayer player) {var c=CURRENT.get();return c!=null&&c.player.equals(player.getUUID());}
    static boolean capture(ServerPlayer player, JsonObject body) {
        var c=CURRENT.get();if(c==null||!c.player.equals(player.getUUID()))return false;
        // A menu-open event can synchronously publish an unrelated snapshot.
        // Consume it privately, but only retain the matching action/query receipt.
        if(body.has("requestId")&&c.requestId.equals(body.get("requestId").getAsString())) {
            if(c.result!=null)throw new IllegalStateException("duplicate_native_mod_receipt");
            c.result=body.deepCopy();c.result.addProperty("playerUuid",player.getUUID().toString());
        }
        return true;
    }
    static boolean capture(ServerPlayer player,String text) {return capturing(player)&&capture(player,JsonParser.parseString(text).getAsJsonObject());}
    public static JsonObject invoke(ServerPlayer player,String operation,JsonObject arguments,boolean readOnly,String requestId) {
        if(player.getServer()==null||!player.getServer().isSameThread())throw new IllegalStateException("minecraft_thread_required");
        if(player.isDeadOrDying())throw new IllegalArgumentException("body_dead");
        if(CURRENT.get()!=null)throw new IllegalStateException("native_mod_call_nested");
        var row=OPERATIONS.get(operation);if(row==null)throw new IllegalArgumentException("mod_operation_not_found");
        if(readOnly!=row.get("readOnly").getAsBoolean())throw new IllegalArgumentException("mod_read_write_mismatch");
        if(!requestId.matches("[A-Za-z0-9:_-]{1,64}"))throw new IllegalArgumentException("invalid_mod_request_id");
        if(arguments.toString().getBytes(StandardCharsets.UTF_8).length>60000)throw new IllegalArgumentException("mod_arguments_too_large");
        validate(arguments,row.getAsJsonObject("parameters"),0);
        JsonObject input=row.getAsJsonObject("defaults").deepCopy();arguments.asMap().forEach((k,v)->input.add(k,v.deepCopy()));
        input.addProperty("schemaVersion",1);input.addProperty("requestId",requestId);input.addProperty("kind",row.get("kind").getAsString());
        Capture c=new Capture(player.getUUID(),requestId);CURRENT.set(c);
        try {
            String raw=input.toString();
            switch(row.get("route").getAsString()) {
                case "colony"->{if(readOnly)PlayerColonyBridge.handle(player,raw);else PlayerColonyBridge.handleAction(player,raw);}
                case "world"->PlayerWorldBridge.handle(player,raw);
                case "mod"->ModOperationsBridge.handle(player,raw,!readOnly);
                case "domum"->{
                    if(readOnly)DomumCutterBridge.query(player,raw);
                    else {input.addProperty("playerUuid",player.getUUID().toString());DomumCutterBridge.select(player,input.toString());}
                }
                case "menu"->{
                    String kind=row.get("kind").getAsString();
                    if(kind.equals("snapshot"))c.result=menuState(player,requestId);
                    else if(kind.equals("pickup"))PlayerMenuBridge.handleAction(player,raw);
                    else {
                        var menu=player.containerMenu;
                        if(menu.containerId!=input.get("windowId").getAsInt()||menu.getStateId()!=input.get("expectedStateId").getAsInt())throw new IllegalArgumentException("stale_menu_state");
                        if(!menu.getCarried().isEmpty())throw new IllegalArgumentException("clear_cursor_before_close");
                        if(menu!=player.inventoryMenu)player.closeContainer();
                        c.result=menuState(player,requestId);c.result.addProperty("ok",player.containerMenu==player.inventoryMenu);
                    }
                }
                default->throw new IllegalStateException("native_mod_route_unavailable");
            }
            if(c.result==null)throw new IllegalStateException("native_mod_receipt_missing_do_not_replay");
            if(c.result.toString().getBytes(StandardCharsets.UTF_8).length>65536)throw new IllegalStateException("native_mod_receipt_over_budget");
            c.result.addProperty("bodyId",player.getUUID().toString());c.result.addProperty("sampledAt",Instant.now().toString());
            return c.result;
        }finally{CURRENT.remove();}
    }
    private static JsonObject menuState(ServerPlayer player,String id) {
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("requestId",id);out.addProperty("ok",true);
        out.addProperty("playerUuid",player.getUUID().toString());out.add("state",PlayerMenuBridge.snapshot(player));return out;
    }
    private static boolean valid(JsonElement value,JsonObject schema,int depth) {try{validate(value,schema,depth);return true;}catch(IllegalArgumentException e){return false;}}
    private static void validate(JsonElement value,JsonObject schema,int depth) {
        if(schema.has("type")&&schema.get("type").isJsonArray()) {
            for(var type:schema.getAsJsonArray("type")){var alternative=schema.deepCopy();alternative.add("type",type);if(valid(value,alternative,depth+1))return;}
            throw new IllegalArgumentException("invalid_mod_arguments");
        }
        if(value!=null&&value.isJsonNull()&&schema.has("type")&&schema.get("type").getAsString().equals("null"))return;
        if(depth>32||value==null||value.isJsonNull())throw new IllegalArgumentException("invalid_mod_arguments");
        if(schema.has("const")&&!schema.get("const").equals(value))throw new IllegalArgumentException("invalid_mod_arguments");
        if(schema.has("enum")){boolean found=false;for(var v:schema.getAsJsonArray("enum"))found|=v.equals(value);if(!found)throw new IllegalArgumentException("invalid_mod_arguments");}
        for(String union:List.of("anyOf","allOf"))if(schema.has(union)) {
            boolean result=union.equals("allOf");for(var option:schema.getAsJsonArray(union)) {boolean v=valid(value,option.getAsJsonObject(),depth+1);result=union.equals("allOf")?result&&v:result||v;}
            if(!result)throw new IllegalArgumentException("invalid_mod_arguments");
        }
        if(schema.has("if")&&valid(value,schema.getAsJsonObject("if"),depth+1)&&schema.has("then"))validate(value,schema.getAsJsonObject("then"),depth+1);
        String type=schema.has("type")?schema.get("type").getAsString():"";
        boolean shape=switch(type){case "null"->false;case "object"->value.isJsonObject();case "array"->value.isJsonArray();case "string"->value.isJsonPrimitive()&&value.getAsJsonPrimitive().isString();case "boolean"->value.isJsonPrimitive()&&value.getAsJsonPrimitive().isBoolean();case "number","integer"->value.isJsonPrimitive()&&value.getAsJsonPrimitive().isNumber();default->true;};
        if(!shape)throw new IllegalArgumentException("invalid_mod_arguments");
        if(value.isJsonObject()) {
            var object=value.getAsJsonObject();if(schema.has("required"))for(var k:schema.getAsJsonArray("required"))if(!object.has(k.getAsString()))throw new IllegalArgumentException("invalid_mod_arguments");
            JsonObject props=schema.has("properties")?schema.getAsJsonObject("properties"):new JsonObject();
            if(object.size()>128)throw new IllegalArgumentException("invalid_mod_arguments");
            for(var e:object.asMap().entrySet()){
                if(props.has(e.getKey()))validate(e.getValue(),props.getAsJsonObject(e.getKey()),depth+1);
                else if(schema.has("additionalProperties")) {
                    var extra=schema.get("additionalProperties");
                    if(extra.isJsonObject())validate(e.getValue(),extra.getAsJsonObject(),depth+1);
                    else if(!extra.getAsBoolean())throw new IllegalArgumentException("invalid_mod_arguments");
                }
            }
        }else if(value.isJsonArray()) {
            int n=value.getAsJsonArray().size();if(n>4096||schema.has("minItems")&&n<schema.get("minItems").getAsInt()||schema.has("maxItems")&&n>schema.get("maxItems").getAsInt())throw new IllegalArgumentException("invalid_mod_arguments");
            if(schema.has("items"))for(var v:value.getAsJsonArray())validate(v,schema.getAsJsonObject("items"),depth+1);
        }else if(type.equals("string")) {
            String s=value.getAsString();if(schema.has("minLength")&&s.length()<schema.get("minLength").getAsInt()||schema.has("maxLength")&&s.length()>schema.get("maxLength").getAsInt()||schema.has("pattern")&&!java.util.regex.Pattern.compile(schema.get("pattern").getAsString()).matcher(s).find())throw new IllegalArgumentException("invalid_mod_arguments");
        }else if(type.equals("integer")||type.equals("number")) {
            var n=value.getAsBigDecimal();if(type.equals("integer")&&n.stripTrailingZeros().scale()>0||schema.has("minimum")&&n.compareTo(schema.get("minimum").getAsBigDecimal())<0||schema.has("maximum")&&n.compareTo(schema.get("maximum").getAsBigDecimal())>0)throw new IllegalArgumentException("invalid_mod_arguments");
        }
    }
}
