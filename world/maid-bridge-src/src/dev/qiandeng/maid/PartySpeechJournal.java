package dev.qiandeng.maid;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;

/** Server-owned spatial hearing event and receipt, in one atomic durable record. */
public final class PartySpeechJournal {
    private final Path root;
    public PartySpeechJournal(Path root) { this.root = root.toAbsolutePath().normalize(); }
    private void checkRoot() throws IOException {
        for (Path cursor = root; cursor != null; cursor = cursor.getParent())
            if (Files.isSymbolicLink(cursor)) throw new IOException("linked_speech_journal");
    }
    private Path target(String eventId) {
        BridgeProtocol.uuid(eventId);
        return root.resolve(eventId + ".json");
    }
    private JsonObject read(Path file) throws IOException {
        checkRoot();
        if (Files.isSymbolicLink(root) || Files.isSymbolicLink(file) || Files.size(file) > 16384)
            throw new IOException("invalid_speech_record");
        try { return JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8)).getAsJsonObject(); }
        catch (RuntimeException error) { throw new IOException("invalid_speech_record", error); }
    }
    private JsonObject receipt(JsonObject row) {
        JsonObject result = row.getAsJsonObject("receipt").deepCopy();
        if (!"finished".equals(row.get("status").getAsString())) {
            result.addProperty("ok", false); result.addProperty("heard", false);
            result.addProperty("phase", "unknown"); result.addProperty("code", "outcome_unknown");
        }
        result.addProperty("observedAt", System.currentTimeMillis());
        return result;
    }
    public JsonObject claim(String eventId, String fingerprint, JsonObject input, JsonObject baseReceipt) throws IOException {
        Path file = target(eventId);
        checkRoot();
        Files.createDirectories(root);
        if (Files.isSymbolicLink(root)) throw new IOException("linked_speech_journal");
        if (Files.exists(file, LinkOption.NOFOLLOW_LINKS)) {
            JsonObject row = read(file);
            if (!fingerprint.equals(row.get("fingerprint").getAsString()))
                throw new BridgeProtocol.Failure("request_id_conflict");
            return receipt(row);
        }
        try (var entries = Files.list(root)) {
            if (entries.limit(4097).count() >= 4096) throw new IOException("speech_journal_full");
        }
        JsonObject row = new JsonObject(); row.addProperty("status", "claimed");
        row.addProperty("fingerprint", fingerprint); row.add("input", input.deepCopy());
        row.add("receipt", baseReceipt.deepCopy());
        write(file, row);
        return null;
    }
    private void write(Path file, JsonObject row) throws IOException {
        try (var channel = FileChannel.open(file, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            var bytes = StandardCharsets.UTF_8.encode(row.toString());
            while (bytes.hasRemaining()) channel.write(bytes);
            channel.force(true);
        }
    }
    public void finish(String eventId, String fingerprint, JsonObject input, JsonObject result) throws IOException {
        Path file = target(eventId); JsonObject existing = read(file);
        if (!fingerprint.equals(existing.get("fingerprint").getAsString()))
            throw new BridgeProtocol.Failure("request_id_conflict");
        if (!"claimed".equals(existing.get("status").getAsString()))
            throw new IOException("speech_already_finished");
        JsonObject row = new JsonObject(); row.addProperty("status", "finished");
        row.addProperty("fingerprint", fingerprint); row.add("input", input.deepCopy());
        // This persisted event is the service's spatial hearing input. No private Qwen delivery.
        String kind = input.has("channel") && input.get("channel").getAsString().equals("msg") ? "private_message" : "nearby_speech";
        row.addProperty("eventType", kind + (result.get("heard").getAsBoolean() ? "_heard" : "_rejected"));
        row.add("receipt", result.deepCopy());
        Path temporary = root.resolve(eventId + ".tmp");
        write(temporary, row);
        Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }
    public JsonObject status(String eventId) throws IOException {
        Path file = target(eventId);
        checkRoot();
        if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) return null;
        return receipt(read(file));
    }
}
