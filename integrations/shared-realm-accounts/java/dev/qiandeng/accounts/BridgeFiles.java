package dev.qiandeng.accounts;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;

/** Private local IPC; authenticated envelopes and durable request IDs, no listener. */
public final class BridgeFiles {
    public static final Gson JSON=new Gson();
    public final Path root;
    private final byte[] key;
    private final String realm;
    public BridgeFiles(Path root,Path keyFile,String realm) throws Exception {
        if(!root.isAbsolute()||!realm.matches("[a-z][a-z0-9_-]{0,31}"))throw new IllegalArgumentException("bridge config");
        String encoded=Files.readString(keyFile).trim();
        if(!encoded.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("bridge key");
        this.root=root;this.realm=realm;this.key=HexFormat.of().parseHex(encoded);
        Files.createDirectories(root.resolve("requests"));Files.createDirectories(root.resolve("results"));Files.createDirectories(root.resolve("members"));
    }
    public String seal(String label,JsonObject value) throws Exception {
        byte[] iv=new byte[12];new SecureRandom().nextBytes(iv);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv));
        cipher.updateAAD(aad(label));JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);
        out.addProperty("iv",Base64.getEncoder().encodeToString(iv));
        out.addProperty("data",Base64.getEncoder().encodeToString(cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8))));return out.toString();
    }
    private byte[] aad(String label){return ("maw:shared-accounts:1:"+realm+":"+label).getBytes(StandardCharsets.UTF_8);}
    public JsonObject unseal(String label,String encoded) throws Exception {
        if(encoded.length()>65536)throw new IllegalArgumentException("envelope size");
        JsonObject in=JsonParser.parseString(encoded).getAsJsonObject();
        byte[] iv=Base64.getDecoder().decode(in.get("iv").getAsString()),data=Base64.getDecoder().decode(in.get("data").getAsString());
        if(in.get("schemaVersion").getAsInt()!=1||iv.length!=12||data.length>49152||data.length<17)throw new IllegalArgumentException("envelope");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv));cipher.updateAAD(aad(label));
        return JsonParser.parseString(new String(cipher.doFinal(data),StandardCharsets.UTF_8)).getAsJsonObject();
    }
    public JsonObject read(Path file,String label) throws Exception {
        if(Files.size(file)>65536)throw new IllegalArgumentException("file size");return unseal(label,Files.readString(file));
    }
    public void write(Path file,String label,JsonObject value,boolean exclusive) throws Exception {
        String encoded=seal(label,value);Path temporary=file.resolveSibling(file.getFileName()+"."+UUID.randomUUID()+".tmp");
        try {
            Files.writeString(temporary,encoded,StandardOpenOption.CREATE_NEW);
            try(var channel=java.nio.channels.FileChannel.open(temporary,StandardOpenOption.WRITE)){channel.force(true);}
            // A CREATE_NEW hard link is the publication point for an immutable request.
            if(exclusive){Files.createLink(file,temporary);return;}
            for(int i=0;;i++)try{Files.move(temporary,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);break;}
            catch(FileSystemException busy){if(i>=9)throw busy;Thread.sleep(50);}
        } finally {Files.deleteIfExists(temporary);}
    }
    public String fingerprint(JsonObject request) throws Exception {
        Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(key,"HmacSHA256"));
        return HexFormat.of().formatHex(mac.doFinal(request.toString().getBytes(StandardCharsets.UTF_8)));
    }
    public JsonObject roles() throws Exception {
        JsonObject result=read(root.resolve("roles.json"),"roles");long now=System.currentTimeMillis();
        if(!realm.equals(text(result,"realmId"))||result.get("observedAt").getAsLong()>now+1000||result.get("expiresAt").getAsLong()<now
            ||result.get("expiresAt").getAsLong()-result.get("observedAt").getAsLong()>60000)throw new IllegalStateException("OWNERSHIP_FEED_UNAVAILABLE");
        return result;
    }
    public JsonObject role(String name) throws Exception {
        for(JsonElement element:roles().getAsJsonArray("roles")){
            JsonObject row=element.getAsJsonObject();if(text(row,"name").equalsIgnoreCase(name))return row;
        }return null;
    }
    public JsonObject request(JsonObject request) throws Exception {
        String id=text(request,"requestId");UUID.fromString(id);
        request.addProperty("schemaVersion",1);request.addProperty("realmId",realm);request.addProperty("createdAt",System.currentTimeMillis());request.addProperty("expiresAt",System.currentTimeMillis()+15000);
        Path file=root.resolve("requests").resolve(id+".json");write(file,"request:"+id,request,true);
        return await(request,16000);
    }
    public JsonObject await(JsonObject request,long timeout) throws Exception {
        String id=text(request,"requestId");long until=System.currentTimeMillis()+timeout;
        do {
            Path file=root.resolve("results").resolve(id+".json");
            if(Files.exists(file)){
                JsonObject result=read(file,"result:"+id);
                if(!id.equals(text(result,"requestId"))||!fingerprint(request).equals(text(result,"requestDigest"))||!text(request,"bodyUuid").equals(text(result,"bodyUuid")))throw new IllegalStateException("RESULT_MISMATCH");
                if(!text(result,"state").equals("running"))return result;
            }Thread.sleep(100);
        }while(System.currentTimeMillis()<until);
        return result(request,"unknown","AUTH_RESULT_UNKNOWN");
    }
    public JsonObject result(JsonObject request,String state,String reason) throws Exception {
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);
        for(String field:List.of("requestId","realmId","operation","primaryName","primaryUuid","bodyName","bodyUuid"))out.addProperty(field,text(request,field));
        out.addProperty("state",state);out.addProperty("reason",reason);out.addProperty("requestDigest",fingerprint(request));out.addProperty("observedAt",System.currentTimeMillis());return out;
    }
    public static String text(JsonObject in,String name){return in.has(name)&&in.get(name).isJsonPrimitive()?in.get(name).getAsString():"";}
}
