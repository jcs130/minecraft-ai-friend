package dev.qiandeng.maid;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.UUID;

/** Forced claim before a native effect. A persisted unknown is never permission to replay. */
public final class RescueJournal {
    private final Path root;
    public RescueJournal(Path root) { this.root = root.toAbsolutePath().normalize(); }
    private Path path(String kind, UUID id) throws IOException {
        for (Path parent = root; parent != null; parent = parent.getParent())
            if (Files.isSymbolicLink(parent)) throw new IOException("linked_rescue_journal");
        Files.createDirectories(root);
        if (Files.isSymbolicLink(root)) throw new IOException("linked_rescue_journal");
        return root.resolve(kind + "-" + id + ".json");
    }
    private JsonObject read(Path path) throws IOException {
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) return null;
        if (Files.isSymbolicLink(path) || !Files.isRegularFile(path) || Files.size(path) > 32768)
            throw new IOException("invalid_rescue_journal");
        try { return JsonParser.parseString(Files.readString(path, StandardCharsets.UTF_8)).getAsJsonObject(); }
        catch (RuntimeException error) { throw new IOException("invalid_rescue_journal", error); }
    }
    private void write(Path destination, JsonObject data, boolean replace) throws IOException {
        Path temporary = root.resolve("write-" + UUID.randomUUID() + ".tmp");
        try {
            Files.writeString(temporary, data.toString(), StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
            try (FileChannel file = FileChannel.open(temporary, StandardOpenOption.WRITE)) { file.force(true); }
            if (replace) Files.move(temporary, destination, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            else { Files.createLink(destination, temporary); Files.delete(temporary); }
            // Persist the directory entry on the Linux production filesystem; Windows cannot open directories.
            if (!System.getProperty("os.name").startsWith("Windows"))
                try (FileChannel directory = FileChannel.open(root, StandardOpenOption.READ)) { directory.force(true); }
        } finally { Files.deleteIfExists(temporary); }
    }
    public synchronized JsonObject claim(UUID actionId, String fingerprint, JsonObject input, JsonObject unknown) throws IOException {
        Path destination = path("action", actionId);
        JsonObject existing = read(destination);
        if (existing != null) {
            if (!fingerprint.equals(existing.get("fingerprint").getAsString()))
                throw new BridgeProtocol.Failure("request_id_conflict");
            return existing.getAsJsonObject("receipt").deepCopy();
        }
        JsonObject row = new JsonObject(); row.addProperty("fingerprint", fingerprint);
        row.addProperty("finished", false); row.add("input", input.deepCopy()); row.add("receipt", unknown.deepCopy());
        write(destination, row, false); return null;
    }
    public synchronized void finish(UUID actionId, String fingerprint, JsonObject input, JsonObject receipt) throws IOException {
        Path destination = path("action", actionId); JsonObject row = read(destination);
        if (row == null || !fingerprint.equals(row.get("fingerprint").getAsString())
                || !input.equals(row.get("input"))) throw new BridgeProtocol.Failure("request_id_conflict");
        if (row.get("finished").getAsBoolean()) {
            if (!receipt.equals(row.get("receipt"))) throw new BridgeProtocol.Failure("receipt_already_terminal");
            return;
        }
        row.addProperty("finished", true); row.add("receipt", receipt.deepCopy()); write(destination, row, true);
    }
    public synchronized JsonObject status(UUID actionId) throws IOException {
        JsonObject row = read(path("action", actionId));
        return row == null ? null : row.getAsJsonObject("receipt").deepCopy();
    }
    public synchronized void putQuote(UUID id, JsonObject value) throws IOException {
        Path destination = path("quote", id); JsonObject existing = read(destination);
        if (existing != null) {
            if (!existing.equals(value)) throw new BridgeProtocol.Failure("quote_id_conflict");
            return;
        }
        write(destination, value, false);
    }
    public synchronized JsonObject quote(UUID id) throws IOException { return read(path("quote", id)); }
}
