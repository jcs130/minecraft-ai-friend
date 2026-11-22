package local.qdj.maids.brain;

/** Truth table for the native follow-owner suppression gate (Yui / Kirito stranding fix). */
public final class ExpeditionFollowGateTest {
    private static void check(boolean wanted, boolean got) {
        if (wanted != got) throw new AssertionError("expected " + wanted + ", got " + got);
    }
    public static void main(String[] args) {
        // Fully active expedition: native follow-owner stays suppressed, expedition drives movement.
        check(true,  ExpeditionFollowGate.suppressNativeFollow(true,  true,  true));
        // Leader body destroyed / unavailable (Kirito relay-1): resume native follow-owner, do not strand.
        check(false, ExpeditionFollowGate.suppressNativeFollow(true,  false, true));
        check(false, ExpeditionFollowGate.suppressNativeFollow(true,  false, false));
        // Leader in another dimension (Yui overworld vs Kirito aincrad): resume native follow-owner.
        check(false, ExpeditionFollowGate.suppressNativeFollow(true,  true,  false));
        // Not delegated: native follow-owner always runs.
        check(false, ExpeditionFollowGate.suppressNativeFollow(false, true,  true));
        check(false, ExpeditionFollowGate.suppressNativeFollow(false, false, false));
        System.out.println("ExpeditionFollowGateTest ok");
    }
}