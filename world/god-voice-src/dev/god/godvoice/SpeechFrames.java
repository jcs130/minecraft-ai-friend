package dev.god.godvoice;

import java.util.function.Supplier;

/** SVC needs exactly 960 mono samples per frame. A stop callback alone is not completion. */
final class SpeechFrames implements Supplier<short[]> {
    private final short[] samples;
    private int offset;
    private volatile boolean cancelled;
    private volatile boolean exhausted;

    SpeechFrames(short[] samples) { this.samples = samples; }
    void cancel() { cancelled = true; }
    boolean completed() { return exhausted && !cancelled; }
    @Override public short[] get() {
        if (cancelled) return null;
        if (offset >= samples.length) { exhausted = true; return null; }
        var frame = new short[960];
        int count = Math.min(frame.length, samples.length - offset);
        System.arraycopy(samples, offset, frame, 0, count);
        offset += count;
        return frame;
    }
}
