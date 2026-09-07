package dev.qiandeng.chanting.client;

/** A short-lived main-thread snapshot consumed by SVC's microphone thread. */
public final class StaffPttState {
    public static final long MAX_AGE_NANOS = 250_000_000L;
    private record Snapshot(boolean held, long sampledAt) { }
    private volatile Snapshot snapshot = new Snapshot(false, 0L);

    public void update(boolean held, long nowNanos) {
        snapshot = new Snapshot(held, nowNanos);
    }

    public boolean isHeld(long nowNanos) {
        Snapshot current = snapshot;
        long age = nowNanos - current.sampledAt();
        // A paused/stalled client must not leave a microphone latched on.
        return current.held() && age >= 0 && age <= MAX_AGE_NANOS;
    }
}
