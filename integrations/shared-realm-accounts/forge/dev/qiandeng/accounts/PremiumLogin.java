package dev.qiandeng.accounts;

import com.google.gson.*;
import com.marcp.directauth.DirectAuth;
import com.marcp.directauth.auth.MojangVerifiedConnection;
import com.marcp.directauth.data.UserData;
import net.minecraft.server.level.ServerPlayer;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static dev.qiandeng.accounts.BridgeFiles.text;

/** Native Mojang challenge, with an ephemeral primary-realm identity snapshot.
 * The local database stays offline with an unguessable shadow credential.
 * Neither a username nor a client-supplied UUID is an authentication proof.
 */
final class PremiumLogin {
    private final SharedAccounts owner;private final BridgeFiles bridge;private final Executor worker;private final Path world;
    private final ThreadLocal<Boolean> raw=ThreadLocal.withInitial(()->false);
    private final Map<String,JsonObject> permits=new ConcurrentHashMap<>();
    private final Map<String,CompletableFuture<UserData>> pending=new ConcurrentHashMap<>();
    PremiumLogin(SharedAccounts owner,BridgeFiles bridge,Executor worker,Path world){this.owner=owner;this.bridge=bridge;this.worker=worker;this.world=world;}
    CompletableFuture<UserData> rawLookup(String name){raw.set(true);try{return DirectAuth.getDatabase().getUserAsync(name);}finally{raw.remove();}}
    CompletableFuture<UserData> decorate(String name,CompletableFuture<UserData> original){
        if(raw.get()||!name.matches("[A-Za-z0-9_]{1,16}")||NativeNames.system(name))return original;
        return original.thenCompose(user->{
            JsonObject member=owner.memberForName(name);
            if(user!=null&&member==null)return CompletableFuture.completedFuture(user); // Existing independent account needs its original proof first.
            CompletableFuture<UserData> active=pending.get(name);if(active!=null)return active;
            CompletableFuture<UserData> created=new CompletableFuture<>();active=pending.putIfAbsent(name,created);if(active!=null)return active;
            CompletableFuture.runAsync(()->{try{created.complete(resolve(name,user,member));}catch(Throwable failure){created.completeExceptionally(failure);}finally{pending.remove(name,created);}},worker);
            return created;
        });
    }
    private UserData resolve(String name,UserData user,JsonObject member) throws Exception {
        JsonObject role=member!=null?member:bridge.role(name);
        if(role==null||!name.equals(text(role,member!=null?"primaryName":"name"))){permits.remove(name);return user;}
        String primaryId=text(role,member!=null?"primaryUuid":"uuid");UUID.fromString(primaryId);
        UUID offline=UUID.nameUUIDFromBytes(("OfflinePlayer:"+name).getBytes(StandardCharsets.UTF_8));
        String bodyId=user!=null&&user.getAccountUUID()!=null?user.getAccountUUID():member!=null?text(member,"bodyUuid"):offline.toString();
        if(user==null&&member==null){
            Path data=world.resolve("playerdata").resolve(bodyId+".dat"),marker=bridge.root.resolve("unregistered").resolve(bodyId+".json");
            if(Files.exists(data)){
                if(!Files.exists(marker))return null;
                JsonObject pristine=bridge.read(marker,"unregistered:"+bodyId);
                if(!bodyId.equals(text(pristine,"bodyUuid"))||!name.equals(text(pristine,"bodyName")))return null;
            }else bodyId=primaryId;
        }
        JsonObject request=new JsonObject();request.addProperty("requestId",UUID.randomUUID().toString());request.addProperty("operation","identity");
        request.addProperty("primaryName",name);request.addProperty("primaryUuid",primaryId);request.addProperty("bodyName",name);request.addProperty("bodyUuid",bodyId);
        JsonObject identity=bridge.request(request);
        if(!text(identity,"state").equals("succeeded"))throw new IllegalStateException("PRIMARY_IDENTITY_UNAVAILABLE");
        String premium=text(identity,"premiumUuid");
        if(premium.isEmpty()||identity.get("totpRequired").getAsBoolean()){
            permits.remove(name);
            if(user==null)return null;
            UserData copy=new UserData(name,user.getPasswordHash());copy.setPlayerUUID(bodyId);return copy;
        }
        UUID.fromString(premium);
        JsonObject binding=new JsonObject();for(String field:List.of("primaryName","primaryUuid","bodyName","bodyUuid"))binding.addProperty(field,text(identity,field));
        binding.addProperty("bindMethod","primary-mojang-identity");binding.addProperty("premiumVerified",false);binding.addProperty("provisionedAt",System.currentTimeMillis());
        owner.provisionPremiumMember(binding);
        if(user==null){
            String password=UUID.randomUUID().toString()+UUID.randomUUID();
            String hash=DirectAuth.getLoginManager().hashPasswordAsync(password).get(10,TimeUnit.SECONDS);
            var registered=DirectAuth.getDatabase().registerUserAsync(name,hash,null,1).get(10,TimeUnit.SECONDS);
            if(!registered.toString().equals("OK"))throw new IllegalStateException("NATIVE_PREMIUM_PROVISION_UNKNOWN");
            if(!DirectAuth.getDatabase().setOnlineModeAsync(name,false,null,bodyId).get(10,TimeUnit.SECONDS))throw new IllegalStateException("NATIVE_PREMIUM_PROVISION_UNKNOWN");
            user=rawLookup(name).get(10,TimeUnit.SECONDS);
            if(user==null)throw new IllegalStateException("NATIVE_PREMIUM_PROVISION_UNKNOWN");
        }
        if(user.getAccountUUID()!=null&&!bodyId.equals(user.getAccountUUID()))throw new IllegalStateException("PREMIUM_BODY_IDENTITY_CHANGED");
        permits.put(name,identity.deepCopy());
        UserData copy=new UserData(name,user.getPasswordHash());copy.setPremium(true);copy.setOnlineUUID(premium);copy.setPlayerUUID(bodyId);return copy;
    }
    boolean authorize(ServerPlayer player){
        JsonObject permit=permits.get(player.getGameProfile().getName());
        UUID verified=player.connection.connection instanceof MojangVerifiedConnection proof?proof.directAuth$getMojangUUID():null;
        if(!matches(permit,player.getGameProfile().getName(),player.getUUID(),verified,System.currentTimeMillis()))return false;
        owner.notePremiumVerified(player.getUUID());return true;
    }
    static boolean matches(JsonObject permit,String name,UUID bodyId,UUID verified,long now){
        return PremiumProof.matches(permit,name,bodyId,verified,now);
    }
    private static final class NativeNames {static boolean system(String name){String n=name.toLowerCase(Locale.ROOT);return Set.of("corti","corticam","player","goddess","live").contains(n)||n.endsWith("eye");}}
}
