package dev.qiandeng.maw.taunative;

/** No missing authentication provider may silently authorize an offline body. */
public final class SessionPolicy {
    private SessionPolicy() {}
    public static boolean allowed(boolean currentConnection, boolean joining, boolean providerPresent,
                                  boolean providerAuthorized, boolean onlineMode, boolean qaRequested,
                                  boolean qaMarker, boolean loopback, boolean whitelistEnabled,
                                  boolean whitelisted) {
        if (!currentConnection || joining) return false;
        if (providerPresent) return providerAuthorized;
        if (onlineMode) return true;
        return qaRequested && qaMarker && loopback && whitelistEnabled && whitelisted;
    }
}
