package dev.god.godvoice;

/** Actual recorder ordering plus packet-interval state, without synthetic Opus. */
public class CaptureFenceTest {
    static int n;
    static void check(boolean v, String label) { n++; if (!v) throw new AssertionError(label); }
    public static void main(String[] args) {
        var f = new CaptureFence(); var interval = new CaptureInterval(1200);
        check(f.recording() && f.observe(0), "independent PTT starts normally"); interval.recordPacket(100);
        check(!f.observe(0) && !f.observe(-1), "duplicate and negative audio ignored");
        f.hold(); interval.clear();
        check(!f.recording() && f.observe(1), "raising staff suppresses old tail but tracks highest seq");
        check(!f.install(0), "floor below already received tail rejected");
        check(f.install(2) && f.recording(), "real stop sequence floor unlocks voice");
        check(!f.observe(1) && !f.observe(2), "late PCM and late empty stop below fence ignored");
        check(f.observe(3), "first new voice frame accepted"); interval.recordPacket(200);
        check(f.observe(4), "new empty native stop accepted");
        var first = interval.snapshot();
        check(first.startedAt() == 200 && first.endedAt() == 200, "empty stop snapshots immediately, without 1200ms fallback");
        f.hold(); interval.clear(); check(f.observe(5) && !f.recording(), "shortcut tail cannot record");
        check(f.install(6), "fast return accepts subsequent stop floor");
        check(!f.observe(4) && !f.observe(6), "late former stop cannot flush next sentence");
        check(f.observe(7), "returned sentence first PCM"); interval.recordPacket(220);
        check(!interval.shouldSplit(221), "rapid return is well under silence threshold");
        var next = interval.snapshot(); check(next.startedAt() == 220, "new sentence starts at its own first frame");
        check(!f.install(5) && !f.install(Long.MAX_VALUE), "floor rollback and overflow sentinel rejected");
        f.hold(); f.release(); check(f.recording() && f.observe(8), "normal release restores independent PTT");
        var other = new CaptureFence(); check(other.observe(0), "another actor has independent sequence");
        var silent = new CaptureFence(); silent.hold(); check(silent.install(-1), "no audio yet is a valid native empty history");
        System.out.println("{\"ok\":true,\"assertions\":" + n + "}");
    }
}
