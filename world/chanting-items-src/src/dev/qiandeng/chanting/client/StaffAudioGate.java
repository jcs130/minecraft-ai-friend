package dev.qiandeng.chanting.client;

/** Main/audio-thread handshake. Epochs survive rapid mode changes until the audio
 * thread actually flushes. No timing sleep, Minecraft object, or PTT override. */
public final class StaffAudioGate {
    public record Request(String id, int revision, long floor) { }
    private long epoch, flushedEpoch = -1, deadline;
    private int revision, mode;
    private String id = "";
    private boolean active, sent, ready, rejected;
    private long floor;
    public synchronized void begin(long now) { epoch++; active = true; id = ""; revision = mode = 0; ready = sent = rejected = false; deadline = now + 2_000_000_000L; }
    public synchronized void start(String nonce) { if (active && nonce != null && !nonce.isEmpty() && !id.equals(nonce)) { id = nonce; ready = sent = rejected = false; } }
    public synchronized void select(int slot, long now) { if (!active || slot == mode) return; mode = slot; revision++; epoch++; ready = sent = rejected = false; deadline = now + 2_000_000_000L; }
    public synchronized long pendingFlush() { return active && !rejected && flushedEpoch != epoch ? epoch : -1; }
    public synchronized void flushed(long token, long floor) { if (active && token == epoch) { flushedEpoch = token; this.floor = floor; } }
    public synchronized Request takeRequest(long now) {
        if (failed(now) || !active || rejected || mode != 0 || sent || id.isEmpty() || flushedEpoch != epoch) return null;
        sent = true; return new Request(id, revision, floor);
    }
    public synchronized void acknowledge(String nonce, int rev, long ackFloor, boolean ok, long now) {
        if (failed(now) || !active || rejected || !sent || mode != 0 || !id.equals(nonce) || revision != rev || floor != ackFloor) return;
        ready = ok; rejected = !ok;
    }
    public synchronized boolean ready() { return active && mode == 0 && ready; }
    public synchronized boolean failed(long now) {
        if (active && mode == 0 && !ready && now >= deadline) rejected = true;
        return active && mode == 0 && rejected;
    }
    public synchronized void fail(long token) { if (active && token == epoch) rejected = true; }
    public synchronized void unavailable() { if (active) rejected = true; }
    public synchronized void end() { active = ready = sent = rejected = false; epoch++; id = ""; }
}
