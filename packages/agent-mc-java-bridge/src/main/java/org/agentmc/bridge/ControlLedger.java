package org.agentmc.bridge;

import com.google.gson.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Game-independent lease and durable idempotency. Unknown requests are never replayed. */
public final class ControlLedger {
    public static final class Action {
        public String id, operation, signature, phase = "accepted", reason;
        public long acceptedAt, updatedAt;
        public JsonObject evidence = new JsonObject();
        transient JsonObject input;
        transient int ticks;
        transient double[] before;
    }
    private final Path directory;
    private final Map<String, Action> actions = new LinkedHashMap<>();
    private final Gson gson = new Gson();
    private String controller, nonce;
    private long expiresAt;
    public ControlLedger(Path directory) throws Exception {
        this.directory = directory;
        Files.createDirectories(directory);
        try (var files = Files.list(directory)) {
            for (Path file : files.filter(p -> p.getFileName().toString().matches("[a-f0-9]{64}\\.json")).toList()) {
                Action action = gson.fromJson(Files.readString(file), Action.class);
                if (action == null || action.id == null || !file.getFileName().toString().equals(hash(action.id) + ".json")) continue;
                if (Set.of("accepted", "running").contains(action.phase)) { action.phase = "unknown"; action.reason = "Previous client ended before a verified terminal receipt"; save(action); }
                actions.put(action.id, action);
            }
        }
    }
    public boolean active(long now) { return controller != null && now < expiresAt; }
    public String owner(long now) { return active(now) ? controller : null; }
    public JsonObject claim(String requested, int ttl, long now) {
        if (requested == null || !requested.matches("[A-Za-z0-9_.:-]{1,128}")) throw new IllegalArgumentException("Invalid controllerId");
        if (active(now)) throw new IllegalStateException("Client already has a controller; no implicit takeover");
        controller = requested; nonce = UUID.randomUUID().toString(); expiresAt = 0;
        return renew(requested, nonce, ttl, now);
    }
    public void require(String requested, String proof, long now) {
        if (!active(now) || !controller.equals(requested) || !Objects.equals(nonce, proof)) throw new IllegalStateException("Controller lease missing or expired");
    }
    public JsonObject renew(String requested, String proof, int ttl, long now) {
        if (ttl < 1000 || ttl > 30000) throw new IllegalArgumentException("Lease ttl must be 1000..30000 ms");
        if (expiresAt > 0) require(requested, proof, now);
        expiresAt = now + ttl;
        JsonObject result = new JsonObject(); result.addProperty("controllerId", controller); result.addProperty("nonce", nonce); result.addProperty("expiresAt", expiresAt); return result;
    }
    public void release() { controller = null; nonce = null; expiresAt = 0; }
    public Action get(String id) { return actions.get(id); }
    public List<Action> recent() { return actions.values().stream().skip(Math.max(0, actions.size() - 100)).toList(); }
    public Action admit(String id, String operation, JsonObject input, long now) throws Exception {
        if (id == null || !id.matches("[A-Za-z0-9_.:-]{1,256}")) throw new IllegalArgumentException("Invalid action_id");
        String signature = hash(operation + ":" + input);
        Action old = actions.get(id);
        if (old != null) {
            if (!old.signature.equals(signature)) throw new IllegalArgumentException("action_id reused with different input");
            return old;
        }
        Action action = new Action(); action.id = id; action.operation = operation; action.signature = signature;
        action.input = input.deepCopy(); action.acceptedAt = action.updatedAt = now;
        save(action); actions.put(id, action); return action;
    }
    public void finish(Action action, String phase, String reason, JsonObject evidence, long now) throws Exception {
        if (!Set.of("accepted", "running").contains(action.phase)) return;
        action.phase = phase; action.reason = reason; action.evidence = evidence; action.updatedAt = now; save(action);
    }
    public void save(Action action) throws Exception {
        Path file = directory.resolve(hash(action.id) + ".json"), temp = directory.resolve(hash(action.id) + ".tmp");
        Files.writeString(temp, gson.toJson(action));
        Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
    }
    public static String hash(String text) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
}
