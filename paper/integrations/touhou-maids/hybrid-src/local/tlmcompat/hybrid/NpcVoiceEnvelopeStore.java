package local.tlmcompat.hybrid;

import com.google.gson.*;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Metadata only. Never owns dialogue text, permissions, replay or the original inbox. */
final class NpcVoiceEnvelopeStore {
    static final long MAX_AGE_MILLIS = 120_000;
    static final int MAX_RECORDS = 256, MAX_FILE_BYTES = 262_144, MAX_ENVELOPE_BYTES = 8192;
    private static final Set<String> FIELDS = Set.of("schema", "eventId", "listenerId", "speakerId", "speaker",
        "channel", "occurredAt", "receivedAt", "deliveryScope", "world", "worldId", "trusted");
    private final Path directory;

    NpcVoiceEnvelopeStore(Path directory) throws IOException {
        this.directory = directory;
        Files.createDirectories(directory);
        if (Files.isSymbolicLink(directory)) throw new IOException("envelope_directory_unavailable");
    }

    /** Current live source/target facts come from Bukkit, never from dialogue text. */
    static JsonObject validate(UUID maid, UUID speaker, String event, String encoded,
                               String sourceWorld, UUID sourceWorldId, String targetWorld, UUID targetWorldId,
                               long now) {
        try {
            if (encoded == null || encoded.length() > MAX_ENVELOPE_BYTES
                    || encoded.getBytes(StandardCharsets.UTF_8).length > MAX_ENVELOPE_BYTES) return null;
            JsonObject row = metadata(JsonParser.parseString(encoded).getAsJsonObject());
            long occurred = number(row, "occurredAt");
            if (!maid.toString().equals(string(row, "listenerId")) || !speaker.toString().equals(string(row, "speakerId"))
                    || !event.equals(string(row, "eventId")) || !sourceWorld.equals(string(row, "world"))
                    || !targetWorld.equals(string(row, "world")) || !sourceWorldId.toString().equals(string(row, "worldId"))
                    || !targetWorldId.toString().equals(string(row, "worldId"))
                    || occurred > now || now - occurred > MAX_AGE_MILLIS || number(row, "receivedAt") > now) return null;
            return row;
        } catch (RuntimeException invalid) { return null; }
    }

    private static String string(JsonObject row, String key) {
        JsonPrimitive value = row.getAsJsonPrimitive(key);
        if (value == null || !value.isString()) throw new IllegalArgumentException(key);
        return value.getAsString();
    }

    private static long number(JsonObject row, String key) {
        JsonPrimitive value = row.getAsJsonPrimitive(key);
        if (value == null || !value.isNumber()) throw new IllegalArgumentException(key);
        return value.getAsBigDecimal().longValueExact();
    }

    private static UUID uuid(JsonObject row, String key) {
        String value = string(row, key);
        UUID id = UUID.fromString(value);
        if (!id.toString().equals(value)) throw new IllegalArgumentException(key);
        return id;
    }

    private static JsonObject metadata(JsonObject input) {
        if (number(input, "schema") != 1) throw new IllegalArgumentException("envelope_schema");
        UUID maid = uuid(input, "listenerId"), speaker = uuid(input, "speakerId");
        uuid(input, "worldId");
        String event = string(input, "eventId"), name = string(input, "speaker"), world = string(input, "world");
        long occurred = number(input, "occurredAt"), received = number(input, "receivedAt");
        if (maid.equals(speaker) || !event.startsWith("qdvoice:" + speaker + ":") || event.length() > 192
                || event.length() == ("qdvoice:" + speaker + ":").length()
                || event.codePoints().anyMatch(Character::isISOControl)
                || name.isBlank() || name.length() > 128 || name.codePoints().anyMatch(Character::isISOControl)
                || world.length() > 256 || !world.matches("[a-z0-9._-]+:[a-z0-9/._-]+")
                || !Set.of("voice", "chat", "npc_chat").contains(string(input, "channel"))
                || !"nearby".equals(string(input, "deliveryScope")) || occurred < 0 || received < occurred
                || !input.getAsJsonPrimitive("trusted").isBoolean() || input.get("trusted").getAsBoolean())
            throw new IllegalArgumentException("invalid_envelope");
        JsonObject row = new JsonObject();
        // Project a fixed field list: text, tokens, audio and arbitrary extras cannot reach disk.
        for (String key : new TreeSet<>(FIELDS)) row.add(key, input.get(key).deepCopy());
        return row;
    }

    private Path file(UUID maid) { return directory.resolve(maid + ".json"); }

