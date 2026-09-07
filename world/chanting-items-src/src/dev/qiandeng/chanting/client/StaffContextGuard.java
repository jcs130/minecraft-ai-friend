package dev.qiandeng.chanting.client;

/** Cancel a recent staff gesture on local UI/focus loss, including ASR release grace. */
public final class StaffContextGuard {
    private static final long GRACE_NANOS = 8_000_000_000L;
    private long lastActive;
    private boolean pending;

    public void reset() { pending = false; }

    public boolean update(boolean active, boolean blocked, long now) {
        if (active) { lastActive = now; pending = true; }
        if (!blocked || !pending) return false;
        pending = false;
        long age = now - lastActive;
        return age >= 0 && age <= GRACE_NANOS;
    }
}
