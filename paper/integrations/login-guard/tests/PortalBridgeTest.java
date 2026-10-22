package org.afuhome.auth;

import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Isolated IPC/policy tests. No production database or player connection. */
public final class PortalBridgeTest {
    static int checks;
    static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
    static final class Accounts implements PortalBridge.Accounts {
        int creates,changes; boolean ready=true; boolean failAfterWrite;
        final Map<String,PortalBridge.Identity> users=new HashMap<>();
        public boolean ready(){return ready;}
        public boolean reserved(String name){return Set.of("goddess","corti","player","corticam","live").contains(name.toLowerCase(Locale.ROOT));}
        public PortalBridge.Identity find(String name){return users.get(name.toLowerCase(Locale.ROOT));}
        public PortalBridge.Identity create(String name,String password,long createdAt) throws Exception {
            if(find(name)!=null)throw new PortalBridge.Problem("ACCOUNT_EXISTS","already exists");
            creates++;var result=new PortalBridge.Identity(name,UUID.nameUUIDFromBytes(("OfflinePlayer:"+name).getBytes(StandardCharsets.UTF_8)));users.put(name.toLowerCase(Locale.ROOT),result);
            if(failAfterWrite)throw new IllegalStateException("simulated unknown");return result;
        }
        public PortalBridge.Identity password(String name,UUID uuid,String oldPassword,String newPassword){changes++;return find(name);}
    }
    static JsonObject request(String id,String operation,String name){
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("requestId",id);out.addProperty("operation",operation);out.addProperty("username",name);
        out.addProperty("createdAt",System.currentTimeMillis());out.addProperty("expiresAt",System.currentTimeMillis()+120000);out.addProperty("password","isolated-test-password");return out;
    }
    static void submit(PortalBridge bridge,Path root,String id,JsonObject value) throws Exception {Files.writeString(root.resolve("requests").resolve(id+".json"),bridge.seal("request:"+id,value));bridge.scan();}
    static JsonObject result(PortalBridge bridge,Path root,String id) throws Exception {return bridge.unseal("result:"+id,Files.readString(root.resolve("results").resolve(id+".json")));}
    public static void main(String[] args) throws Exception {
        Path root=Files.createTempDirectory("portal-bridge-unit-").toAbsolutePath();byte[] key=new byte[32];Arrays.fill(key,(byte)7);Accounts accounts=new Accounts();
        try(PortalBridge bridge=new PortalBridge(root,key,accounts)) {
            JsonObject example=new JsonObject();example.addProperty("password","never-written-as-plaintext");String sealed=bridge.seal("test",example);
            check(!sealed.contains("never-written-as-plaintext"),"password encrypted on disk");check(bridge.unseal("test",sealed).equals(example),"AES-GCM roundtrip");
            boolean rejected=false;try{bridge.unseal("other-request",sealed);}catch(Exception expected){rejected=true;}check(rejected,"AAD binds message identity");
            String id=UUID.randomUUID().toString();var created=request(id,"create","ag_PortalUnit");submit(bridge,root,id,created);
            check(result(bridge,root,id).get("state").getAsString().equals("succeeded"),"create receipt");check(accounts.creates==1,"single create");
            submit(bridge,root,id,created);check(accounts.creates==1,"idempotent duplicate");
            for(String name:List.of("Goddess","live","ag_Name_eye")){
                String denied=UUID.randomUUID().toString();submit(bridge,root,denied,request(denied,"create",name));check(result(bridge,root,denied).get("state").getAsString().equals("failed"),"reserved identity denied");
            }
            String weak=UUID.randomUUID().toString();var weakRequest=request(weak,"create","ag_Weak");weakRequest.addProperty("password","123456");submit(bridge,root,weak,weakRequest);
            check(result(bridge,root,weak).get("reason").getAsString().equals("PASSWORD_WEAK"),"weak default password denied");
            String expired=UUID.randomUUID().toString();var old=request(expired,"create","ag_Old");old.addProperty("expiresAt",1);submit(bridge,root,expired,old);
            check(result(bridge,root,expired).get("state").getAsString().equals("failed"),"expired request denied");
            accounts.failAfterWrite=true;String unknown=UUID.randomUUID().toString();var unknownRequest=request(unknown,"create","ag_Unknown");submit(bridge,root,unknown,unknownRequest);
            check(result(bridge,root,unknown).get("state").getAsString().equals("unknown"),"ambiguous result remains unknown");int count=accounts.creates;
            submit(bridge,root,unknown,unknownRequest);check(accounts.creates==count,"unknown mutation never replayed");accounts.failAfterWrite=false;
            String claim=UUID.randomUUID().toString(),code="a".repeat(48);var claimRequest=request(claim,"claim","ag_PortalUnit");var identity=accounts.find("ag_PortalUnit");
            claimRequest.addProperty("playerUuid",identity.uuid().toString());claimRequest.addProperty("code",code);submit(bridge,root,claim,claimRequest);
            check(result(bridge,root,claim).get("state").getAsString().equals("waiting"),"claim waits for game proof");
            CountDownLatch denied=new CountDownLatch(1);bridge.confirm(claim,code,identity.name(),identity.uuid(),()->false,message->denied.countDown());check(denied.await(3,TimeUnit.SECONDS),"weak/unverified game session rejected");
            check(result(bridge,root,claim).get("state").getAsString().equals("waiting"),"no ownership from failed proof");
            CountDownLatch accepted=new CountDownLatch(1);bridge.confirm(claim,code,identity.name(),identity.uuid(),()->true,message->accepted.countDown());check(accepted.await(3,TimeUnit.SECONDS),"confirmed game session completes");
            check(result(bridge,root,claim).get("state").getAsString().equals("succeeded"),"claim succeeded");
            check(!Files.readString(root.resolve("results").resolve(claim+".json")).contains(identity.uuid().toString()),"private result encrypted");
            check(!Files.exists(root.resolve("requests").resolve(claim+".json")),"consumed encrypted request removed");
            accounts.ready=false;bridge.scan();check(!bridge.unseal("heartbeat",Files.readString(root.resolve("heartbeat.json"))).get("ready").getAsBoolean(),"readiness fails closed");
        } finally {try(var walk=Files.walk(root)){for(Path file:walk.sorted(Comparator.reverseOrder()).toList())Files.delete(file);}}
        System.out.println("PASS "+checks+" portal IPC and ownership checks (isolated account adapter)");
    }
}
