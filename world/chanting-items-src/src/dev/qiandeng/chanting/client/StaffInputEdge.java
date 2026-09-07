package dev.qiandeng.chanting.client;

/** Non-casting UI input: context reentry always requires a neutral sample. */
public final class StaffInputEdge {
    private boolean previousDown, neutralSeen;
    public boolean update(boolean eligible, boolean down) {
        boolean rising = down && !previousDown;
        previousDown = down;
        if (!eligible) { neutralSeen = false; return false; }
        if (!down) { neutralSeen = true; return false; }
        return rising && neutralSeen;
    }
}
