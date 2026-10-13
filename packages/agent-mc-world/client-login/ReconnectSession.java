package org.cortico.minecraft;

/** Retries only a disconnected screen from an explicitly armed account. */
public final class ReconnectSession {
    private final long[] delays;
    private boolean enabled;
    private int attempts;
    private Object screen;
    private Object attemptedScreen;
    private long due;

    public ReconnectSession() { delays = new long[] {3000, 10000, 30000, 60000}; }
    public void arm() { enabled = true; online(); }
    public void block() { enabled = false; cancel(); }
    public void online() { attempts = 0; screen = null; attemptedScreen = null; due = 0; }
    public void cancel() { screen = null; due = 0; }
    public int attempts() { return attempts; }
    public boolean tick(Object disconnectedScreen, long now) {
        if (!enabled || disconnectedScreen == null) { cancel(); return false; }
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
