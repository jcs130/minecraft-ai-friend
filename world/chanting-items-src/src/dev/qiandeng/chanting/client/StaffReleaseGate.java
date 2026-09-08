package dev.qiandeng.chanting.client;

/** One release submission, only after deliberately switching away from voice. */
public final class StaffReleaseGate {
    public record Result(int castSlot, int changedMode, boolean began) {}
    private Object gesture;
    private int lastTicks;
    private int mode;

    public int mode() { return mode; }
    public void reset() { gesture = null; mode = 0; }

    public Result update(Object currentGesture, int useTicks, boolean contextValid,
                         boolean useDown, boolean sameStaffHeld, int direction) {
        if (direction < -1 || direction > 1) throw new IllegalArgumentException("invalid direction");
        if (!contextValid) { reset(); return new Result(0, -1, false); }
        if (currentGesture != null && useDown) {
            boolean began = gesture != currentGesture || useTicks < lastTicks;
            if (began) {
                gesture = currentGesture; mode = 0;
            }
            lastTicks = useTicks;
            if (direction != 0) mode = Math.floorMod(mode + direction, 9);
            return new Result(0, direction != 0 ? mode : -1, began);
        }
        int cast = gesture != null && !useDown && sameStaffHeld ? mode : 0;
        reset();
        return new Result(cast, -1, false);
    }
}
