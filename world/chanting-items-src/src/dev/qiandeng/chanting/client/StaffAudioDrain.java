package dev.qiandeng.chanting.client;

/** Counts already queued microphone samples, without reading a partial frame or blocking. */
public final class StaffAudioDrain {
    public enum State { PENDING, READY, FAILED }
    private long epoch = -1;
    private int remaining;
    public State update(long token, int frameSamples, int queuedSamples) {
        if (frameSamples <= 0 || queuedSamples < 0) return State.FAILED;
        if (epoch != token) { epoch = token; remaining = queuedSamples; }
        else remaining = Math.max(0, remaining - frameSamples);
        if (remaining > 48_000) return State.FAILED;
        return remaining == 0 ? State.READY : State.PENDING;
    }
}
