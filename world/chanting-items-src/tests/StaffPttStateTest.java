import dev.qiandeng.chanting.client.StaffPttState;

/** Offline state transitions; deliberately no microphone or Minecraft startup. */
public final class StaffPttStateTest {
    private static int assertions;
    private static void check(boolean value, String message) {
        assertions++;
        if (!value) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        StaffPttState state = new StaffPttState();
        long now = 1_000_000_000L;
        check(!state.isHeld(now), "initial client state must be closed");
        state.update(true, now);
        check(state.isHeld(now), "active staff use must open PTT");
        check(state.isHeld(now + StaffPttState.MAX_AGE_NANOS), "hold lease includes its exact boundary");
        check(!state.isHeld(now + StaffPttState.MAX_AGE_NANOS + 1), "a stalled client must stop extending PTT");
        check(!state.isHeld(now - 1), "future snapshots are not valid");
        state.update(false, now + 10);
        check(!state.isHeld(now + 10), "release or invalid game context must close immediately");
        state.update(true, now + 20);
        check(state.isHeld(now + 20), "a new valid use can reopen PTT");
        state.update(false, now + 21);
        check(!state.isHeld(now + 22), "a late microphone poll must observe the latest release");
        // System.nanoTime is allowed to wrap; short real elapsed intervals stay valid.
        state.update(true, Long.MAX_VALUE - 5);
        check(state.isHeld(Long.MIN_VALUE + 5), "short monotonic wrap must remain usable");
        check(!state.isHeld(Long.MIN_VALUE + StaffPttState.MAX_AGE_NANOS), "wrapped stale lease must close");
        System.out.println("StaffPttStateTest: " + assertions + " assertions passed; no audio was captured.");
    }
}
