import dev.qiandeng.chanting.client.StaffReleaseGate;
import dev.qiandeng.chanting.client.StaffInputEdge;
import dev.qiandeng.chanting.client.StaffContextGuard;

public final class StaffReleaseGateTest {
    private static int assertions;
    private static void check(boolean condition, String message) {
        assertions++;
        if (!condition) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        Object staff = new Object(), swapped = new Object();
        StaffReleaseGate gate = new StaffReleaseGate();
        check(gate.update(null, 0, true, false, false, 0).castSlot() == 0, "idle has no cast");
        check(gate.update(staff, 0, true, true, true, 0).changedMode() == -1 && gate.mode() == 0, "every fresh raise defaults to voice");
        check(gate.update(null, 0, true, false, true, 0).castSlot() == 0, "voice release waits for ASR and never casts a slot");
        gate.update(staff, 0, true, true, true, 0);
        check(gate.update(staff, 1, true, true, true, 1).changedMode() == 1, "first right selects slot one");
        check(gate.update(staff, 2, true, true, true, 0).castSlot() == 0, "holding shortcut mode does not cast");
        check(gate.update(staff, 3, true, true, true, 1).changedMode() == 2, "next edge selects next slot");
        check(gate.update(null, 0, true, false, true, 0).castSlot() == 2, "normal release submits current slot exactly once");
        check(gate.update(null, 0, true, false, true, 0).castSlot() == 0, "subsequent ticks never repeat release");
        check(gate.update(staff, 0, true, true, true, 0).changedMode() == -1 && gate.mode() == 0, "next gesture does not inherit shortcut mode");
        check(gate.update(staff, 1, true, true, true, -1).changedMode() == 8, "left from voice reaches slot eight");
        check(gate.update(staff, 2, true, true, true, 1).changedMode() == 0, "right from eight returns to voice");
        check(gate.update(null, 0, true, false, true, 0).castSlot() == 0, "returning to voice restores voice-only release");
        for (int slot = 1; slot <= 8; slot++) {
            gate.update(staff, 0, true, true, true, 0);
            for (int i = 1; i <= slot; i++) gate.update(staff, i, true, true, true, 1);
            check(gate.update(null, 0, true, false, true, 0).castSlot() == slot, "all eight slots reachable: " + slot);
        }
        gate.update(staff, 0, true, true, true, 1);
        check(gate.update(null, 0, false, false, true, 0).castSlot() == 0, "GUI/focus/death cancellation never releases skill");
        check(gate.update(null, 0, true, false, true, 0).castSlot() == 0, "closing GUI cannot replay cancelled release");
        gate.update(staff, 0, true, true, true, 1);
        check(gate.update(null, 0, true, false, false, 0).castSlot() == 0, "lost or changed staff cannot cast");
        gate.update(staff, 0, true, true, true, 1);
        check(gate.update(null, 0, true, true, true, 0).castSlot() == 0, "interrupted use while trigger stays held is not release");
        gate.update(staff, 5, true, true, true, 1);
        gate.update(swapped, 6, true, true, true, 0);
        check(gate.mode() == 0, "different ItemStack resets to voice");
        gate.update(staff, 10, true, true, true, 1);
        gate.update(staff, 0, true, true, true, 0);
        check(gate.mode() == 0, "same ItemStack use timer reset starts new voice gesture");

        StaffInputEdge edge = new StaffInputEdge();
        check(!edge.update(false, true), "out-of-context input never selects");
        check(!edge.update(true, true), "held-before-raise is not a new selection");
        check(!edge.update(true, false) && edge.update(true, true), "neutral then press selects");
        check(!edge.update(true, true), "holding shoulder never repeats");
        edge.update(false, false);
        check(!edge.update(true, true), "GUI-masked held key does not select on return");

        StaffContextGuard context = new StaffContextGuard();
        check(!context.update(false, true, 0), "opening menu without staff history sends no cancel");
        check(!context.update(true, false, 100), "active gesture does not cancel");
        check(!context.update(false, false, 200), "ordinary release preserves ASR grace");
        check(context.update(false, true, 8_000_000_100L), "GUI at eight-second grace boundary cancels");
        check(!context.update(false, true, 8_000_000_101L), "same GUI cannot cancel twice");
        context.update(true, false, 10_000_000_000L);
        check(!context.update(false, true, 18_000_000_001L), "expired history produces no cancellation");
        context.update(true, false, 20_000_000_000L);
        context.reset();
        check(!context.update(false, true, 20_000_000_001L), "connection reset prevents cross-server cancellation");
        context.update(true, false, Long.MAX_VALUE - 10);
        check(context.update(false, true, Long.MIN_VALUE + 10), "nanoTime wrap preserves a recent gesture");
        System.out.println("{\"ok\":true,\"assertions\":" + assertions + "}");
    }
}
