package dev.god.godvoice;

/** Actual capture time bookkeeping, independent of SVC, files and Minecraft. */
public final class CaptureIntervalTest {
    private static int assertions;
    private static void check(boolean condition, String message) {
        assertions++;
        if (!condition) throw new AssertionError(message);
    }
    private static void rejects(Runnable action) {
        assertions++;
        try { action.run(); } catch (IllegalArgumentException | IllegalStateException expected) { return; }
        throw new AssertionError("Expected invalid capture rejection");
    }
    public static void main(String[] args) {
        CaptureInterval clock = new CaptureInterval(1200);
        check(!clock.shouldSplit(10000), "Empty capture never splits");
        rejects(clock::snapshot);
        rejects(() -> clock.recordPacket(0));
        rejects(() -> clock.recordPacket(-1));
        clock.recordPacket(10000);
        clock.recordPacket(10020);
        check(!clock.shouldSplit(11220), "Exactly 1200 ms keeps the current interval");
        check(clock.shouldSplit(11221), "First packet beyond silence must split before append");
        CaptureInterval.Snapshot first = clock.snapshot();
        check(first.startedAt() == 10000 && first.endedAt() == 10020, "Capture bounds never become emission time");
        check(!clock.shouldSplit(11221), "Snapshot clears all timing state");
        clock.recordPacket(11221);
        CaptureInterval.Snapshot second = clock.snapshot();
        check(second.startedAt() == 11221 && second.endedAt() == 11221, "New segment has independent bounds");
        clock.recordPacket(20000);
        clock.recordPacket(20000);
        rejects(() -> clock.recordPacket(19999));
        CaptureInterval.Snapshot sameMillisecond = clock.snapshot();
        check(sameMillisecond.startedAt() == 20000 && sameMillisecond.endedAt() == 20000,
                "Invalid backward clock never rewrites accepted capture bounds");
        clock.recordPacket(30000);
        clock.clear();
        rejects(clock::snapshot);
        check(!clock.shouldSplit(90000), "Stop/empty cleanup leaves no old interval");
        clock.recordPacket(90000);
        check(clock.snapshot().startedAt() == 90000, "Post-stop capture starts fresh");
        rejects(() -> new CaptureInterval(-1));
        System.out.println("{\"ok\":true,\"assertions\":" + assertions + "}");
    }
}
