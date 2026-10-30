package dev.qiandeng.accounts;

import com.google.gson.*;
import com.google.inject.Inject;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.proxy.*;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.plugin.Dependency;
import com.velocitypowered.api.proxy.*;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import java.lang.reflect.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import xyz.kyngs.librelogin.api.LibreLoginPlugin;
import xyz.kyngs.librelogin.api.provider.LibreLoginProvider;
import org.slf4j.Logger;
import static dev.qiandeng.accounts.BridgeFiles.text;

/** The primary realm owns the credential. Other realms never copy its hash. */
@Plugin(id="realm-accounts",name="Shared Realm Accounts",version="0.1.0",dependencies={@Dependency(id="login-guard"),@Dependency(id="librelogin")})
public final class RealmAuthority {
    private final ProxyServer proxy;private final Logger log;
    private final ExecutorService worker=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"realm-account-authority");t.setDaemon(true);return t;});
    private final AtomicBoolean scanning=new AtomicBoolean();
    private BridgeFiles bridge;private LibreLoginPlugin<Player,RegisteredServer> libre;private Object guard;
    private Field guardReady;private Method reserved,password;
    private final Map<UUID,long[]> failures=new HashMap<>();
    private volatile boolean closed;
    private long lastHeartbeat,lastWarning;
    @Inject public RealmAuthority(ProxyServer proxy,Logger log){this.proxy=proxy;this.log=log;}
    @Subscribe public void start(ProxyInitializeEvent event) throws Exception {
        Path cfg=Path.of("plugins/realm-accounts/config.properties").toAbsolutePath();
        Properties p=new Properties();try(var in=Files.newInputStream(cfg)){p.load(in);}
        if(!p.getProperty("enabled","false").equals("true"))return;
        guard=proxy.getPluginManager().getPlugin("login-guard").flatMap(x->x.getInstance()).orElseThrow();
        guardReady=guard.getClass().getDeclaredField("ready");guardReady.setAccessible(true);
        reserved=guard.getClass().getDeclaredMethod("portalReserved",String.class);reserved.setAccessible(true);
        password=guard.getClass().getDeclaredMethod("portalPassword",String.class,UUID.class,String.class,String.class);password.setAccessible(true);
        Object provider=proxy.getPluginManager().getPlugin("librelogin").flatMap(x->x.getInstance()).orElseThrow();
        libre=((LibreLoginProvider<Player,RegisteredServer>)provider).getLibreLogin();
        bridge=new BridgeFiles(Path.of(p.getProperty("directory")),Path.of(p.getProperty("keyFile")),p.getProperty("realmId"));
        // A previously accepted mutation is never run again after a crash.
        try(var list=Files.list(bridge.root.resolve("results"))){for(Path f:list.filter(x->x.getFileName().toString().matches("[a-f0-9-]{36}\\.json")).toList()){
            String id=f.getFileName().toString().substring(0,36);JsonObject r=bridge.read(f,"result:"+id);
            if(text(r,"state").equals("running")){r.addProperty("state","unknown");r.addProperty("reason","AUTHORITY_RESTARTED");bridge.write(f,"result:"+id,r,false);}
        }}
        proxy.getScheduler().buildTask(this,()->{if(scanning.compareAndSet(false,true))worker.execute(()->{try{scan();}catch(Exception error){long now=System.currentTimeMillis();if(now-lastWarning>5000){lastWarning=now;log.warn("Shared account authority unavailable: {}",error.getClass().getSimpleName());}}finally{scanning.set(false);}});}).repeat(Duration.ofMillis(100)).schedule();
        log.info("Shared account authority ready; encrypted local IPC only.");
    }
    private boolean ready() throws Exception{return !closed&&guardReady.getBoolean(guard)&&libre.getDatabaseProvider()!=null;}
    private void scan() throws Exception {
        if(bridge==null||closed)return;
        long now=System.currentTimeMillis();if(now-lastHeartbeat>=1000){JsonObject heartbeat=new JsonObject();heartbeat.addProperty("ready",ready());heartbeat.addProperty("at",now);bridge.write(bridge.root.resolve("authority-heartbeat.json"),"authority-heartbeat",heartbeat,false);lastHeartbeat=now;}
        if(!ready())return;
        try(var files=Files.list(bridge.root.resolve("requests"))){for(Path file:files.filter(x->x.getFileName().toString().matches("[a-f0-9-]{36}\\.json")).limit(4).toList())process(file);}
    }
    private void process(Path file) throws Exception {
        String id=file.getFileName().toString().substring(0,36);if(!UUID.fromString(id).toString().equals(id))return;
        JsonObject request=bridge.read(file,"request:"+id);Path resultFile=bridge.root.resolve("results").resolve(id+".json");
        if(Files.exists(resultFile)){Files.delete(file);return;}
        JsonObject result;
        try {
            if(!id.equals(text(request,"requestId"))||!"sao".equals(text(request,"realmId")))throw new Problem("IDENTITY_MISMATCH");
            long now=System.currentTimeMillis(),created=request.get("createdAt").getAsLong(),expires=request.get("expiresAt").getAsLong();
            if(created>now+1000||expires<now||expires-created>20000)throw new Problem("REQUEST_EXPIRED");
            String name=text(request,"primaryName"),operation=text(request,"operation");
            UUID uuid=UUID.fromString(text(request,"primaryUuid"));UUID.fromString(text(request,"bodyUuid"));
            Path memberFile=bridge.root.resolve("members").resolve(text(request,"bodyUuid")+".json");boolean linked=false;
            if(Files.exists(memberFile)){
                JsonObject member=bridge.read(memberFile,"member:"+text(request,"bodyUuid"));
                linked=List.of("primaryName","primaryUuid","bodyName","bodyUuid").stream().allMatch(field->text(member,field).equals(text(request,field)));
                if(!linked)throw new Problem("MEMBERSHIP_IDENTITY_MISMATCH");
            }
            // An established binding is durable. Website outages block new
            // enrollment, while existing bodies still prove the current native
            // password, UUID, registration, reserved-role and TOTP policy.
            if(!linked){JsonObject role=bridge.role(name);
                if(role==null||!name.equals(text(role,"name"))||!uuid.toString().equals(text(role,"uuid")))throw new Problem("WEBSITE_ROLE_REQUIRED");}
            if((boolean)reserved.invoke(guard,name))throw new Problem("RESERVED_ACCOUNT");
            if(!Set.of("verify","password").contains(operation))throw new Problem("OPERATION_UNSUPPORTED");
            var user=libre.getDatabaseProvider().getByName(name);
            if(user==null||!user.getUuid().equals(uuid)||!user.getLastNickname().equals(name)||!user.isRegistered())throw new Problem("IDENTITY_MISMATCH");
            if(user.getSecret()!=null)throw new Problem("TOTP_IN_PRIMARY_REALM");
            long[] counter=failures.computeIfAbsent(uuid,k->new long[]{now,0});if(now-counter[0]>300000){counter[0]=now;counter[1]=0;}
            if(counter[1]>=3)throw new Problem("PASSWORD_BLOCKED");
            String supplied=text(request,"password");
            if(supplied.isEmpty()||supplied.length()>128||!libre.getCryptoProvider(user.getHashedPassword().algo()).matches(supplied,user.getHashedPassword())){counter[1]++;throw new Problem("PASSWORD_INCORRECT");}
            var current=libre.getDatabaseProvider().getByName(name);
            if(current==null||!current.getUuid().equals(uuid)||!current.getHashedPassword().equals(user.getHashedPassword()))throw new Problem("PASSWORD_CHANGED");
            counter[1]=0;
            if(operation.equals("password")){
                String next=text(request,"newPassword");
                if(next.length()<6||next.length()>64||next.matches(".*\\s.*")||Set.of("123456","12345678","password","qwerty").contains(next.toLowerCase(Locale.ROOT)))throw new Problem("PASSWORD_WEAK");
                bridge.write(resultFile,"result:"+id,bridge.result(request,"running","ACCEPTED"),false);
                // Use the existing native writer, including its policy, lock and recheck.
                try{password.invoke(guard,name,uuid,supplied,next);}catch(InvocationTargetException error){throw new Problem(nativeReason(error.getCause()));}
            }
            result=bridge.result(request,"succeeded",operation.equals("password")?"PASSWORD_CHANGED":"VERIFIED");
        } catch(Problem error){result=bridge.result(request,error.reason.equals("AUTH_RESULT_UNKNOWN")?"unknown":"failed",error.reason);}
        catch(Exception error){result=bridge.result(request,"unknown",Files.exists(resultFile)?"AUTH_RESULT_UNKNOWN":"AUTHORITY_UNAVAILABLE");}
        bridge.write(resultFile,"result:"+id,result,false);Files.delete(file);
    }
    private static String nativeReason(Throwable cause){try{Field f=cause.getClass().getDeclaredField("reason");f.setAccessible(true);return (String)f.get(cause);}catch(Exception e){return "AUTH_RESULT_UNKNOWN";}}
    private static final class Problem extends Exception{final String reason;Problem(String reason){this.reason=reason;}}
    @Subscribe public void stop(ProxyShutdownEvent event){closed=true;worker.shutdown();try{worker.awaitTermination(5,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}worker.shutdownNow();}
}
