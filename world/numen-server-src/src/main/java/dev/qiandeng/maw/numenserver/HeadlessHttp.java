package dev.qiandeng.maw.numenserver;

import static dev.qiandeng.maw.numenserver.PrivateStore.*;
import com.google.gson.*;
import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;

/** Authenticated stateless MCP transport. Never reads Minecraft state off its thread. */
final class HeadlessHttp {
    final HeadlessRuntime runtime;
    final HttpServer server;
    final ExecutorService executor;
    final Map<UUID,long[]> rates=new ConcurrentHashMap<>();
    static final Set<String> VERSIONS=Set.of("2025-06-18","2025-03-26","2025-11-25");
    HeadlessHttp(HeadlessRuntime r) throws IOException {
        runtime=r;
        server=HttpServer.create(new InetSocketAddress(text(r.config,"bind",100),r.config.get("port").getAsInt()),32);
        executor=new ThreadPoolExecutor(4,4,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(32),job->{Thread t=new Thread(job,"maw-numen-http");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
        server.setExecutor(executor);server.createContext("/",this::handle);
    }
    void start(){server.start();}
    void stop(){server.stop(0);executor.shutdownNow();}
    boolean hostAllowed(String host) {
        if(host==null||host.indexOf('@')>=0)return false;
        for(var allowed:runtime.config.getAsJsonArray("allowedHosts"))if(host.equalsIgnoreCase(allowed.getAsString()))return true;
        return false;
    }
    UUID authenticate(HttpExchange x) {
        String header=x.getRequestHeaders().getFirst("Authorization");
        if(header==null||!header.matches("Bearer [a-f0-9]{64}"))return null;
        String hash=hash(header.substring(7));
        for(var entry:read(runtime.secrets.resolve("accounts.json")).getAsJsonArray("accounts")) {
            JsonObject account=entry.getAsJsonObject();
            if(equalsSecret(hash,text(account,"tokenHash",64)))return UUID.fromString(text(account,"ownerUuid",36));
        }return null;
    }
    boolean rate(UUID owner) {
        long now=System.currentTimeMillis();long[] window=rates.computeIfAbsent(owner,k->new long[]{now,0});
        synchronized(window){if(now-window[0]>=60000){window[0]=now;window[1]=0;}return ++window[1]<=240;}
    }
    void handle(HttpExchange x) throws IOException {
        try {
            x.getResponseHeaders().set("Cache-Control","no-store");
            x.getResponseHeaders().set("X-Content-Type-Options","nosniff");
            if(!hostAllowed(x.getRequestHeaders().getFirst("Host"))){send(x,403,object("code","untrusted_host"));return;}
            if(x.getRequestHeaders().getFirst("Origin")!=null){send(x,403,object("code","browser_origin_not_supported"));return;}
            String path=x.getRequestURI().getPath();
            if(path.equals("/healthz")){
                if(!x.getRemoteAddress().getAddress().isLoopbackAddress()){send(x,403,object("code","loopback_only"));return;}
                if(!x.getRequestMethod().equals("GET")){send(x,405,object("code","get_required"));return;}
                send(x,200,object("ok",true,"serverResident",true,"clientRequired",false,"numenVersion","0.1.4.1","maidConfigAvailable",runtime.maids!=null,"bedrockVisualMenus",true,"session",runtime.session));return;
            }
            if(!Set.of("/mcp","/ui").contains(path)){send(x,404,object("code","not_found"));return;}
            if(!x.getRequestMethod().equals("POST")){send(x,405,object("code","post_required"));return;}
            String ct=x.getRequestHeaders().getFirst("Content-Type");
            if(ct==null||!ct.toLowerCase(Locale.ROOT).startsWith("application/json")){send(x,415,object("code","json_required"));return;}
            UUID owner=null;
            if(path.equals("/ui")) {
                if(!x.getRemoteAddress().getAddress().isLoopbackAddress()||!equalsSecret(Objects.toString(x.getRequestHeaders().getFirst("X-Maw-Bridge"),""),text(read(runtime.secrets.resolve("bridge.json")),"secret",64))){send(x,403,object("code","trusted_bedrock_bridge_required"));return;}
            }else {
                owner=authenticate(x);if(owner==null){x.getResponseHeaders().set("WWW-Authenticate","Bearer");send(x,401,object("code","invalid_bearer"));return;}
                if(!rate(owner)){send(x,429,object("code","request_rate_limited"));return;}
                String version=x.getRequestHeaders().getFirst("MCP-Protocol-Version");
                if(version!=null&&!VERSIONS.contains(version)){send(x,400,object("code","unsupported_protocol_version"));return;}
            }
            byte[] bytes=x.getRequestBody().readNBytes(65537);
            if(bytes.length>65536){send(x,413,object("code","request_too_large"));return;}
            JsonObject in=JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject();
            if(path.equals("/ui")) {
                UUID actual=UUID.fromString(text(in,"ownerUuid",36));String name=text(in,"playerName",16),action=text(in,"action",40);
                JsonObject args=in.has("arguments")?in.getAsJsonObject("arguments"):new JsonObject();
                JsonObject result=runtime.onMain(()->runtime.ui(actual,name,action,args));send(x,200,result);return;
            }
            if(!in.has("jsonrpc")||!"2.0".equals(in.get("jsonrpc").getAsString())){send(x,400,error(JsonNull.INSTANCE,-32600,"invalid_request"));return;}
            JsonElement id=in.has("id")?in.get("id"):JsonNull.INSTANCE;
            if(!id.isJsonNull()&&(!id.isJsonPrimitive()||id.toString().length()>130)){send(x,400,error(JsonNull.INSTANCE,-32600,"invalid_id"));return;}
            String method=text(in,"method",100);
            if(!in.has("id")){send(x,202,null);return;}
            JsonObject params=in.has("params")?in.getAsJsonObject("params"):new JsonObject();JsonObject result;
            switch(method) {
                case "initialize" -> {
                    String requested=params.has("protocolVersion")?text(params,"protocolVersion",30):"2025-06-18";
                    result=object("protocolVersion",VERSIONS.contains(requested)?requested:"2025-06-18","capabilities",object("tools",object("listChanged",false)),"serverInfo",object("name","my-agent-world-numen","version","0.1.0"),"instructions","Server-resident bodies. Call operations before Lua. Mutations need claim_control and unique action_id. Reconnect: query action_status; never replay unknown. Tokens are owner-scoped.");
                }
                case "ping" -> result=new JsonObject();
                case "tools/list" -> result=object("tools",catalog());
                case "tools/call" -> {
                    UUID authorized=owner;String operation=text(params,"name",80);
                    if(!names().contains(operation)){send(x,200,error(id,-32602,"unknown_tool"));return;}
                    JsonObject args=params.has("arguments")?params.getAsJsonObject("arguments"):new JsonObject();
                    JsonObject outcome=runtime.onMain(()->runtime.invoke(authorized,operation,args));
                    JsonArray content=new JsonArray();content.add(object("type","text","text",outcome.toString()));
                    result=object("content",content,"structuredContent",outcome,"isError",outcome.has("ok")&&!outcome.get("ok").getAsBoolean());
                }
                default -> {send(x,200,error(id,-32601,"method_not_found"));return;}
            }
            send(x,200,object("jsonrpc","2.0","id",id,"result",result));
        }catch(IllegalArgumentException|IllegalStateException ex){send(x,400,object("ok",false,"code",HeadlessRuntime.safeCode(ex)));}
        catch(Exception ex){
            Throwable cause=ex;while(cause.getCause()!=null)cause=cause.getCause();
            if(cause instanceof IllegalArgumentException){send(x,400,object("ok",false,"code",HeadlessRuntime.safeCode(cause)));return;}
            org.slf4j.LoggerFactory.getLogger("maw-numen-server").error("MAW_NUMEN_HTTP failed class={} code={} frames={}",cause.getClass().getName(),HeadlessRuntime.safeCode(cause),Arrays.toString(Arrays.copyOf(cause.getStackTrace(),Math.min(5,cause.getStackTrace().length))));
            send(x,503,object("ok",false,"code",HeadlessRuntime.safeCode(cause)));
        }
        finally{x.close();}
    }
    static JsonObject error(JsonElement id,int code,String message){return object("jsonrpc","2.0","id",id,"error",object("code",code,"message",message));}
    static void send(HttpExchange x,int code,JsonObject value) throws IOException {
        if(value==null){x.sendResponseHeaders(code,-1);return;}
        byte[] body=value.toString().getBytes(StandardCharsets.UTF_8);x.getResponseHeaders().set("Content-Type","application/json; charset=utf-8");x.sendResponseHeaders(code,body.length);x.getResponseBody().write(body);
    }
    static Set<String> names(){return Set.of("operations","list_companions","create_companion","get_state","claim_control","release_control","lua","action_status","action_cancel","get_events","ack_events","restore_companion","dormant_companion","set_permission");}
    static JsonObject property(String type,String description){return object("type",type,"description",description);}
    static JsonArray catalog() {
        JsonArray tools=new JsonArray();
        for(String name:new TreeSet<>(names())) {
            JsonObject props=new JsonObject();JsonArray required=new JsonArray();
            if(!Set.of("operations","list_companions","create_companion").contains(name)){props.add("companion",property("string","Owned body UUID from list_companions, never a player name."));required.add("companion");}
            if(name.equals("operations"))props.add("group",property("string","Omit to list groups; then query the exact group for signatures and examples."));
            if(name.equals("create_companion")){props.add("name",property("string","Unique ASCII Minecraft name, 1-16 letters, digits or underscore. Survival, no OP."));required.add("name");}
            if(name.equals("claim_control")){props.add("controller_id",property("string","Stable identity for this controller, 1-64 safe characters. Lease lasts 90s, renew by claiming or acting."));required.add("controller_id");}
            if(Set.of("lua","action_cancel","ack_events","restore_companion","dormant_companion","release_control","set_permission").contains(name)){props.add("lease_id",property("string","Secret leaseId returned by claim_control for this body."));required.add("lease_id");}
            if(name.equals("set_permission")){props.add("mode",property("string","Per-body Numen permission: ask (rules/owner approval), bypass (independent survival actions), observe (read-only). No OP is granted."));required.add("mode");}
            if(Set.of("lua","create_companion","action_status","action_cancel").contains(name)){props.add("action_id",property("string","Unique 1-64 character identifier: letters, digits, dot, underscore, hyphen. Reuse only to reconcile the SAME action."));required.add("action_id");}
            if(name.equals("lua")){props.add("code",property("string","Native Numen Lua, <=16384 characters. Use operations to discover SERVER functions. Asynchronous: query action_status until terminal; unknown requires human review."));required.add("code");}
            if(name.equals("get_events"))props.add("after",property("integer","Read events with sequence greater than this cursor, without consuming. Default 0. Max 32 per response."));
            if(name.equals("ack_events")){props.add("through",property("integer","Explicitly acknowledge events through an observed sequence; do not acknowledge unseen events."));required.add("through");}
            String description=switch(name){case "get_state"->"Read actual body health, hunger, absolute position/dimension, full inventory components, open menu and active action, with timestamp.";case "lua"->"Execute native server-side Numen capabilities without an owner Minecraft client. Durable idempotent async action receipt.";case "create_companion"->"Create an owner-bound persistent Numen body. Retry identical action_id to read its result, never create a replacement on uncertainty.";case "get_events"->"Read this body's durable private events; non-consuming, reconnect-safe cursor, explicit dropped count.";case "restore_companion"->"Restore the ORIGINAL body UUID and saved inventory. Refuses unresolved actions or missing saves; never creates replacement.";default->name.replace('_',' ')+" for only the authenticated owner's companions.";};
            tools.add(object("name",name,"description",description,"inputSchema",object("type","object","properties",props,"required",required,"additionalProperties",false)));
        }return tools;
    }
}
