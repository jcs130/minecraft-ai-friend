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
    private final Set<String> unresolved = new HashSet<>();
    public ActionStore(Path root, String body, String server) throws Exception {
        if (!body.matches("[0-9a-f-]{36}")) throw new IllegalArgumentException("invalid_body");
        directory = root.resolve("actions").resolve(hash(server).substring(0, 24)).resolve(body);
        Files.createDirectories(directory);
        try (var files = Files.list(directory)) {
            for (Path file : files.filter(p -> p.getFileName().toString().endsWith(".json")).toList()) {
                JsonObject value = load(file);
                if (!value.has("terminal") || !value.get("terminal").getAsBoolean()
                        || !value.get("outcomeKnown").getAsBoolean()) unresolved.add(value.get("action_id").getAsString());
            }
        }
    }
    public synchronized JsonObject get(String id) throws Exception {
        Path file = file(id);
        if (!Files.exists(file)) return null;
        JsonObject value = load(file);
        if (!value.get("terminal").getAsBoolean()) {
            value.addProperty("status", "unknown"); value.addProperty("terminal", true);
            value.addProperty("ok", false); value.addProperty("outcomeKnown", false);
            value.addProperty("code", "client_restart_outcome_unknown");
        }
        return value;
    }
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
