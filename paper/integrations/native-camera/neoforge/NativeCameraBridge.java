package org.qiandeng.camera.bridge;

import com.google.gson.*;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.security.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import org.agentmc.bridge.ControlLedger;

/** Dedicated camera transport: existing RPC/lease/scene contracts, no gameplay controller. */
public final class NativeCameraBridge {
    public static final String MINECRAFT_VERSION="1.21.1";
    private static final String PROTOCOL="agent-mc-java/v1";
    private static NativeCameraBridge instance;
    private final Minecraft client=Minecraft.getInstance();
    private final Gson gson=new Gson();
    private final ControlLedger ledger;
    private final VisualExport visual;
    private Object connection;
    public static boolean hasController(){return instance!=null&&instance.ledger.active(System.currentTimeMillis());}
    public static void start(){if(instance!=null)throw new IllegalStateException("Camera bridge already started");try{instance=new NativeCameraBridge();}catch(Exception e){throw new IllegalStateException("Camera bridge initialization failed",e);}}
    private NativeCameraBridge() throws Exception {
        Path directory=FMLPaths.GAMEDIR.get().resolve("agent-mc-bridge");
        ledger=new ControlLedger(directory.resolve("actions"));visual=new VisualExport(client);
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        byte[] secret=new byte[32];new SecureRandom().nextBytes(secret);String token=HexFormat.of().formatHex(secret);
        server.createContext("/v1/rpc",exchange->{
            try{
                String supplied=exchange.getRequestHeaders().getFirst("Authorization");
                if(!"POST".equals(exchange.getRequestMethod())||supplied==null||!MessageDigest.isEqual(supplied.getBytes(StandardCharsets.UTF_8),("Bearer "+token).getBytes(StandardCharsets.UTF_8))){exchange.sendResponseHeaders(403,-1);return;}
                byte[] body=exchange.getRequestBody().readNBytes(262145);
                if(body.length>262144)throw new IllegalArgumentException("Request too large");
                JsonObject request=JsonParser.parseString(new String(body,StandardCharsets.UTF_8)).getAsJsonObject();
                if(!PROTOCOL.equals(text(request,"protocol")))throw new IllegalArgumentException("Unsupported protocol");
                CompletableFuture<JsonObject> future=new CompletableFuture<>();long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
                client.execute(()->{if(System.nanoTime()>=deadline){future.completeExceptionally(new TimeoutException());return;}try{future.complete(rpc(text(request,"method"),object(request,"params")));}catch(Exception e){future.completeExceptionally(e);}});
                byte[] data=gson.toJson(future.get(5,TimeUnit.SECONDS)).getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,data.length);exchange.getResponseBody().write(data);
            }catch(Exception e){
                // Never return an exception containing a submitted login credential.
                byte[] data="{\"error\":\"CAMERA_OPERATION_REJECTED\"}".getBytes(StandardCharsets.UTF_8);
                try{exchange.sendResponseHeaders(409,data.length);exchange.getResponseBody().write(data);}catch(Exception ignored){}
            }finally{exchange.close();}
        });
        server.setExecutor(Executors.newFixedThreadPool(4,r->{Thread t=new Thread(r,"native-camera-rpc");t.setDaemon(true);return t;}));server.start();
        JsonObject info=new JsonObject();info.addProperty("protocol",PROTOCOL);info.addProperty("endpoint","http://127.0.0.1:"+server.getAddress().getPort());info.addProperty("token",token);
        info.addProperty("instanceId",UUID.randomUUID().toString());info.addProperty("minecraftVersion",MINECRAFT_VERSION);info.addProperty("createdAt",Instant.now().toString());
        Path file=directory.resolve("connection.json");Files.writeString(file,gson.toJson(info));restrict(file);
        Runtime.getRuntime().addShutdownHook(new Thread(()->server.stop(0)));
        NeoForge.EVENT_BUS.addListener((ClientTickEvent.Pre event)->refresh());
    }
    private void refresh(){Object next=client.getConnection();if(next!=connection){connection=next;ledger.release();}}
    private static String text(JsonObject value,String key){return value.has(key)&&!value.get(key).isJsonNull()?value.get(key).getAsString():"";}
    private static JsonObject object(JsonObject value,String key){return value.has(key)?value.getAsJsonObject(key):new JsonObject();}
    private static int number(JsonObject value,String key,int fallback){return value.has(key)?value.get(key).getAsInt():fallback;}
    private JsonObject state(){
        JsonObject out=new JsonObject();out.addProperty("protocol",PROTOCOL);out.addProperty("minecraftVersion",MINECRAFT_VERSION);
        out.addProperty("uuid",client.player==null?null:client.player.getUUID().toString());out.addProperty("server",client.getCurrentServer()==null?"":client.getCurrentServer().ip);
        out.addProperty("controllerId",ledger.owner(System.currentTimeMillis()));out.addProperty("screen",client.screen==null?null:client.screen.getClass().getSimpleName());
        out.addProperty("connected",client.player!=null&&client.level!=null);return out;
    }
    private void identity(JsonObject params){
        JsonObject actual=state();
        if(client.player==null||client.level==null||text(params,"expectedUuid").isEmpty()||!text(params,"expectedUuid").equals(text(actual,"uuid"))||!text(params,"expectedServer").equals(text(actual,"server")))throw new IllegalStateException("Camera identity changed");
    }
    private void proof(JsonObject params){ledger.require(text(params,"controllerId"),text(params,"nonce"),System.currentTimeMillis());}
    private JsonObject rpc(String method,JsonObject params) throws Exception {
        refresh();long now=System.currentTimeMillis();
        if(method.equals("state"))return state();
        if(method.equals("result")){var action=ledger.get(text(params,"action_id"));if(action==null)throw new IllegalArgumentException("Unknown receipt");return gson.toJsonTree(action).getAsJsonObject();}
        identity(params);
        switch(method){
            case "claim":return ledger.claim(text(params,"controllerId"),number(params,"ttlMs",10000),now);
            case "renew":return ledger.renew(text(params,"controllerId"),text(params,"nonce"),number(params,"ttlMs",10000),now);
            case "release":proof(params);ledger.release();return state();
            case "do":{
                proof(params);JsonObject input=object(params,"input");String value=text(input,"text");
                // Only the resident service's login helper may submit a command.
                if(!text(params,"controllerId").startsWith("native-camera-private-login-")||!text(params,"operation").equals("chat")||!value.matches("/login [^\\s\\p{Cntrl}]{1,128}"))throw new IllegalArgumentException("Camera accepts private login only");
                String id=text(params,"action_id");var old=ledger.get(id);var action=ledger.admit(id,"chat",input,now);
                if(old!=null)return gson.toJsonTree(action).getAsJsonObject();
                action.phase="running";ledger.save(action);
                client.getConnection().sendCommand(value.substring(1));
                ledger.finish(action,"partial","Login sent; require server authorization receipt",new JsonObject(),System.currentTimeMillis());
                return gson.toJsonTree(action).getAsJsonObject();
            }
            case "screenshot":{
                if(hasController()||client.screen!=null)throw new IllegalStateException("Camera is busy");
                JsonObject out=new JsonObject();try(var image=Screenshot.takeScreenshot(client.getMainRenderTarget())){out.addProperty("mime","image/png");out.addProperty("base64",Base64.getEncoder().encodeToString(image.asByteArray()));}
                out.add("state",state());return out;
            }
            case "visual_frame":return visual.frame(number(params,"radius",2));
            case "visual_registry":return visual.registry();
            case "visual_chunk":return visual.chunk(number(params,"x",Integer.MAX_VALUE),number(params,"z",Integer.MAX_VALUE),text(params,"epoch"));
            default:throw new IllegalArgumentException("Unsupported camera operation");
        }
    }
    private static void restrict(Path file) throws Exception {
        var posix=Files.getFileAttributeView(file,PosixFileAttributeView.class);
        if(posix!=null){Files.setPosixFilePermissions(file,PosixFilePermissions.fromString("rw-------"));return;}
        var acl=Files.getFileAttributeView(file,AclFileAttributeView.class);
        if(acl!=null)acl.setAcl(List.of(AclEntry.newBuilder().setType(AclEntryType.ALLOW).setPrincipal(Files.getOwner(file)).setPermissions(EnumSet.allOf(AclEntryPermission.class)).build()));
    }
}
