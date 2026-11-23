package local.hosting;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import net.minecraft.server.MinecraftServer;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;

/** A separately keyed, explicitly enabled loopback endpoint for the role coordinator. */
final class NativeResidentHandoffPort implements AutoCloseable {
    static final String ENDPOINT="/v1/native-resident-handoff";
    private static NativeResidentHandoffPort current;
    private final SecretKeySpec signingKey;
    private final MinecraftServer game;
    private final NativeResidentSlots slots;
    private final HttpServer http;
    private final ThreadPoolExecutor pool;

    static void start(ServerStartedEvent event) {
        Path config=FMLPaths.CONFIGDIR.get().resolve("native-resident-handoff.json");
        if (!Files.isRegularFile(config)) return;
        try {
            JsonObject cfg=read(config,65536);
            if (cfg.get("enabled").getAsBoolean()) current=new NativeResidentHandoffPort(event.getServer(),cfg);
        } catch (Exception e) {
            org.slf4j.LoggerFactory.getLogger("NativeResidentHandoff").error("Native handoff disabled: {}",e.getClass().getSimpleName());
        }
    }
    static void stop(ServerStoppingEvent event) {
        if (current!=null) current.close();
        current=null;
    }
    NativeResidentHandoffPort(MinecraftServer game, JsonObject cfg) throws Exception {
        this.game=game;
        if (cfg.get("schema").getAsInt()!=1) throw new IllegalArgumentException("Invalid native handoff config");
        int port=cfg.get("port").getAsInt();
        Path path=Path.of(cfg.get("keyFile").getAsString());
        if (port<1024 || port>65535 || !path.isAbsolute() || Files.size(path)!=32) throw new IllegalArgumentException("Invalid private port or key");
        signingKey=new SecretKeySpec(Files.readAllBytes(path),"HmacSHA256");
        slots=new NativeResidentSlots(game,cfg.getAsJsonArray("roles"));
        http=HttpServer.create(new InetSocketAddress("127.0.0.1",port),8);
        pool=new ThreadPoolExecutor(2,2,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(12),r->{
            var t=new Thread(r,"native-resident-handoff"); t.setDaemon(true); return t;
        });
        http.setExecutor(pool);
        http.createContext(ENDPOINT,this::receive);
        http.start();
    }
    static JsonObject read(Path path,int limit) throws IOException {
        if (!Files.isRegularFile(path,java.nio.file.LinkOption.NOFOLLOW_LINKS) || Files.size(path)>limit)
            throw new IOException("Expected bounded regular file");
        return JsonParser.parseString(Files.readString(path)).getAsJsonObject();
    }
    private void receive(HttpExchange e) throws IOException {
        try (e) {
            if (!"POST".equals(e.getRequestMethod()) || !ENDPOINT.equals(e.getRequestURI().toASCIIString())) { reply(e,404,new JsonObject()); return; }
            if (!e.getRemoteAddress().getAddress().isLoopbackAddress()) { reply(e,403,new JsonObject()); return; }
            byte[] input=e.getRequestBody().readNBytes(8193);
            if (input.length>8192) { reply(e,413,new JsonObject()); return; }
            JsonObject request;
            long expires;
            try {
                var env=JsonParser.parseString(new String(input,StandardCharsets.UTF_8)).getAsJsonObject();
                if (!env.keySet().equals(Set.of("payload","signature"))) throw new IllegalArgumentException();
                String payload=env.get("payload").getAsString();
                var mac=Mac.getInstance("HmacSHA256"); mac.init(signingKey);
                if (!MessageDigest.isEqual(mac.doFinal(payload.getBytes(StandardCharsets.US_ASCII)),Base64.getUrlDecoder().decode(env.get("signature").getAsString())))
                    throw new IllegalArgumentException();
                request=JsonParser.parseString(new String(Base64.getUrlDecoder().decode(payload),StandardCharsets.UTF_8)).getAsJsonObject();
                expires=request.remove("expires").getAsLong();
                long now=System.currentTimeMillis();
                if (expires<now || expires>now+50_000) throw new IllegalArgumentException();
            } catch (Exception invalid) { reply(e,401,new JsonObject());return; }
            try {
                var future=game.submit(()-> {
                    if (System.currentTimeMillis()>expires) throw new SecurityException("Expired");
                    try {return slots.handle(request);}
                    catch (Exception failure) {throw new java.util.concurrent.CompletionException(failure);}
                });
                reply(e,200,future.get(42,TimeUnit.SECONDS));
            } catch (Exception unavailable) {
                // The game-thread operation can outlive a disconnected HTTP caller.
                reply(e,503,new JsonObject());
            }
        }
    }
    private static void reply(HttpExchange e,int status,JsonObject json) throws IOException {
        byte[] bytes=json.toString().getBytes(StandardCharsets.UTF_8);
        e.getResponseHeaders().set("Content-Type","application/json; charset=utf-8");
        e.getResponseHeaders().set("Cache-Control","no-store");
        e.sendResponseHeaders(status,bytes.length);
        e.getResponseBody().write(bytes);
    }
    public void close() { http.stop(0); pool.shutdownNow(); }
}
