package local.tlmcompat.hybrid;

import com.google.gson.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Main-thread controller leases and durable per-body receipts. No game or HTTP dependencies. */
final class MaidBodyControl {
    static final String PROTOCOL="qiandengji-maid-body/v1";
    static final long LEASE_MILLIS=120_000;
    static final Set<String> READS=Set.of("list","context","inventory","tasks","brain","receipt","inbox","spells","workshop");
    static final Set<String> WRITES=Set.of("release_rendezvous","rendezvous","walk","stop","stay","sit","follow","guard","companion","cast","task","equip","pickup","schedule","speak","ack","dismount","make","fish","bag_clean","bag_store","bag_donate");
    static final Set<String> BAG_ACTIONS=Set.of("bag_clean","bag_store","bag_donate");
    static Set<String> fields(String action){
        var keys=new HashSet<>(Set.of("action","maidId","requestId"));
        keys.addAll(switch(action){case "rendezvous","release_rendezvous"->Set.of("targetUuid");case "walk"->Set.of("x","y","z","dimension","targetUuid");case "receipt"->Set.of("operationId","operationAction");
            case "task"->Set.of("taskId");case "equip"->Set.of("hand","slot");case "schedule"->Set.of("schedule");
            case "cast"->Set.of("spellId");case "pickup"->Set.of("enabled");case "speak"->Set.of("text");case "ack"->Set.of("eventId");
            case "bag_clean","bag_store","bag_donate"->Set.of("dryRun");
            case "make"->Set.of("workshopId","recipeId","quantity","inventory");default->Set.of();});return keys;
    }
    static Set<String> requiredFields(String action){var fields=new HashSet<>(fields(action));fields.removeAll(Set.of("maidId","dimension","operationAction","quantity","dryRun"));if(action.equals("walk"))fields.remove("targetUuid");if(!WRITES.contains(action))fields.remove("requestId");return fields;}
    static void validateShape(JsonObject input){String action=string(input,"action");
        if(!READS.contains(action)&&!WRITES.contains(action))throw new Fault(400,"UNSUPPORTED_ACTION");keys(input,fields(action));
        if(input.has("dryRun")&&(!input.get("dryRun").isJsonPrimitive()||!input.getAsJsonPrimitive("dryRun").isBoolean()))throw new Fault(400,"INVALID_dryRun");
        for(String field:new TreeSet<>(requiredFields(action)))if(!input.has(field))throw new Fault(400,"INVALID_"+field);
        if (input.has("targetUuid")) uuid(input, "targetUuid");
        for(String field:List.of("maidId","requestId","operationId","operationAction","taskId","hand","schedule","text","dimension","eventId","targetUuid","spellId","workshopId","recipeId","inventory"))if(input.has(field))string(input,field);
    }
    static final class Fault extends RuntimeException {
        final int http; final String code;
        Fault(int http,String code){super(code);this.http=http;this.code=code;}
    }
    record Lease(UUID owner,UUID maid,UUID controller,String generation,long expiresAt){}
    private final Map<UUID,UUID> bindings;
    private final java.util.function.Function<UUID,UUID> guideOwner;
    private final Map<UUID,Lease> leases=new HashMap<>();
    private final Map<UUID,Long> epochs=new HashMap<>();
    private final Path directory;
    MaidBodyControl(Path directory,Map<UUID,UUID> bindings)throws IOException {
        this(directory,bindings,id->null);
    }
    MaidBodyControl(Path directory,Map<UUID,UUID> bindings,java.util.function.Function<UUID,UUID> guideOwner)throws IOException {
        this.directory=directory;this.bindings=Map.copyOf(bindings);this.guideOwner=guideOwner;Files.createDirectories(directory);
    }
    void authorize(UUID owner,UUID maid){if(!owner.equals(bindings.getOrDefault(maid,guideOwner.apply(maid))))throw new Fault(403,"NOT_AUTHORIZED");}
    Lease bind(UUID owner,UUID maid,UUID controller,long now){
        authorize(owner,maid);var old=leases.get(maid);
        // The host must stop the old body before releasing an expired controller.
        if(old!=null){if(old.expiresAt<=now)throw new Fault(409,"CONTROL_EXPIRED");
            if(!old.controller.equals(controller))throw new Fault(409,"CONTROL_BUSY");return require(owner,maid,controller,old.generation,now);}
        var lease=new Lease(owner,maid,controller,UUID.randomUUID().toString(),now+LEASE_MILLIS);
        leases.put(maid,lease);epochs.merge(maid,1L,Long::sum);return lease;
    }
    Lease require(UUID owner,UUID maid,UUID controller,String generation,long now){
        authorize(owner,maid);var old=leases.get(maid);
        if(old==null||!old.owner.equals(owner)||!old.controller.equals(controller)||!old.generation.equals(generation)||old.expiresAt<=now)
            throw new Fault(409,"CONTROL_CHANGED");
        var renewed=new Lease(owner,maid,controller,generation,now+LEASE_MILLIS);leases.put(maid,renewed);return renewed;
    }
    boolean active(UUID maid){return leases.containsKey(maid);}
    long epoch(UUID maid){return epochs.getOrDefault(maid,0L);}
    void invalidateCallbacks(UUID maid){epochs.merge(maid,1L,Long::sum);}
    Lease lease(UUID maid){return leases.get(maid);}
    List<UUID> expired(long now){return leases.values().stream().filter(x->x.expiresAt<=now).map(Lease::maid).toList();}
    Set<UUID> ids(){var ids=new HashSet<>(bindings.keySet());ids.addAll(leases.keySet());return ids;}
    void release(UUID maid){if(leases.remove(maid)!=null)epochs.merge(maid,1L,Long::sum);}
    static String string(JsonObject value,String key){
        if(!value.has(key)||!value.get(key).isJsonPrimitive()||!value.getAsJsonPrimitive(key).isString())throw new Fault(400,"INVALID_"+key);
        return value.get(key).getAsString();
    }
    static UUID uuid(JsonObject value,String key){try{var text=string(value,key);var id=UUID.fromString(text);if(!id.toString().equalsIgnoreCase(text))throw new IllegalArgumentException();return id;}catch(IllegalArgumentException e){throw new Fault(400,"INVALID_"+key);}}
    static String request(JsonObject value,String key){var s=string(value,key);if(!s.matches("[A-Za-z0-9_-]{1,48}"))throw new Fault(400,"INVALID_"+key);return s;}
    static void keys(JsonObject value,Set<String> allowed){if(!allowed.containsAll(value.keySet()))throw new Fault(400,"UNEXPECTED_FIELD");}
    static String canonical(JsonElement value){
        if(value.isJsonObject()){var out=new JsonObject();new TreeSet<>(value.getAsJsonObject().keySet()).forEach(k->out.add(k,JsonParser.parseString(canonical(value.getAsJsonObject().get(k)))));return out.toString();}
        if(value.isJsonArray()){var out=new JsonArray();value.getAsJsonArray().forEach(v->out.add(JsonParser.parseString(canonical(v))));return out.toString();}
        if(value.isJsonPrimitive()&&value.getAsJsonPrimitive().isNumber()){
            try{return value.getAsBigDecimal().stripTrailingZeros().toString();}
            catch(NumberFormatException|ArithmeticException invalid){throw new Fault(400,"INVALID_NUMBER");}
        }
        return value.toString();
    }
    /**
     * Evidence that an external cast failed before the RPG service persisted its ledger row.
     * ResidentCli.run persists on the same game thread before dispatch, so a not_found query
     * proves no spell or mana side effect happened. Only an accepted/unknown body receipt may
     * settle this way: a running receipt observed a service row earlier, and a vanished row is
     * not provable here — it stays unresolved for manual audit. The derived service request ID
     * mirrors ResidentBodyAccess.cast ("unified-cast:"+maid+":"+request); no new retry ID.
     */
    static JsonObject castPreDispatchEvidence(UUID maid,String request,String bodyStatus,JsonObject serviceReceipt){
        if(serviceReceipt==null||!serviceReceipt.has("status")||!serviceReceipt.get("status").isJsonPrimitive()
                ||!serviceReceipt.getAsJsonPrimitive("status").isString()||!serviceReceipt.get("status").getAsString().equals("not_found"))return null;
        if(!Set.of("accepted","unknown").contains(bodyStatus))return null;
        var evidence=new JsonObject();
        evidence.addProperty("reason","native_failure_before_service_dispatch");
        evidence.addProperty("effectsApplied",false);
        evidence.addProperty("serviceRequestId",UUID.nameUUIDFromBytes(("unified-cast:"+maid+":"+request).getBytes(StandardCharsets.UTF_8)).toString());
        evidence.add("serviceReceipt",serviceReceipt.deepCopy());
        return evidence;
    }
    private Path file(UUID maid,String request){if(!request.matches("[A-Za-z0-9_-]{1,48}"))throw new Fault(400,"INVALID_requestId");return directory.resolve(maid.toString()).resolve(request+".json");}
    JsonObject read(UUID maid,String request)throws IOException {
        var file=file(maid,request);if(!Files.exists(file))return null;
        if(Files.size(file)>262144)throw new Fault(503,"RECEIPT_UNAVAILABLE");
        try{var row=JsonParser.parseString(Files.readString(file)).getAsJsonObject();
            if(!maid.toString().equals(row.get("maidId").getAsString())||!request.equals(row.get("requestId").getAsString()))throw new IllegalArgumentException();return row;
        }catch(RuntimeException e){throw new Fault(503,"RECEIPT_UNAVAILABLE");}
    }
    JsonObject reserve(UUID owner,UUID maid,String request,JsonObject arguments)throws IOException {
        authorize(owner,maid);var old=read(maid,request);
        if(old!=null){if(!canonical(JsonParser.parseString(old.get("arguments").getAsString())).equals(canonical(arguments)))throw new Fault(409,"REQUEST_CONFLICT");return old;}
        var row=new JsonObject();row.addProperty("schema",1);row.addProperty("namespace","native-body");row.addProperty("maidId",maid.toString());
        row.addProperty("ownerId",owner.toString());row.addProperty("requestId",request);row.addProperty("operationId",request);row.addProperty("action",string(arguments,"action"));
        row.addProperty("arguments",canonical(arguments));row.addProperty("status","accepted");row.addProperty("terminal",false);row.addProperty("retryAllowed",false);
        row.addProperty("observedAt",java.time.Instant.now().toString());write(file(maid,request),row);return null;
    }
    JsonObject finish(UUID maid,String request,String status,JsonObject observation)throws IOException {
        var row=read(maid,request);if(row==null)throw new Fault(503,"RECEIPT_UNAVAILABLE");
        row.addProperty("status",status);row.addProperty("terminal",!Set.of("accepted","running","unknown").contains(status));
        String action = row.get("action").getAsString();
        String evidence = BAG_ACTIONS.contains(action) ? "allHandled" : action.equals("fish") ? "verifiedCatch" : "arrived";
        var proof = observation.get(evidence);
        row.addProperty("goalCompleted", status.equals("completed") && proof != null && proof.getAsBoolean());
        if(observation.has("actualPosition"))row.add("actualPosition",observation.get("actualPosition").deepCopy());
        row.addProperty("observedAt",java.time.Instant.now().toString());row.add("observation",observation);write(file(maid,request),row);return row;
    }
    private static void write(Path file,JsonObject value)throws IOException {
        Files.createDirectories(file.getParent());var temp=Files.createTempFile(file.getParent(),"receipt-",".tmp");
        try{byte[] bytes=value.toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>262144)throw new IOException("oversized_body_receipt");
            try(var channel=java.nio.channels.FileChannel.open(temp,StandardOpenOption.WRITE)){
                var buffer=java.nio.ByteBuffer.wrap(bytes);while(buffer.hasRemaining())channel.write(buffer);channel.force(true);
            }
            // Fail before dispatch when atomic replacement is unavailable. Never silently weaken the journal.
            Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}
        finally{Files.deleteIfExists(temp);}
    }
    static JsonObject tool(){
        var schema=new JsonObject();schema.addProperty("type","object");schema.addProperty("additionalProperties",false);
        var p=new JsonObject();var action=new JsonObject();action.addProperty("type","string");var values=new JsonArray();
        new TreeSet<>(READS).forEach(values::add);new TreeSet<>(WRITES).forEach(values::add);action.add("enum",values);p.add("action",action);
        for(String k:List.of("maidId","requestId","operationId","operationAction","taskId","hand","schedule","text","dimension","eventId","targetUuid","spellId","workshopId","recipeId","inventory")){var field=new JsonObject();field.addProperty("type","string");p.add(k,field);}
        var quantity = new JsonObject();quantity.addProperty("type","integer");quantity.addProperty("minimum",1);quantity.addProperty("description","Number of finished items. Omit for one batch.");p.add("quantity",quantity);
        for(String k:List.of("x","y","z")){var field=new JsonObject();field.addProperty("type","number");field.addProperty("description","Absolute world coordinate in blocks; all x,y,z required for walk. Loaded destination within 96 blocks, no digging or teleporting.");p.add(k,field);}
        var slot=new JsonObject();slot.addProperty("type","integer");slot.addProperty("minimum",0);p.add("slot",slot);
        var enabled=new JsonObject();enabled.addProperty("type","boolean");p.add("enabled",enabled);p.add("dryRun",enabled.deepCopy());
        schema.add("properties",p);var required=new JsonArray();required.add("action");schema.add("required",required);
        // Branch-specific fields and requirements are the same definition used by the executor.
        var branches=new JsonArray();for(var element:values){String name=element.getAsString();var branch=new JsonObject();var properties=new JsonObject();var constant=new JsonObject();constant.addProperty("const",name);properties.add("action",constant);branch.add("properties",properties);
            var needed=new JsonArray();requiredFields(name).stream().sorted().forEach(needed::add);branch.add("required",needed);
            var names=new JsonObject();var allowed=new JsonArray();fields(name).stream().sorted().forEach(allowed::add);names.add("enum",allowed);branch.add("propertyNames",names);branches.add(branch);}
        schema.add("oneOf",branches);
        var out=new JsonObject();out.addProperty("name","mc_maids");out.addProperty("description","Original owned maid body, lease scoped. Reads need no online owner. Writes require original requestId; query receipt after timeout. Workshop make uses only an authorized site, recipe and inventory with the real nearby owner. A pending job is not a finished item. bag_clean clears plain junk, bag_store sends surplus to the personal box, bag_donate gives surplus to public guild chests. dryRun=true previews. spells lists learned spells; walk lasts at most 30s. Use context.characterDirectory for world-wide targets; rendezvous takes targetUuid, spends team-travel mana on verified arrival.");out.add("inputSchema",schema);return out;
    }
}
