package dev.maw.client;

import com.google.gson.*;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

/** One durable record per action. An unfinished record is unknown after restart, never replayed. */
public final class ActionStore {
    private static final Gson JSON = new GsonBuilder().serializeNulls().create();
    private final Path directory;
    private final String body, server;
    private final Set<String> unresolved = new HashSet<>();
    public ActionStore(Path root, String body, String server) throws Exception {
        if (!body.matches("[0-9a-f-]{36}")) throw new IllegalArgumentException("invalid_body");
        this.body=body;this.server=server;
        directory = root.resolve("actions").resolve(hash(server).substring(0, 24)).resolve(body);
        Files.createDirectories(directory);
        try (var files = Files.list(directory)) {
            for (Path file : files.filter(p -> p.getFileName().toString().endsWith(".json")).toList()) {
                JsonObject value = load(file);
                JsonObject audit=verifiedAudit(file,value);
                if ((!value.get("terminal").getAsBoolean() || !value.get("outcomeKnown").getAsBoolean()) && audit==null)
                    unresolved.add(value.get("action_id").getAsString());
            }
        }
    }
    public synchronized JsonObject get(String id) throws Exception {
        Path file = file(id);
        if (!Files.exists(file)) return null;
        JsonObject value = load(file);
        JsonObject audit=verifiedAudit(file,value);
        if (!value.get("terminal").getAsBoolean()) {
            value.addProperty("status", "unknown"); value.addProperty("terminal", true);
            value.addProperty("ok", false); value.addProperty("outcomeKnown", false);
            value.addProperty("code", "client_restart_outcome_unknown");
        }
        if(audit!=null)value.add("operatorAudit",audit);
        return value;
    }
    /** Offline operator entry point only; the live bridge owns the same OS file lock. */
    public static JsonObject auditReleaseOffline(Path root,String body,String server,String id,Path evidenceFile) throws Exception {
        if(!evidenceFile.isAbsolute())throw new IllegalArgumentException("absolute_evidence_path_required");
        try(var channel=FileChannel.open(root.resolve("instance.lock"),StandardOpenOption.CREATE,StandardOpenOption.WRITE)) {
            java.nio.channels.FileLock lock;
            try {lock=channel.tryLock();}catch(java.nio.channels.OverlappingFileLockException busy){throw new IllegalStateException("client_must_be_closed",busy);}
            if(lock==null)throw new IllegalStateException("client_must_be_closed");
            try(lock) {
                var store=new ActionStore(root,body,server);
                Path original=store.file(id);JsonObject value=store.get(id);
                if(value==null||value.get("outcomeKnown").getAsBoolean()||!store.unresolved.contains(id))throw new IllegalStateException("unknown_action_required");
                JsonObject evidence=JSON.fromJson(Files.readString(evidenceFile),JsonObject.class);
                store.checkEvidence(evidence,value);
                JsonObject audit=new JsonObject();audit.addProperty("schemaVersion",1);audit.addProperty("at",Instant.now().toString());
                audit.addProperty("bodyId",body);audit.addProperty("server",server);audit.addProperty("action_id",id);
                audit.add("operation",value.get("operation"));audit.add("fingerprint",value.get("fingerprint"));
                audit.addProperty("originalRecordSha256",hashBytes(Files.readAllBytes(original)));
                audit.addProperty("evidencePath",evidenceFile.toString());audit.addProperty("evidenceSha256",hashBytes(Files.readAllBytes(evidenceFile)));
                audit.addProperty("disposition","release_new_actions_keep_unknown");audit.addProperty("retryAutomatically",false);
                audit.add("summary",evidence.get("summary"));
                Path target=store.auditFile(id);Files.createDirectories(target.getParent());
                try(var out=FileChannel.open(target,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE)) {
                    ByteBuffer buffer=ByteBuffer.wrap((JSON.toJson(audit)+"\n").getBytes(StandardCharsets.UTF_8));
                    while(buffer.hasRemaining())out.write(buffer);out.force(true);
                }
                return audit;
            }
        }
    }
    private Path auditFile(String id){return file(id).resolveSibling("operator-audits").resolve(id+".json");}
    private void checkEvidence(JsonObject evidence,JsonObject value) {
        String summary=evidence.has("summary")?evidence.get("summary").getAsString():"";
        if(!body.equals(text(evidence,"bodyId"))||!server.equals(text(evidence,"server"))||
            !text(value,"action_id").equals(text(evidence,"action_id"))||!text(value,"fingerprint").equals(text(evidence,"fingerprint"))||
            summary.isBlank()||summary.length()>2000)throw new IllegalStateException("operator_audit_evidence_mismatch");
    }
    private JsonObject verifiedAudit(Path file,JsonObject value) throws Exception {
        Path target=auditFile(text(value,"action_id"));if(!Files.exists(target))return null;
        if(Files.size(target)>65536)throw new IllegalStateException("operator_audit_invalid");
        JsonObject audit=JSON.fromJson(Files.readString(target),JsonObject.class);
        Path evidence=Path.of(text(audit,"evidencePath"));
        if((value.get("terminal").getAsBoolean()&&value.get("outcomeKnown").getAsBoolean())||
            !body.equals(text(audit,"bodyId"))||!server.equals(text(audit,"server"))||
            !text(value,"action_id").equals(text(audit,"action_id"))||!text(value,"operation").equals(text(audit,"operation"))||
            !text(value,"fingerprint").equals(text(audit,"fingerprint"))||
            !"release_new_actions_keep_unknown".equals(text(audit,"disposition"))||audit.get("retryAutomatically").getAsBoolean()||
            !hashBytes(Files.readAllBytes(file)).equals(text(audit,"originalRecordSha256"))||!evidence.isAbsolute()||
            !hashBytes(Files.readAllBytes(evidence)).equals(text(audit,"evidenceSha256")))throw new IllegalStateException("operator_audit_invalid");
        checkEvidence(audit,value);checkEvidence(JSON.fromJson(Files.readString(evidence),JsonObject.class),value);
        return audit;
    }
    private static String text(JsonObject object,String key){return object.has(key)?object.get(key).getAsString():"";}
    private static String hashBytes(byte[] value) throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));}
    public synchronized void accept(JsonObject record) throws Exception {
        String id = record.get("action_id").getAsString();
        if (Files.exists(file(id))) throw new IllegalStateException("action_already_exists");
        save(record); unresolved.add(id);
    }
    public synchronized void finish(JsonObject record) throws Exception {
        String id = record.get("action_id").getAsString();
        JsonObject old = load(file(id));
        if (!old.get("fingerprint").equals(record.get("fingerprint"))) throw new IllegalStateException("action_fingerprint_changed");
        if (old.get("terminal").getAsBoolean()) throw new IllegalStateException("action_already_terminal");
        save(record);
        if (record.get("outcomeKnown").getAsBoolean()) unresolved.remove(id);
    }
    public synchronized int unresolvedCount() { return unresolved.size(); }
    private Path file(String id) {
        if (id == null || !id.matches("[A-Za-z0-9_.-]{1,64}") || id.equals(".") || id.equals(".."))
            throw new IllegalArgumentException("invalid_action_id");
        return directory.resolve(id + ".json");
    }
    private JsonObject load(Path file) throws Exception {
        if (Files.size(file) > 2_097_152) throw new IllegalStateException("action_record_over_budget");
        JsonObject value = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
        if (!value.has("action_id") || !value.has("fingerprint") || !value.has("terminal") || !value.has("outcomeKnown"))
            throw new IllegalStateException("action_record_invalid");
        return value;
    }
    private void save(JsonObject record) throws Exception {
        Path target = file(record.get("action_id").getAsString());
        Path temp = target.resolveSibling(target.getFileName() + ".tmp-" + UUID.randomUUID());
        byte[] bytes = (JSON.toJson(record) + "\n").getBytes(StandardCharsets.UTF_8);
        try {
            try (FileChannel out = FileChannel.open(temp, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) out.write(buffer);
                out.force(true);
            }
            Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(temp); }
    }
    public static JsonElement canonical(JsonElement value) {
        if (value.isJsonObject()) {
            JsonObject sorted = new JsonObject();
            value.getAsJsonObject().keySet().stream().sorted().forEach(key -> sorted.add(key, canonical(value.getAsJsonObject().get(key))));
            return sorted;
        }
        if (value.isJsonArray()) {
            JsonArray array = new JsonArray(); for (JsonElement item : value.getAsJsonArray()) array.add(canonical(item)); return array;
        }
        return value.deepCopy();
    }
    public static String fingerprint(String operation, JsonObject args) {
        JsonArray value = new JsonArray(); value.add(operation); value.add(canonical(args)); return hash(JSON.toJson(value));
    }
    public static String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }
}
