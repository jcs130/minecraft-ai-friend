package dev.qiandeng.chanting;

/** Server-thread session; shortcut mode changes never wait for the audio channel. */
public final class StaffAudioSession {
    private final String id;
    private int mode, revision;
    private boolean ready, ended;
    private String endPhase = "";
    public StaffAudioSession(String id) { this.id = id; }
    public String id() { return id; }
    public int revision() { return revision; }
    public int mode() { return mode; }
    public boolean ready() { return ready; }
    public boolean select(int slot) {
        if (ended || slot < 0 || slot > 8 || slot == mode) return false;
        mode = slot; revision++; ready = false; return true;
    }
    public boolean matches(String nonce, int rev, long floor) {
        return !ended && !ready && mode == 0 && id.equals(nonce) && revision == rev && floor >= -1 && floor < Long.MAX_VALUE;
    }
    public void confirm() { ready = true; }
    public boolean end(String phase) {
        if (endPhase.equals("cancel") || endPhase.equals(phase)) return false;
        ended = true; endPhase = phase; return true;
    }
}
