package local.tlmcompat.hybrid;

import com.google.gson.*;
import com.sun.net.httpserver.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import local.tlmcompat.core.CompatibilityException;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** Optional authenticated loopback transport. Every body decision is rechecked on the game thread. */
final class NativeMaidBodyPort implements AutoCloseable {
    private final HybridMaidPlugin plugin;
    private final MaidBodyControl control;
    private final NativeMaidBodyActions actions;
    private final MaidPlayerProfiles playerProfiles;
    private final HttpServer server;
    private final ExecutorService executor;
    private final byte[] token;
    private final boolean guidesEnabled;
    private volatile boolean closed;
    static NativeMaidBodyPort open(HybridMaidPlugin plugin){
        var path=plugin.getDataFolder().toPath().resolve("native-body-port.json");if(!Files.exists(path))return null;
        try{return new NativeMaidBodyPort(plugin,path);}catch(Exception e){plugin.getLogger().warning("Native body port disabled; configuration or bind failed: "+e.getClass().getSimpleName());return null;}
    }
    private NativeMaidBodyPort(HybridMaidPlugin plugin,Path path)throws Exception {
        this.plugin=plugin;if(Files.size(path)>65536)throw new IllegalArgumentException("config_size");
        var config=JsonParser.parseString(Files.readString(path)).getAsJsonObject();
        if(config.get("schema").getAsInt()!=1||!config.get("enabled").getAsBoolean())throw new IllegalArgumentException("disabled_or_schema");
        int port=config.get("port").getAsInt();if(port<1024||port>65535)throw new IllegalArgumentException("port");
        var tokenFile=Path.of(config.get("tokenFile").getAsString());if(Files.size(tokenFile)>256)throw new IllegalArgumentException("token_size");
        var secret=Files.readString(tokenFile).strip();if(!secret.matches("[A-Za-z0-9_-]{32,128}"))throw new IllegalArgumentException("token_format");
        token=("Bearer "+secret).getBytes(StandardCharsets.UTF_8);
        guidesEnabled=config.has("guideCompanions")&&config.get("guideCompanions").getAsBoolean();
        var bindings=new LinkedHashMap<UUID,UUID>();var rows=config.getAsJsonArray("bindings");if(rows.size()>24||rows.isEmpty()&&!guidesEnabled)throw new IllegalArgumentException("bindings");
        for(var value:rows){var row=value.getAsJsonObject();var maid=MaidBodyControl.uuid(row,"maidId");var owner=MaidBodyControl.uuid(row,"ownerId");
            if(bindings.put(maid,owner)!=null)throw new IllegalArgumentException("duplicate_body");
            var registered=plugin.registeredMaids().get(maid.toString());
            if(registered==null||!owner.toString().equals(registered.getAsJsonObject().get("ownerId").getAsString()))throw new IllegalArgumentException("original_binding_required");
            if(row.has("controller")){
                if(!"unified".equals(row.get("controller").getAsString()))throw new IllegalArgumentException("unknown_controller");
                // A disconnected unified host must not wake the retired dialogue
                // planner. This designation survives lease expiry and bind errors.
                plugin.registerUnifiedBody(maid);
                if (row.has("starterKit") && row.get("starterKit").getAsBoolean()) plugin.registerStarterKit(maid);
            }
        }
        MaidPlayerProfiles profiles;
        try {
            profiles = MaidPlayerProfiles.from(rows);
        } catch (MaidBodyControl.Fault | IllegalArgumentException invalid) {
            plugin.getLogger().warning("Player profile reads disabled: invalid playerProfileId pairing in native-body-port.json");
            profiles = MaidPlayerProfiles.from(new JsonArray());
        }
        playerProfiles = profiles;
        control=new MaidBodyControl(plugin.getDataFolder().toPath().resolve("native-body-receipts"),bindings,
            id->guidesEnabled?plugin.guideOwner(id):null);
        actions=new NativeMaidBodyActions(plugin,control);
        server=HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"),port),16);
        executor=new ThreadPoolExecutor(2,2,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(16),r->{var t=new Thread(r,"maid-body-http");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
        server.setExecutor(executor);server.createContext("/maid-body",this::request);server.start();
        Bukkit.getScheduler().runTaskTimer(plugin,this::tick,1,1);
        plugin.getLogger().info("Native maid body port listening on loopback; "+bindings.size()+" explicit bindings");
    }
    boolean active(UUID maid){return control.active(maid);}
    boolean guidesEnabled(){return guidesEnabled;}
    JsonObject playerRoleProfile(UUID player, UUID maid) {
        return playerProfiles.read(player, maid, () -> plugin.ownedLoaded(player, maid).getOwnerUUID(),
            NativeMaidMagicSupport::cachedPlayerProfile);
    }
    String playerRoleIssue(UUID player, UUID maid) {
        return playerProfiles.issue(player, maid, () -> plugin.ownedLoaded(player, maid).getOwnerUUID());
    }
    boolean exclusive(UUID maid){return active(maid)&&!actions.companion(maid);}
    boolean guarding(UUID maid){return active(maid)&&actions.guarding(maid);}
    long epoch(UUID maid){return control.epoch(maid);}
    boolean travelAllowed(UUID maid){return !active(maid)||actions.following(maid);}
    void ownerTakeover(UUID owner,UUID maid){var lease=control.lease(maid);if(lease!=null&&lease.owner().equals(owner))release(maid,"owner_takeover");}
    JsonObject ownerMode(Player actor, UUID maid, String action, String request, String value) throws Exception {
        if (value != null && !value.isBlank()) throw new CompatibilityException("bad_arguments", "Use the maid ID and original request ID");
        UUID owner = actor.getUniqueId();
        control.authorize(owner, maid);
        if (control.read(maid, request) == null) plugin.requireNearby(actor, plugin.ownedLoaded(actor, maid), 32);
        var args = new JsonObject();
        args.addProperty("action", action);
        args.addProperty("requestId", request);
        var response = actions.call(owner, maid, args);
        var body = JsonParser.parseString(response.getAsJsonArray("content").get(0).getAsJsonObject().get("text").getAsString()).getAsJsonObject();
        var data = body.getAsJsonObject("data");
        if (!body.get("ok").getAsBoolean() && body.has("reason") && data.has("observation")) {
            var observation = data.getAsJsonObject("observation");
            observation.add("error", body.get("reason"));
            observation.add("message", body.get("reason"));
        }
        return data;
    }
    JsonObject ownerReceipt(UUID owner, UUID maid, String request) throws Exception {
        control.authorize(owner, maid);
        return control.read(maid, request) == null ? null : actions.receipt(owner, maid, request);
    }
    String custodySourceGeneration(UUID owner, UUID maid, UUID controller) {
        var lease=control.lease(maid);
        if (lease==null || !lease.controller().equals(controller) || !lease.owner().equals(owner)) return null;
        return control.require(owner,maid,controller,lease.generation(),System.currentTimeMillis()).generation();
    }
    void checkCustodySource(UUID owner, UUID maid, UUID controller, String generation) {
        control.require(owner,maid,controller,generation,System.currentTimeMillis());
        plugin.nativeReady(owner,maid);
        if (actions.busy(maid)) throw new MaidBodyControl.Fault(409,"BODY_BUSY");
        if (local.qdj.maids.brain.MaidAgentsMod.residentIdentities().containsKey(maid))
            local.qdj.maids.brain.ResidentBodyAccess.externalReady(maid);
    }
    void releaseCustodySource(UUID owner, UUID maid, UUID controller, String generation) throws Exception {
        control.require(owner,maid,controller,generation,System.currentTimeMillis());
        if (!local.qdj.maids.brain.MaidAgentsMod.custodyHeld(maid)) throw new MaidBodyControl.Fault(409,"CUSTODY_REQUIRED");
        actions.cancel(maid,"body_parked");
        control.release(maid);
    }
    String acquireCustodyTarget(UUID owner, UUID maid, UUID controller) throws Exception {
        if (!local.qdj.maids.brain.MaidAgentsMod.custodyClaiming(maid)) throw new MaidBodyControl.Fault(409,"CUSTODY_REQUIRED");
        if (control.active(maid)) throw new MaidBodyControl.Fault(409,"CONTROL_BUSY");
        var input=new JsonObject();
        input.addProperty("operation","bind"); input.addProperty("ownerId",owner.toString());
        input.addProperty("maidId",maid.toString()); input.addProperty("controllerId",controller.toString());
        return handle(input).get("generation").getAsString();
    }
    boolean busy(UUID maid) { return actions.busy(maid); }
    void caught(com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid maid, JsonArray loot) {
        actions.caught(maid, loot);
    }
    void requireUnusedNativeRequest(UUID owner, UUID maid, String request) throws Exception {
        plugin.owned(owner, maid);
        if (control.read(maid, request) != null)
            throw new CompatibilityException("request_conflict", "请查询这次身体动作的原回执。");
    }
    private void release(UUID maid,String reason){
        try{actions.cancel(maid,reason);}catch(Exception e){plugin.getLogger().warning("Native body stop receipt uncertain; query original request");}
        finally{control.release(maid);}
    }
    private void tick(){if(closed)return;for(var id:control.expired(System.currentTimeMillis()))release(id,"controller_expired");actions.tick();}
    private void request(HttpExchange exchange){
        try(exchange){
            if(!exchange.getRequestURI().getPath().equals("/maid-body")||exchange.getRequestURI().getQuery()!=null){send(exchange,404,error("NOT_FOUND"));return;}
            if(!exchange.getRequestMethod().equals("POST")){send(exchange,405,error("POST_REQUIRED"));return;}
            String auth=exchange.getRequestHeaders().getFirst("Authorization");
            if(auth==null||!MessageDigest.isEqual(token,auth.getBytes(StandardCharsets.UTF_8))){send(exchange,401,error("UNAUTHORIZED"));return;}
            if(closed){send(exchange,503,error("PORT_STOPPED"));return;}
            byte[] bytes=exchange.getRequestBody().readNBytes(16385);if(bytes.length>16384){send(exchange,413,error("PAYLOAD_TOO_LARGE"));return;}
            JsonObject input;
            try{var decoder=StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT);input=JsonParser.parseString(decoder.decode(java.nio.ByteBuffer.wrap(bytes)).toString()).getAsJsonObject();}
            catch(Exception invalid){send(exchange,400,error("INVALID_JSON"));return;}
            var result=new CompletableFuture<JsonObject>();var phase=new AtomicInteger();
            var task=Bukkit.getScheduler().runTask(plugin,()->{if(!phase.compareAndSet(0,1))return;
                try{result.complete(handle(input));}catch(Exception failure){result.completeExceptionally(failure);}});
            try{send(exchange,200,result.get(5,TimeUnit.SECONDS));}
            catch(TimeoutException timeout){boolean unsent=phase.compareAndSet(0,2);if(unsent)task.cancel();var body=error(unsent?"NOT_DISPATCHED":"RESULT_UNKNOWN");body.addProperty("retryAllowed",false);send(exchange,503,body);}
            catch(ExecutionException failure){var cause=failure.getCause();if(cause instanceof MaidBodyControl.Fault fault)send(exchange,fault.http,error(fault.code));
                else if(cause instanceof CompatibilityException compat)send(exchange,409,error(compat.code()));
                else send(exchange,503,error("RESULT_UNKNOWN"));}
            catch(InterruptedException interrupted){Thread.currentThread().interrupt();if(phase.compareAndSet(0,2))task.cancel();send(exchange,503,error("RESULT_UNKNOWN"));}
        }catch(Exception ignored){/* No request bodies, auth headers or model secrets in logs. */}
    }
    private JsonObject handle(JsonObject input)throws Exception {
        if(closed)throw new MaidBodyControl.Fault(503,"PORT_STOPPED");
        var operation=MaidBodyControl.string(input,"operation");
        if(operation.equals("guide_list")){
            MaidBodyControl.keys(input,Set.of("operation"));
            if(!guidesEnabled)throw new MaidBodyControl.Fault(404,"GUIDES_DISABLED");
            var result=new JsonObject();result.addProperty("protocol",MaidBodyControl.PROTOCOL);result.add("guides",plugin.onlineGuides());return result;
        }
        if(operation.equals("guide_profile")){
            MaidBodyControl.keys(input,Set.of("operation","ownerId","maidId","profileRevision","name"));
            if(!guidesEnabled)throw new MaidBodyControl.Fault(404,"GUIDES_DISABLED");
            var owner=MaidBodyControl.uuid(input,"ownerId");
            var body=MaidBodyControl.uuid(input,"maidId");
            if(!owner.equals(plugin.guideOwner(body)))throw new MaidBodyControl.Fault(403,"NOT_AUTHORIZED");
            var applied=plugin.applyGuideProfile(owner,body,input.get("profileRevision").getAsLong(),MaidBodyControl.string(input,"name"));
            var result=new JsonObject();result.addProperty("protocol",MaidBodyControl.PROTOCOL);result.addProperty("applied",applied);return result;
        }
        MaidBodyControl.keys(input,Set.of("operation","ownerId","maidId","controllerId","generation","name","arguments","requestId"));
        var owner=MaidBodyControl.uuid(input,"ownerId");var maid=MaidBodyControl.uuid(input,"maidId");var controller=MaidBodyControl.uuid(input,"controllerId");
        control.authorize(owner,maid);MaidBodyControl.Lease lease;
        if(plugin.guideOwner(maid)!=null&&!operation.equals("release")){
            var player=Bukkit.getPlayer(owner);
            if(player==null||!player.isOnline()||player.isDead()||player.getGameMode()==org.bukkit.GameMode.SPECTATOR)
                throw new MaidBodyControl.Fault(409,"GUIDE_OWNER_UNAVAILABLE");
        }
        if(operation.equals("bind")){
            MaidBodyControl.keys(input,Set.of("operation","ownerId","maidId","controllerId"));
            if(!control.active(maid)){
                // A public resident has its own controller. Never take it over by weakening its registration.
                if(local.qdj.maids.brain.MaidAgentsMod.residentIdentities().containsKey(maid)){
                    if(!local.qdj.maids.brain.ResidentBodyAccess.external(maid))throw new MaidBodyControl.Fault(409,"RESIDENT_CONTROLLER_ACTIVE");
                    local.qdj.maids.brain.ResidentBodyAccess.externalReady(maid);
                }
                plugin.nativeReady(owner,maid);plugin.nativeQuiesce(plugin.ownedLoaded(owner,maid));
            }
            lease=control.bind(owner,maid,controller,System.currentTimeMillis());
            var out=envelope(lease);var tools=new JsonArray();tools.add(MaidBodyControl.tool());out.add("tools",tools);out.addProperty("leaseTimeoutMs",MaidBodyControl.LEASE_MILLIS);return out;
        }
        String generation=MaidBodyControl.string(input,"generation");
        if(operation.equals("release")&&plugin.guideOwner(maid)!=null&&!control.active(maid)){
            MaidBodyControl.keys(input,Set.of("operation","ownerId","maidId","controllerId","generation"));
            var released=envelope(new MaidBodyControl.Lease(owner,maid,controller,generation,0));
            released.addProperty("released",true);
            return released;
        }
        lease=control.require(owner,maid,controller,generation,System.currentTimeMillis());
        var out=envelope(lease);
        if(operation.equals("release")){MaidBodyControl.keys(input,Set.of("operation","ownerId","maidId","controllerId","generation"));release(maid,"controller_released");out.addProperty("released",true);return out;}
        if(!operation.equals("call"))throw new MaidBodyControl.Fault(400,"INVALID_operation");
        if(!MaidBodyControl.string(input,"name").equals("mc_maids")||!input.has("arguments")||!input.get("arguments").isJsonObject())throw new MaidBodyControl.Fault(400,"INVALID_TOOL");
        var args=input.getAsJsonObject("arguments");
        if(args.has("maidId")&&!maid.equals(MaidBodyControl.uuid(args,"maidId")))throw new MaidBodyControl.Fault(403,"BODY_MISMATCH");
        String action=MaidBodyControl.string(args,"action");
        if(MaidBodyControl.WRITES.contains(action)){
            var request=MaidBodyControl.request(input,"requestId");if(!request.equals(MaidBodyControl.request(args,"requestId")))throw new MaidBodyControl.Fault(400,"REQUEST_ID_MISMATCH");
        }
        out.add("result",actions.call(owner,maid,args));return out;
    }
    private static JsonObject envelope(MaidBodyControl.Lease lease){var out=new JsonObject();out.addProperty("protocol",MaidBodyControl.PROTOCOL);out.addProperty("ownerId",lease.owner().toString());out.addProperty("maidId",lease.maid().toString());out.addProperty("controllerId",lease.controller().toString());out.addProperty("generation",lease.generation());return out;}
    private static JsonObject error(String code){var out=new JsonObject();out.addProperty("protocol",MaidBodyControl.PROTOCOL);out.addProperty("error",code);out.addProperty("code",code);out.addProperty("retryAllowed",false);return out;}
    private static void send(HttpExchange exchange,int code,JsonObject json)throws java.io.IOException {
        var bytes=json.toString().getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json; charset=utf-8");exchange.getResponseHeaders().set("Cache-Control","no-store");exchange.sendResponseHeaders(code,bytes.length);exchange.getResponseBody().write(bytes);
    }
    @Override public void close(){closed=true;server.stop(0);executor.shutdownNow();for(var id:control.ids())if(control.active(id))release(id,"server_stopping");}
}
