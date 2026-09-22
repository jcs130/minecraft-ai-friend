package dev.qiandeng.irons;

import java.util.function.Supplier;

/** Synchronous native command stack only. Never persists or grants a later tick permission. */
public final class TownCommandScope {
    private static final ThreadLocal<Boolean> ACTIVE = new ThreadLocal<>();
    private TownCommandScope() {}
    public static boolean active() { return Boolean.TRUE.equals(ACTIVE.get()); }
    public static <T> T call(boolean hasEntity, boolean permissionFour, Supplier<T> nativeCommand) {
        Boolean previous = ACTIVE.get();
        ACTIVE.set(!hasEntity && permissionFour);
        try { return nativeCommand.get(); }
        finally {
            if (previous == null) ACTIVE.remove();
            else ACTIVE.set(previous);
        }
    }
}
