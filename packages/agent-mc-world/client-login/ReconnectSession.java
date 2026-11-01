package org.cortico.minecraft;

/** Retries only a disconnected screen from an explicitly armed account. */
public final class ReconnectSession {
    private final long[] delays;
    private boolean enabled;
    private int attempts;
    private Object screen;
    private Object attemptedScreen;
    private long due;
    private boolean onlineObserved;
    private long onlineSince;
    private static final long STABLE_AUTHORIZED_MS = 30_000;

    public ReconnectSession() { delays = new long[] {3000, 10000, 30000, 60000}; }
    public void arm() { enabled = true; cancel(); }
    public void block() { enabled = false; cancel(); }
    /** A brief successful login followed by a kick must retain the failure budget. */
    public void online(long now) {
        if (!enabled) { cancel(); return; }
        screen = null; attemptedScreen = null; due = 0;
        if (!onlineObserved || now < onlineSince) { onlineSince = now; onlineObserved = true; }
        if (now - onlineSince >= STABLE_AUTHORIZED_MS) attempts = 0;
    }
    public void online() { online(System.nanoTime() / 1_000_000); }
    public void cancel() { screen = null; due = 0; onlineObserved = false; }
    public int attempts() { return attempts; }
    public int maximumAttempts() { return delays.length; }
    public boolean exhausted() { return attempts >= maximumAttempts(); }
    public boolean tick(Object disconnectedScreen, long now) {
        onlineObserved = false;
        if (!enabled || exhausted() || disconnectedScreen == null) { cancel(); return false; }
        if (disconnectedScreen == attemptedScreen) return false;
        if (screen != disconnectedScreen) {
            screen = disconnectedScreen;
            due = now + delays[Math.min(attempts, delays.length - 1)];
        }
        if (now < due) return false;
        attempts++;
        attemptedScreen = disconnectedScreen;
        cancel();
        return true;
    }
}
