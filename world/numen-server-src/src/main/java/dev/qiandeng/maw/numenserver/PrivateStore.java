package dev.qiandeng.maw.numenserver;

import com.google.gson.*;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Durable writes before dispatch; filenames are validated identities, never URLs or user paths. */
final class PrivateStore {
    static JsonObject read(Path path) {
        try {
            if (Files.isSymbolicLink(path) || Files.size(path)>2_097_152) throw new IllegalArgumentException("invalid_private_record");
            return JsonParser.parseString(Files.readString(path, StandardCharsets.UTF_8)).getAsJsonObject();
        } catch (java.io.IOException ex) { throw new IllegalStateException("private_record_unavailable"); }
    }
    static void write(Path path, JsonObject value) {
        try {
            Files.createDirectories(path.getParent());
            if (Files.isSymbolicLink(path) || Files.isSymbolicLink(path.getParent())) throw new IllegalArgumentException("private_record_symlink");
            Path tmp=path.resolveSibling(path.getFileName()+".tmp-"+UUID.randomUUID());
            try (FileChannel file=FileChannel.open(tmp,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE)) {
                ByteBuffer bytes=StandardCharsets.UTF_8.encode(value.toString());
                while(bytes.hasRemaining()) file.write(bytes);
                file.force(true);
            }
            Files.move(tmp,path,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        } catch(java.io.IOException ex) { throw new IllegalStateException("private_record_write_failed"); }
    }
    static String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch(java.security.NoSuchAlgorithmException ex) { throw new AssertionError(ex); }
    }
    static String token() { byte[] b=new byte[32]; new java.security.SecureRandom().nextBytes(b); return HexFormat.of().formatHex(b); }
    static boolean equalsSecret(String a,String b) { return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8),b.getBytes(StandardCharsets.UTF_8)); }
    static String text(JsonObject o,String name,int limit) {
        if(!o.has(name)||!o.get(name).isJsonPrimitive()||!o.get(name).getAsJsonPrimitive().isString()) throw new IllegalArgumentException("missing_or_invalid_"+name);
        String s=o.get(name).getAsString();
        if(s.length()>limit||s.indexOf('\0')>=0) throw new IllegalArgumentException("invalid_"+name);
        return s;
    }
    static String id(JsonObject o,String name) {
        String s=text(o,name,64); if(!s.matches("[A-Za-z0-9._-]{1,64}")) throw new IllegalArgumentException("invalid_"+name); return s;
    }
    static JsonObject object(Object... pairs) {
        JsonObject o=new JsonObject();
        for(int i=0;i<pairs.length;i+=2) {
            String k=(String)pairs[i];Object v=pairs[i+1];
            if(v==null)o.add(k,JsonNull.INSTANCE);
            else if(v instanceof JsonElement j)o.add(k,j);
            else if(v instanceof Boolean b)o.addProperty(k,b);
            else if(v instanceof Number n)o.addProperty(k,n);
            else o.addProperty(k,v.toString());
        } return o;
    }
    static String fingerprint(JsonElement e) {
        if(e.isJsonObject()) { JsonObject o=new JsonObject();new TreeSet<>(e.getAsJsonObject().keySet()).forEach(k->o.add(k,JsonParser.parseString(fingerprint(e.getAsJsonObject().get(k)))));return o.toString(); }
        if(e.isJsonArray()) { JsonArray a=new JsonArray();e.getAsJsonArray().forEach(v->a.add(JsonParser.parseString(fingerprint(v))));return a.toString(); }
        return e.toString();
    }
}