    private JsonObject read(UUID maid) throws IOException {
        Path file = file(maid);
        if (Files.isSymbolicLink(file)) throw new IOException("envelope_file_unavailable");
        if (!Files.exists(file)) return new JsonObject();
        byte[] bytes;
        try (var stream = Files.newInputStream(file)) { bytes = stream.readNBytes(MAX_FILE_BYTES + 1); }
        if (bytes.length > MAX_FILE_BYTES) throw new IOException("envelope_file_limit");
        try {
            JsonObject root = JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8)).getAsJsonObject();
            // Future schemas and corrupt data fail closed, including acknowledge writes.
            if (number(root, "schema") != 1 || !maid.toString().equals(string(root, "maidId"))
                    || !root.keySet().equals(Set.of("schema", "maidId", "envelopes")))
                throw new IllegalArgumentException("envelope_schema");
            JsonObject rows = root.getAsJsonObject("envelopes");
            if (rows.size() > MAX_RECORDS) throw new IllegalArgumentException("envelope_record_limit");
            for (var entry : rows.entrySet()) {
                JsonObject row = entry.getValue().getAsJsonObject();
                if (!row.keySet().equals(FIELDS) || !entry.getKey().equals(string(row, "eventId"))
                        || !maid.toString().equals(string(row, "listenerId"))) throw new IllegalArgumentException();
                metadata(row);
            }
            return rows;
        } catch (RuntimeException invalid) { throw new IOException("envelope_file_unavailable", invalid); }
    }

    /** Same original event is immutable; retries keep both originally saved timestamps. */
    synchronized void put(UUID maid, JsonObject envelope) throws IOException {
        JsonObject row = metadata(envelope);
        if (!maid.toString().equals(string(row, "listenerId"))) throw new IOException("envelope_maid_mismatch");
        String event = string(row, "eventId");
        JsonObject rows = read(maid), old = rows.getAsJsonObject(event);
        if (old != null) {
            JsonObject previous = old.deepCopy(), incoming = row.deepCopy();
            previous.remove("receivedAt"); incoming.remove("receivedAt");
            if (!previous.equals(incoming)) throw new IOException("envelope_event_conflict");
            return;
        }
        if (rows.size() >= MAX_RECORDS) throw new IOException("envelope_record_limit");
        rows.add(event, row);
        write(maid, rows);
    }

    synchronized JsonObject get(UUID maid, String event, UUID speaker) throws IOException {
        JsonObject row = read(maid).getAsJsonObject(event);
        return row != null && speaker.toString().equals(string(row, "speakerId")) ? row.deepCopy() : null;
    }

    static boolean matchesPending(JsonObject snapshot, UUID maid, String event, UUID speaker) {
        if (snapshot == null || !new JsonPrimitive(maid.toString()).equals(snapshot.get("maidId"))
                || !snapshot.has("messages") || !snapshot.get("messages").isJsonArray()) return false;
        boolean found = false;
        for (JsonElement value : snapshot.getAsJsonArray("messages")) {
            if (!value.isJsonObject()) continue;
            JsonObject row = value.getAsJsonObject();
            if (!new JsonPrimitive(event).equals(row.get("eventId"))) continue;
            if (!new JsonPrimitive(speaker.toString()).equals(row.get("senderUuid"))) return false;
            found = true;
        }
        return found;
    }

    /** Caller already authorized the original snapshot. Join only this maid + event + sender. */
    synchronized void enrich(UUID maid, JsonObject snapshot) throws IOException {
        if (!new JsonPrimitive(maid.toString()).equals(snapshot.get("maidId"))
                || !snapshot.has("messages") || !snapshot.get("messages").isJsonArray()) return;
        JsonObject rows = read(maid);
        for (JsonElement value : snapshot.getAsJsonArray("messages")) {
            if (!value.isJsonObject()) continue;
            JsonObject message = value.getAsJsonObject();
            JsonElement event = message.get("eventId");
            if (event == null || !event.isJsonPrimitive() || !event.getAsJsonPrimitive().isString()) continue;
            JsonObject row = rows.getAsJsonObject(event.getAsString());
            if (row == null || !row.get("speakerId").equals(message.get("senderUuid"))) continue;
            for (var entry : row.entrySet()) message.add(entry.getKey(), entry.getValue().deepCopy());
        }
    }

    /** Called only after original inbox acknowledgement succeeds. No replay or old-inbox writes. */
    synchronized void remove(UUID maid, String event) throws IOException {
        JsonObject rows = read(maid);
        if (rows.remove(event) != null) write(maid, rows);
    }

    private void write(UUID maid, JsonObject rows) throws IOException {
        JsonObject root = new JsonObject();
        root.addProperty("schema", 1); root.addProperty("maidId", maid.toString()); root.add("envelopes", rows);
        byte[] bytes = root.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_FILE_BYTES) throw new IOException("envelope_file_limit");
        Path temp = Files.createTempFile(directory, maid + "-", ".tmp");
        try {
            try (FileChannel channel = FileChannel.open(temp, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            Files.move(temp, file(maid), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(temp); }
    }
}
