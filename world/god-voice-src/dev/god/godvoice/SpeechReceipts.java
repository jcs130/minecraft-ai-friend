package dev.god.godvoice;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Set;

/** Java owns published playback receipts; terminal results never regress on a duplicate/restart. */
final class SpeechReceipts {
    static final Set<String> TERMINAL = Set.of("completed", "cancelled", "failed", "expired");
    private final Path directory;
    SpeechReceipts(Path base) { directory = base.resolve("speech-receipts"); }
    synchronized String status(String id) throws IOException {
        Path path = directory.resolve(id + ".json");
        if (!Files.exists(path)) return null;
        if (Files.isSymbolicLink(path) || Files.size(path) > 8192) throw new IOException("invalid_receipt");
        try { return SpeechJob.string(JsonParser.parseString(Files.readString(path)).getAsJsonObject(), "status", ""); }
        catch (RuntimeException bad) { throw new IOException("invalid_receipt", bad); }
    }
    synchronized void write(SpeechJob job, String status, String code, long now, Long startedAt) throws IOException {
        String previous = status(job.id());
        if (TERMINAL.contains(previous == null ? "" : previous)) return;
        if (!status.equals("started") && !TERMINAL.contains(status)) throw new IllegalArgumentException("invalid_receipt_status");
        Files.createDirectories(directory);
        var result = new JsonObject();
        result.addProperty("schema", 2); result.addProperty("id", job.id());
        result.addProperty("entity", job.entity().toString()); result.addProperty("generation", job.generation());
        result.addProperty("status", status); result.addProperty("code", code); result.addProperty("updatedAt", now);
        if (startedAt != null) result.addProperty("startedAt", startedAt);
        Path temporary = Files.createTempFile(directory, job.id() + ".", ".tmp");
        try {
            Files.writeString(temporary, result.toString() + "\n");
            try { Files.move(temporary, directory.resolve(job.id() + ".json"), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
            catch (AtomicMoveNotSupportedException ignored) { Files.move(temporary, directory.resolve(job.id() + ".json"), StandardCopyOption.REPLACE_EXISTING); }
        } finally { Files.deleteIfExists(temporary); }
    }
}
