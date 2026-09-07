package dev.qiandeng.controls;

/** A held input is one action, including while screens open or close. */
public final class PressEdge {
    private boolean held;

    public boolean update(boolean down) {
        boolean pressed = down && !held;
        held = down;
        return pressed;
    }
}
