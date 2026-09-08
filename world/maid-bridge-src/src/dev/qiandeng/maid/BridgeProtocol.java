package dev.qiandeng.maid;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Set;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Pure wire validation; no entity lookup, mutation, credentials or networking. */
public final class BridgeProtocol {
    public static final String ENDPOINT = "http://npc:8091/v1/maid/chat/completions";
    public static final String PREFIX = "QD_MAID_JSON ";
    public static final Set<String> READS = Set.of("identity", "context", "task_catalog");
    public static final Set<String> WRITES = Set.of("sit", "follow", "schedule", "work");
    public static final int MAX_REPLY_BYTES = 3500;
    private BridgeProtocol() {}

    public record Request(String requestId, UUID maidUuid, UUID ownerUuid, String operation,
                          JsonObject args, String fingerprint) {}
    public static Request decode(String encoded) {
        if (encoded == null || !encoded.matches("[A-Za-z0-9_-]{1,1400}")) throw new Failure("invalid_request");
        byte[] bytes;
        try { bytes = Base64.getUrlDecoder().decode(encoded); }
        catch (IllegalArgumentException e) { throw new Failure("invalid_request"); }
        if (bytes.length > 1024) throw new Failure("request_too_large");
        JsonObject body;
        try { body = JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8)).getAsJsonObject(); }
        catch (RuntimeException e) { throw new Failure("invalid_request"); }
        exactKeys(body, Set.of("schema", "requestId", "maidUuid", "ownerUuid", "operation", "args"));
        if (!body.has("schema") || !body.get("schema").isJsonPrimitive()
            || !body.getAsJsonPrimitive("schema").isNumber() || !body.get("schema").toString().equals("1"))
            throw new Failure("invalid_schema");
        String requestId = string(body, "requestId", 80);
        if (!requestId.matches("[A-Za-z0-9_-]{16,80}")) throw new Failure("invalid_request_id");
        UUID maid = uuid(string(body, "maidUuid", 36)), owner = uuid(string(body, "ownerUuid", 36));
        String operation = string(body, "operation", 24);
        if (!READS.contains(operation) && !WRITES.contains(operation)) throw new Failure("unknown_operation");
        if (!body.has("args") || !body.get("args").isJsonObject()) throw new Failure("invalid_args");
        JsonObject args = body.getAsJsonObject("args");
        switch (operation) {
            case "identity" -> exactKeys(args, Set.of());
            case "context" -> { exactKeys(args, Set.of("category")); string(args, "category", 64); }
            case "task_catalog" -> {
                exactKeys(args, Set.of("offset"));
                if (args.has("offset")) integer(args, "offset", 0, 4096);
            }
            case "sit" -> { exactKeys(args, Set.of("sit")); bool(args, "sit"); }
            case "follow" -> { exactKeys(args, Set.of("follow")); bool(args, "follow"); }
            case "schedule" -> {
                exactKeys(args, Set.of("schedule"));
                if (!Set.of("DAY", "NIGHT", "ALL").contains(string(args, "schedule", 8)))
                    throw new Failure("invalid_schedule");
            }
            case "work" -> {
                exactKeys(args, Set.of("taskId"));
                if (!string(args, "taskId", 128).matches("[a-z0-9_.-]+:[a-z0-9_./-]+"))
                    throw new Failure("invalid_task_id");
            }
            default -> throw new Failure("unknown_operation");
        }
        return new Request(requestId, maid, owner, operation, args.deepCopy(), sha256(bytes));
    }

    public static void exactKeys(JsonObject body, Set<String> allowed) {
        if (!allowed.containsAll(body.keySet())) throw new Failure("unexpected_field");
    }
    public static String string(JsonObject obj, String key, int max) {
        if (!obj.has(key) || !obj.get(key).isJsonPrimitive() || !obj.getAsJsonPrimitive(key).isString())
            throw new Failure("invalid_" + key);
        String text = obj.get(key).getAsString();
        if (text.isBlank() || text.length() > max || text.indexOf('\0') >= 0) throw new Failure("invalid_" + key);
        return text;
    }
    public static boolean bool(JsonObject obj, String key) {
        if (!obj.has(key) || !obj.get(key).isJsonPrimitive() || !obj.getAsJsonPrimitive(key).isBoolean())
            throw new Failure("invalid_" + key);
        return obj.get(key).getAsBoolean();
    }
    public static int integer(JsonObject obj, String key, int min, int max) {
        if (!obj.has(key) || !obj.get(key).isJsonPrimitive() || !obj.getAsJsonPrimitive(key).isNumber()
            || !obj.get(key).toString().matches("[0-9]{1,8}")) throw new Failure("invalid_" + key);
        int n = obj.get(key).getAsInt();
        if (n < min || n > max) throw new Failure("invalid_" + key);
        return n;
    }
    public static UUID uuid(String text) {
        if (!text.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))
            throw new Failure("invalid_uuid");
        return UUID.fromString(text);
    }
    public static void requireOwner(UUID expected, UUID actual) {
        if (actual == null) throw new Failure("unowned_maid");
        if (expected == null || !expected.equals(actual)) throw new Failure("owner_changed");
    }
    public static String sha256(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    public static String signature(byte[] key, String requestId, String issuedAt, byte[] body) {
        if (key.length < 32 || key.length > 256) throw new Failure("identity_key_invalid");
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            String base = requestId + "\n" + issuedAt + "\n" + sha256(body);
            return HexFormat.of().formatHex(mac.doFinal(base.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
    public static String replyText(byte[] bytes) {
        if (bytes.length > 16384) throw new Failure("response_too_large");
        try {
            JsonObject value = JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8)).getAsJsonObject();
            var choices = value.getAsJsonArray("choices");
            if (choices == null || choices.size() != 1) throw new Failure("invalid_reply");
            JsonObject message = choices.get(0).getAsJsonObject().getAsJsonObject("message");
            if (message == null || message.has("tool_calls") || message.has("function_call")
                || !string(message, "role", 16).equals("assistant")) throw new Failure("tool_reply_rejected");
            return string(message, "content", 8000);
        } catch (Failure e) { throw e; }
        catch (RuntimeException e) { throw new Failure("invalid_reply"); }
    }
    public static String clip(String text, int max) {
        if (text == null) return "";
        return text.length() <= max ? text : text.substring(0, max);
    }
    public static final class Failure extends RuntimeException {
        public final String code;
        public Failure(String code) { super(code); this.code = code; }
    }
}
