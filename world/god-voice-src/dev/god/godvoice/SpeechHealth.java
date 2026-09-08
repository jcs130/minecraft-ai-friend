package dev.god.godvoice;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

/** One immutable MC sample; only the existing watcher calls flush or touches disk. */
final class SpeechHealth {
    record Snapshot(long epoch, long sampledAt, int activeCount, int queuedCount) {}
    @FunctionalInterface interface Sink { void write(Snapshot snapshot) throws IOException; }
    private final AtomicReference<Snapshot> latest = new AtomicReference<>();
    // Owned by the one watcher for this server run; never read or locked by MC.
    private long lastAttemptAt = Long.MIN_VALUE;
    private Snapshot written;

    void publish(long epoch, long sampledAt, int activeCount, int queuedCount) {
        latest.set(new Snapshot(epoch, sampledAt, activeCount, queuedCount));
    }

    boolean flush(long epoch, long now, Sink sink) throws IOException {
        Snapshot sample = latest.get();
        if (sample == null || sample.epoch() != epoch || sample == written) return false;
        if (lastAttemptAt != Long.MIN_VALUE && now - lastAttemptAt < 1000) return false;
        lastAttemptAt = now; // A failed filesystem operation is also rate limited.
        sink.write(sample);
        written = sample;
        return true;
    }

    static void writeAtomic(Path base, Snapshot sample, BooleanSupplier currentRun) throws IOException {
        if (!currentRun.getAsBoolean()) return;
        var status = new JsonObject();
        status.addProperty("schema", 2); status.addProperty("protocol", 2);
        // Keep the time MC actually sampled the world, even if the writer was delayed.
        status.addProperty("updatedAt", sample.sampledAt());
        status.addProperty("activeCount", sample.activeCount());
        status.addProperty("queuedCount", sample.queuedCount());
        status.addProperty("countsIncludeLegacy", true);
        // Separate runs cannot clobber each other's temporary file after a slow stop.
        Path temporary = base.resolve(".speech-health." + sample.epoch() + ".json.tmp");
        try {
            Files.writeString(temporary, status + "\n");
            if (!currentRun.getAsBoolean()) return;
            try { Files.move(temporary, base.resolve(".speech-health.json"),
                    StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
            catch (AtomicMoveNotSupportedException ignored) {
                Files.move(temporary, base.resolve(".speech-health.json"), StandardCopyOption.REPLACE_EXISTING);
            }
        } finally { Files.deleteIfExists(temporary); }
    }
}
