package org.afuhome.auth;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Optional encrypted local IPC. No public listener, plaintext password files,
 * generic commands or direct database writes from the website. Mutations have
 * a durable unknown receipt before execution and are never replayed on restart. */
final class PortalBridge implements AutoCloseable {
    record Identity(String name, UUID uuid) { }
    interface Accounts {
        boolean ready();
        boolean reserved(String name);
        Identity find(String name) throws Exception;
        Identity create(String name,String password,long createdAt) throws Exception;
        Identity password(String name,UUID uuid,String oldPassword,String newPassword) throws Exception;
        default Identity verify(String name,UUID uuid,String password) throws Exception {throw new Problem("VERIFY_UNSUPPORTED","请先更新原生账号桥");}
    }
    static final class Problem extends Exception {
        final String reason;
        Problem(String reason,String message){super(message);this.reason=reason;}
    }
    private static final Gson JSON=new Gson();
    private final Path root;
    private final Set<UUID> managed=ConcurrentHashMap.newKeySet();
    private final byte[] key;
    private final Accounts accounts;
    private final SecureRandom random=new SecureRandom();
    private final AtomicBoolean scanning=new AtomicBoolean();
    private final ThreadPoolExecutor worker=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(8),r->{Thread t=new Thread(r,"portal-account-bridge");t.setDaemon(true);return t;});
    private volatile boolean closed;
    private volatile String lastFailure="";
    PortalBridge(Path root,byte[] key,Accounts accounts) throws Exception {
        if(key.length!=32||!root.isAbsolute())throw new IllegalArgumentException("portal config");
        this.root=root;this.key=key.clone();this.accounts=accounts;
        Files.createDirectories(root.resolve("requests"));Files.createDirectories(root.resolve("results"));Files.createDirectories(root.resolve("managed"));
        try(var files=Files.list(root.resolve("managed"))){for(Path file:files.filter(p->p.getFileName().toString().matches("[a-f0-9-]{36}\\.json")).limit(20000).toList()){
            String id=file.getFileName().toString().substring(0,36);var value=unseal("managed:"+id,Files.readString(file));
            if(id.equals(string(value,"playerUuid")))managed.add(UUID.fromString(id));else throw new IllegalArgumentException("managed identity");
        }}
        try(var files=Files.list(root.resolve("results"))) {
            for(Path file:files.filter(p->p.getFileName().toString().matches("[a-f0-9-]{36}\\.json")).limit(20000).toList()) {
                String id=file.getFileName().toString().substring(0,36);
                JsonObject previous=readResult(id);
                if(string(previous,"state").equals("running")){previous.addProperty("state","unknown");result(id,previous);}
            }
        }
    }
    static String string(JsonObject o,String key){return o.has(key)&&o.get(key).isJsonPrimitive()?o.get(key).getAsString():"";}
    static boolean agentName(String name){return name.matches("(?i)ag_[a-z0-9_]{1,13}")&&!name.toLowerCase(Locale.ROOT).endsWith("eye");}
    static String sha(String value) throws Exception {return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}
    String seal(String label,JsonObject value) throws Exception {
        byte[] iv=new byte[12];random.nextBytes(iv);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv));
        cipher.updateAAD(("qiandengji:portal:1:"+label).getBytes(StandardCharsets.UTF_8));
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("iv",Base64.getEncoder().encodeToString(iv));
        out.addProperty("data",Base64.getEncoder().encodeToString(cipher.doFinal(JSON.toJson(value).getBytes(StandardCharsets.UTF_8))));return JSON.toJson(out);
    }
    JsonObject unseal(String label,String encoded) throws Exception {
        if(encoded.length()>32768)throw new IllegalArgumentException("portal envelope size");
        JsonObject o=JSON.fromJson(encoded,JsonObject.class);
        byte[] iv=Base64.getDecoder().decode(string(o,"iv")),data=Base64.getDecoder().decode(string(o,"data"));
        if(o.get("schemaVersion").getAsInt()!=1||iv.length!=12||data.length<17||data.length>16384)throw new IllegalArgumentException("portal envelope");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv));
        cipher.updateAAD(("qiandengji:portal:1:"+label).getBytes(StandardCharsets.UTF_8));
        return JSON.fromJson(new String(cipher.doFinal(data),StandardCharsets.UTF_8),JsonObject.class);
    }
    private void write(Path target,String label,JsonObject value) throws Exception {
        Path temp=target.resolveSibling(target.getFileName()+".tmp");
        String encoded=seal(label,value);
        // Windows scanners/readers can briefly hold a file without share-delete.
        // Retry only this atomic receipt write, never the account mutation.
        for(int attempt=0;;attempt++){
            try{
                Files.writeString(temp,encoded,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING);
                Files.move(temp,target,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);return;
            }catch(FileSystemException transientLock){
                if(attempt>=9)throw transientLock;
                Thread.sleep(50);
            }
        }
    }
    private JsonObject readResult(String id) throws Exception {
        Path file=root.resolve("results").resolve(id+".json");
        if(Files.size(file)>32768)throw new IllegalArgumentException("portal result size");
        return unseal("result:"+id,Files.readString(file));
    }
    private void result(String id,JsonObject value) throws Exception {write(root.resolve("results").resolve(id+".json"),"result:"+id,value);}
    void tick() {
        if(closed||!scanning.compareAndSet(false,true))return;
        try {worker.execute(()->{try{scan();}catch(Exception failure){lastFailure=failure.getClass().getSimpleName();/* heartbeat expires; login unchanged */}finally{scanning.set(false);}});}
        catch(RejectedExecutionException ignored){scanning.set(false);}
    }
    void scan() throws Exception {
        JsonObject heartbeat=new JsonObject();heartbeat.addProperty("ready",!closed&&accounts.ready());heartbeat.addProperty("at",System.currentTimeMillis());heartbeat.addProperty("verify",true);if(!lastFailure.isEmpty())heartbeat.addProperty("diagnostic",lastFailure);
        write(root.resolve("heartbeat.json"),"heartbeat",heartbeat);
        if(closed||!accounts.ready())return;
        try(var files=Files.list(root.resolve("requests"))) {
            for(Path file:files.filter(p->p.getFileName().toString().matches("[a-f0-9-]{36}\\.json")).limit(4).toList())process(file);
        }
    }
    private JsonObject receipt(String id,String name,String state) {
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("requestId",id);out.addProperty("username",name);out.addProperty("state",state);return out;
    }
    private void process(Path file) throws Exception {
        String id=file.getFileName().toString().substring(0,36),name="";
        if(!UUID.fromString(id).toString().equals(id)||Files.size(file)>32768)return;
        if(Files.exists(root.resolve("results").resolve(id+".json"))){Files.deleteIfExists(file);return;}
        JsonObject request;
        try {request=unseal("request:"+id,Files.readString(file));}
        catch(Exception invalid){Files.deleteIfExists(file);return;}
        name=string(request,"username");JsonObject out=receipt(id,name,"failed");
        try {
            if(!id.equals(string(request,"requestId")))throw new Problem("REQUEST_ID_MISMATCH","请求标识不匹配");
            if(!name.matches("\\.?[A-Za-z0-9_]{1,16}")||name.toLowerCase(Locale.ROOT).endsWith("eye")||accounts.reserved(name))throw new Problem("RESERVED_ACCOUNT","此身份不能从网站注册或绑定");
            long now=System.currentTimeMillis(),expires=request.get("expiresAt").getAsLong(),created=request.get("createdAt").getAsLong();
            if(expires<now||created>now+1000||expires-created>300000||created>expires)throw new Problem("REQUEST_EXPIRED","请求已过期，请重新发起绑定；未知的创建或改密请先查询");
            String operation=string(request,"operation");Identity identity;
            if(operation.equals("claim")) {
                identity=accounts.find(name);
                if(identity==null||!identity.uuid().toString().equals(string(request,"playerUuid")))throw new Problem("IDENTITY_MISMATCH","原角色 UUID 未核实");
                String code=string(request,"code");if(!code.matches("[a-f0-9]{48}"))throw new Problem("CLAIM_INVALID","绑定凭据无效");
                out=receipt(id,identity.name(),"waiting");out.addProperty("playerUuid",identity.uuid().toString());out.addProperty("codeHash",sha(code));out.addProperty("expiresAt",expires);
                result(id,out);return;
            }
            if(operation.equals("verify")) {
                identity=accounts.verify(name,UUID.fromString(string(request,"playerUuid")),string(request,"currentPassword"));
                markManaged(request,identity);
                out=receipt(id,identity.name(),"succeeded");out.addProperty("playerUuid",identity.uuid().toString());result(id,out);return;
            }
            if(!Set.of("create","password").contains(operation))throw new Problem("OPERATION_UNSUPPORTED","操作不受支持");
            if(operation.equals("password")&&isManaged(UUID.fromString(string(request,"playerUuid")))
                &&(!request.has("sharedCredential")||!request.get("sharedCredential").getAsBoolean()))
                throw new Problem("SHARED_PASSWORD_REQUIRED","此角色使用统一密码，请使用网站世界大厅的统一改密流程");
            String password=string(request,"password");
            if(password.length()<6||password.length()>64||password.matches(".*\\s.*")||Set.of("123456","12345678","password","qwerty").contains(password.toLowerCase(Locale.ROOT)))throw new Problem("PASSWORD_WEAK","请使用至少六位的独立游戏密码");
            // Persist before the first potentially irreversible database call.
            // A crash or ambiguous exception leaves unknown and cannot replay.
            out=receipt(id,name,"running");out.addProperty("message","服务器正在处理，请查询原请求，不要重复提交");result(id,out);
            if(operation.equals("create")) {
                if(!agentName(name))throw new Problem("INVALID_AGENT_NAME","新 Agent 名必须为 ag_ 开头，最多16位");
                identity=accounts.create(name,password,created);
            } else identity=accounts.password(name,UUID.fromString(string(request,"playerUuid")),string(request,"currentPassword"),password);
            markManaged(request,identity);
            out=receipt(id,identity.name(),"succeeded");out.addProperty("playerUuid",identity.uuid().toString());result(id,out);
        } catch(Problem expected) {
            out=receipt(id,name,"failed");out.addProperty("reason",expected.reason);out.addProperty("message",expected.getMessage());result(id,out);
        } catch(Exception unknown) {
            lastFailure=unknown.getClass().getSimpleName();
            // No exception message, password, hash or request contents in logs.
            out=receipt(id,name,"unknown");out.addProperty("message","操作结果尚未确认，请查询原请求或联系服主");result(id,out);
        } finally {Files.deleteIfExists(file);}
    }
    boolean isManaged(UUID uuid){return managed.contains(uuid);}
    private void markManaged(JsonObject request,Identity identity) throws Exception {
        if(!request.has("sharedCredential")||!request.get("sharedCredential").getAsBoolean())return;
        JsonObject marker=new JsonObject();marker.addProperty("playerUuid",identity.uuid().toString());
        write(root.resolve("managed").resolve(identity.uuid()+".json"),"managed:"+identity.uuid(),marker);managed.add(identity.uuid());
    }
    void confirm(String id,String code,String name,UUID uuid,BooleanSupplier currentProof,Consumer<String> reply) {
        if(!id.matches("[a-f0-9-]{36}")||!code.matches("[a-f0-9]{48}")){reply.accept("绑定命令无效，请复制网站上的完整命令。");return;}
        try {worker.execute(()->{
            try {
                Path pending=root.resolve("requests").resolve(id+".json");
                if(!Files.exists(root.resolve("results").resolve(id+".json"))&&Files.exists(pending))process(pending);
                JsonObject row=readResult(id);
                if(!string(row,"state").equals("waiting")||!string(row,"username").equalsIgnoreCase(name)||!string(row,"playerUuid").equals(uuid.toString())
                    ||row.get("expiresAt").getAsLong()<System.currentTimeMillis()||!MessageDigest.isEqual(sha(code).getBytes(StandardCharsets.US_ASCII),string(row,"codeHash").getBytes(StandardCharsets.US_ASCII))) {
                    reply.accept("绑定已过期、已完成或不属于当前角色，请在网站重新核对。");return;
                }
                if(!accounts.ready()||accounts.reserved(name)||!currentProof.getAsBoolean()) {reply.accept("需要本人已认证进入世界；无密码或123456等弱默认密码不能绑定，请先 /register 或 /changepassword 设置自己的密码。");return;}
                JsonObject success=receipt(id,name,"succeeded");success.addProperty("playerUuid",uuid.toString());result(id,success);
                reply.accept("网站绑定已确认，请回到网站刷新。原角色UUID、背包和权限保持不变。");
            }catch(Exception unavailable){reply.accept("网站绑定暂未完成，请先查看网站请求状态，不要重复创建角色。");}
        });}catch(RejectedExecutionException busy){reply.accept("绑定服务暂忙，请稍后使用同一条绑定命令。");}
    }
    public void close(){closed=true;worker.shutdown();try{worker.awaitTermination(5,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}worker.shutdownNow();try{Files.deleteIfExists(root.resolve("heartbeat.json"));}catch(Exception ignored){}Arrays.fill(key,(byte)0);}
}
