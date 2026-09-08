package dev.god.godvoice;

import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/** A deliberately blocked disk sink must never block or enqueue MC publications. */
public class SpeechHealthTest {
    private static int checks;
    private static void check(boolean value, String message) {
        checks++; if (!value) throw new AssertionError(message);
    }
    public static void main(String[] args) throws Exception {
        var health = new SpeechHealth();
        var written = new ArrayList<SpeechHealth.Snapshot>();
        check(!health.flush(1, 1000, written::add), "no invented sample before an MC tick");
        health.publish(1, 900, 2, 4);
        check(!health.flush(2, 1000, written::add), "old run ignored");
        check(health.flush(1, 1000, written::add), "first sample written");
        check(written.getFirst().sampledAt() == 900, "delayed write retains MC sample time");
        check(!health.flush(1, 5000, written::add), "no fresh heartbeat without a fresh MC sample");
        health.publish(1, 5100, 1, 3);
        check(health.flush(1, 5100, written::add), "fresh sample accepted");
        health.publish(1, 5200, 3, 2);
        check(!health.flush(1, 5500, written::add), "at most one flush per second");
        health.publish(1, 5800, 4, 1);
        check(health.flush(1, 6100, written::add), "coalesced sample accepted after interval");
        check(written.size() == 3 && written.getLast().sampledAt() == 5800
                && written.getLast().activeCount() == 4, "intermediate sample overwritten, not queued");

        var blocked = new SpeechHealth();
        blocked.publish(3, 10, 0, 0);
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
        var failure = new AtomicReference<Throwable>();
        var first = new AtomicReference<SpeechHealth.Snapshot>();
        Thread writer = new Thread(() -> {
            try { blocked.flush(3, 1000, sample -> {
                first.set(sample); entered.countDown();
                try { if (!release.await(3, TimeUnit.SECONDS)) throw new IOException("test sink timeout"); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IOException(e); }
            }); } catch (Throwable e) { failure.set(e); }
        }, "speech-health-test-slow-disk");
        writer.start();
        try {
            check(entered.await(2, TimeUnit.SECONDS), "background disk sink entered");
            for (int value = 11; value <= 10010; value++) blocked.publish(3, value, value, 4);
            check(writer.isAlive() && release.getCount() == 1, "MC can publish 10000 samples while disk stays blocked");
        } finally { release.countDown(); writer.join(3000); }
        check(!writer.isAlive() && failure.get() == null, "writer exits after disk resumes");
        check(first.get().sampledAt() == 10 && first.get().activeCount() == 0,
                "in-flight snapshot remains immutable");
        var latest = new AtomicReference<SpeechHealth.Snapshot>();
        check(blocked.flush(3, 2000, latest::set), "pending latest sample flushes after recovery");
        check(latest.get().sampledAt() == 10010 && latest.get().activeCount() == 10010,
                "single latest sample survives, no stale backlog");

        var retry = new SpeechHealth(); retry.publish(4, 50, 0, 0);
        var attempts = new AtomicInteger();
        try { retry.flush(4, 1000, sample -> { attempts.incrementAndGet(); throw new IOException("disk unavailable"); });
            throw new AssertionError("expected IO failure"); } catch (IOException expected) { checks++; }
        check(!retry.flush(4, 1500, sample -> attempts.incrementAndGet()), "failed writes remain throttled");
        retry.publish(4, 2000, 1, 1);
        check(retry.flush(4, 2000, sample -> attempts.incrementAndGet()) && attempts.get() == 2,
                "IO failure does not prevent newer sample recovery");

        var directory = Files.createTempDirectory("speech-health-contract-");
        try {
            var sample = new SpeechHealth.Snapshot(5, 1234, 2, 4);
            SpeechHealth.writeAtomic(directory, sample, () -> true);
            var target = directory.resolve(".speech-health.json");
            String original = Files.readString(target);
            var row = JsonParser.parseString(original).getAsJsonObject();
            check(row.size() == 6 && row.get("schema").getAsInt() == 2 && row.get("protocol").getAsInt() == 2,
                    "existing health schema preserved");
            check(row.get("updatedAt").getAsLong() == 1234 && row.get("activeCount").getAsInt() == 2
                    && row.get("queuedCount").getAsInt() == 4 && row.get("countsIncludeLegacy").getAsBoolean(),
                    "atomic file contains real MC sample and both counts");
            var stale = new SpeechHealth.Snapshot(6, 9999, 0, 0);
            SpeechHealth.writeAtomic(directory, stale, () -> false);
            check(Files.readString(target).equals(original), "stopped run cannot start health output");
            var fenceChecks = new AtomicInteger();
            SpeechHealth.writeAtomic(directory, stale, () -> fenceChecks.incrementAndGet() == 1);
            check(Files.readString(target).equals(original), "run stopped during IO cannot publish delayed health");
            try (var files = Files.list(directory)) {
                check(files.count() == 1, "temporary output removed on success and stale run");
            }
        } finally {
            try (var files = Files.list(directory)) { for (var path : files.toList()) Files.delete(path); }
            Files.delete(directory);
        }
        System.out.println("{\"ok\":true,\"assertions\":" + checks
                + ",\"blockedSinkPublications\":10000,\"modelCalls\":0,\"liveAudio\":false}");
    }
}
