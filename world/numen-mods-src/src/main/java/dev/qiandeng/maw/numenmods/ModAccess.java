package dev.qiandeng.maw.numenmods;

import com.dwinovo.numen.entity.NumenPlayer;
import com.google.gson.*;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.fml.ModList;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;

/** Same-body native provider; no public listener and no operator command execution. */
public final class ModAccess {
    private static final Map<String,JsonObject> SPECS=load();
    private static final ThreadLocal<Frame> FRAME=new ThreadLocal<>();
    private static final class Frame {
        final UUID body;final String request;JsonObject receipt;
        Frame(ServerPlayer p,String r){body=p.getUUID();request=r;}
    }
    private static Map<String,JsonObject> load(){
        try(var in=ModAccess.class.getResourceAsStream("/maw-numen-mod-operations.json")){
            if(in==null)throw new IllegalStateException("native_mod_contract_missing");
            Map<String,JsonObject> rows=new TreeMap<>();
            for(var v:JsonParser.parseReader(new InputStreamReader(in,StandardCharsets.UTF_8)).getAsJsonObject().getAsJsonArray("operations")){
                var s=v.getAsJsonObject();if(rows.put(s.get("id").getAsString(),s)!=null)throw new IllegalStateException("duplicate_mod_operation");
            }return Map.copyOf(rows);
        }catch(java.io.IOException e){throw new IllegalStateException("native_mod_contract_unreadable",e);}
    }
    static boolean available(JsonObject s){return !s.has("requiredMod")||ModList.get().isLoaded(s.get("requiredMod").getAsString());}
    static List<String> idsFor(String mod){return SPECS.values().stream().filter(ModAccess::available)
        .filter(s->s.has("requiredMod")&&s.get("requiredMod").getAsString().equals(mod)).map(s->s.get("id").getAsString()).sorted().toList();}
    public static JsonObject catalog(String operation){
        var out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("ok",true);out.addProperty("source","owned_numen_native_mod_extensions");
        out.addProperty("operationCount",SPECS.values().stream().filter(ModAccess::available).count());out.addProperty("allGameplayVerified",false);
        if(operation!=null&&!operation.isBlank()){
            var spec=SPECS.get(operation);if(spec==null||!available(spec))throw new IllegalArgumentException("mod_operation_not_available");out.add("operation",publicRow(spec,true));
        }else{var rows=new JsonArray();SPECS.values().stream().filter(ModAccess::available).sorted(Comparator.comparing(s->s.get("id").getAsString())).forEach(s->rows.add(publicRow(s,false)));out.add("operations",rows);}
        return out;
    }
    private static JsonObject publicRow(JsonObject spec,boolean details){
        var row=new JsonObject();for(String k:List.of("id","readOnly","description","requiredMod","units"))if(spec.has(k))row.add(k,spec.get(k).deepCopy());
        if(details)row.add("parameters",spec.get("parameters").deepCopy());row.addProperty("availableWithoutClient",true);row.addProperty("permissions","owned_body_and_native_mod_rules");return row;
    }
    static void requireBody(ServerPlayer p){
        if(!(p instanceof NumenPlayer)||p.getServer()==null||!p.getServer().isSameThread())throw new IllegalArgumentException("owned_numen_body_on_server_thread_required");
    }
    static boolean capturing(ServerPlayer p){var f=FRAME.get();return f!=null&&f.body.equals(p.getUUID());}
    static boolean capture(ServerPlayer p,JsonObject value){
        var f=FRAME.get();if(f==null||!f.body.equals(p.getUUID()))return false;
        if(value.has("requestId")&&f.request.equals(value.get("requestId").getAsString())){
            if(f.receipt!=null)throw new IllegalStateException("duplicate_native_receipt");f.receipt=value.deepCopy();
        }return true;
    }
    public static JsonObject invoke(ServerPlayer p,String id,JsonObject arguments,boolean readOnly,String requestId){
        requireBody(p);if(!requestId.matches("[A-Za-z0-9:_-]{1,64}"))throw new IllegalArgumentException("invalid_mod_request_id");
        var spec=SPECS.get(id);if(spec==null||!available(spec))throw new IllegalArgumentException("mod_operation_not_available");
        if(spec.get("readOnly").getAsBoolean()!=readOnly)throw new IllegalArgumentException("mod_read_write_mismatch");
        SchemaValidation.validate(arguments,spec.getAsJsonObject("parameters"),0);
        if(!readOnly&&(!p.isAlive()||p.isSpectator()))throw new IllegalArgumentException("body_dead_or_spectating");
        if(FRAME.get()!=null)throw new IllegalStateException("native_call_nested");
        JsonObject input=spec.getAsJsonObject("defaults").deepCopy();arguments.asMap().forEach((k,v)->input.add(k,v.deepCopy()));
        input.addProperty("schemaVersion",1);input.addProperty("requestId",requestId);input.addProperty("kind",spec.get("kind").getAsString());
        if(!readOnly)for(String key:List.of("position","buildingPosition"))if(input.has(key))WorldPermissions.check(p,ModRequest.position(input,key));
        var frame=new Frame(p,requestId);FRAME.set(frame);
        try{
            JsonObject result=switch(spec.get("route").getAsString()){
                case "menu"->MenuNative.invoke(p,id,arguments);
                case "mods"->modInfo(id,arguments);
                case "machine"->MachineNative.invoke(p,input,!readOnly);
                case "iron"->IronNative.invoke(p,id,arguments);
                case "colony"->ColonyNative.invoke(p,input,!readOnly);
                case "domum"->ColonyNative.domum(p,input,!readOnly);
                default->throw new IllegalArgumentException("mod_route_unavailable");
            };
            if(result==null)result=frame.receipt;
            if(result==null)throw new IllegalStateException("native_receipt_missing_do_not_replay");
            if(result.toString().getBytes(StandardCharsets.UTF_8).length>65536)throw new IllegalStateException("native_receipt_over_budget");
            result.addProperty("bodyId",p.getUUID().toString());result.addProperty("playerUuid",p.getUUID().toString());result.addProperty("sampledAt",Instant.now().toString());
            result.addProperty("retryAutomatically",false);return result;
        }finally{FRAME.remove();}
    }
    private static JsonObject modInfo(String id,JsonObject args){
        var out=new JsonObject();out.addProperty("ok",true);var gson=new Gson();
        if(id.equals("mods.explain"))out.add("state",gson.toJsonTree(ModCatalog.row(args.get("modId").getAsString())));
        else{
            var all=ModCatalog.rows();int offset=args.has("offset")?args.get("offset").getAsInt():0,limit=args.has("limit")?args.get("limit").getAsInt():24;
            int end=Math.min(all.size(),offset+limit);out.addProperty("total",all.size());out.addProperty("nextOffset",end<all.size()?end:-1);
            out.add("mods",gson.toJsonTree(all.subList(Math.min(offset,all.size()),Math.max(Math.min(offset,all.size()),end))));
        }return out;
    }
    public static JsonObject bodySnapshot(ServerPlayer p){
        requireBody(p);var out=new JsonObject();var menu=MenuNative.snapshot(p);out.addProperty("bodyId",p.getUUID().toString());
        out.addProperty("capturedAt",Instant.now().toString());out.addProperty("capturedTick",p.getServer().getTickCount());out.add("menu",menu);out.add("self",menu.get("self").deepCopy());return out;
    }
}
