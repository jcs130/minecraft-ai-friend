package dev.god.godvoice;

/** Per authenticated speaker sequence ordering, owned under MicCapture's lock. */
final class CaptureFence {
    private long floor = -1, highest = -1;
    private boolean blocked;
    void hold() { blocked = true; }
    void release() { blocked = false; }
    boolean install(long next) {
        if (next < -1 || next == Long.MAX_VALUE || next < floor || next < highest) return false;
        floor = next; blocked = false; return true;
    }
    boolean observe(long sequence) {
        if (sequence < 0 || sequence <= floor || sequence <= highest) return false;
        highest = sequence; return true;
    }
    boolean recording() { return !blocked; }
}
