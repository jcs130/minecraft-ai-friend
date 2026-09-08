package dev.qiandeng.maid;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;

/** Claim-before-mutation journal. Interrupted native effects are never replayed. */
public final class ReceiptJournal {
    private final Path root;
    public ReceiptJournal(Path root) { this.root = root.toAbsolutePath().normalize(); }

    public JsonObject claim(BridgeProtocol.Request request) throws IOException {
        Files.createDirectories(root);
        if (Files.isSymbolicLink(root)) throw new IOException("linked_journal");
        Path target = target(request);
        if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) return previous(target, request);
        try (var files = Files.list(root)) {
            if (files.limit(4097).count() >= 4096) throw new IOException("journal_full");
        }
        JsonObject row = new JsonObject();
        row.addProperty("fingerprint", request.fingerprint());
        row.addProperty("phase", "claimed");
        Files.writeString(target, row.toString(), StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
        // Force the reservation to stable storage before any native setter.
        try (var channel = java.nio.channels.FileChannel.open(target, StandardOpenOption.WRITE)) { channel.force(true); }
        return null;
    }

    private JsonObject previous(Path target, BridgeProtocol.Request request) throws IOException {
        if (Files.isSymbolicLink(target) || Files.size(target) > 16384) throw new IOException("invalid_journal");
        try {
            JsonObject row = JsonParser.parseString(Files.readString(target, StandardCharsets.UTF_8)).getAsJsonObject();
            if (!request.fingerprint().equals(row.get("fingerprint").getAsString()))
                throw new BridgeProtocol.Failure("request_id_conflict");
            if (!row.has("result")) throw new BridgeProtocol.Failure("outcome_unknown");
            JsonObject result = row.getAsJsonObject("result").deepCopy();
            result.addProperty("replayedReceipt", true);
            return result;
        } catch (BridgeProtocol.Failure e) { throw e; }
        catch (RuntimeException e) { throw new IOException("invalid_journal"); }
    }

    public void finish(BridgeProtocol.Request request, JsonObject result) throws IOException {
        JsonObject row = new JsonObject();
        row.addProperty("fingerprint", request.fingerprint());
        row.addProperty("phase", "finished");
        row.add("result", result);
        Path temp = root.resolve(request.requestId() + ".tmp");
        if (Files.isSymbolicLink(temp)) throw new IOException("linked_journal");
        Files.writeString(temp, row.toString(), StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
        try (var channel = java.nio.channels.FileChannel.open(temp, StandardOpenOption.WRITE)) { channel.force(true); }
        Files.move(temp, target(request), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }
    private Path target(BridgeProtocol.Request request) {
        if (!request.requestId().matches("[A-Za-z0-9_-]{16,80}")) throw new BridgeProtocol.Failure("invalid_request_id");
        return root.resolve(request.requestId() + ".json");
    }
}
