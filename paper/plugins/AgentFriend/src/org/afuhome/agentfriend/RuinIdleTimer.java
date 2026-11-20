package org.afuhome.agentfriend;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** The first empty observation starts the grace period, including after a restart. */
final class RuinIdleTimer {
    private final long delayNanos;
    private final Map<String,Long> emptySince = new HashMap<>();

    RuinIdleTimer(int seconds) {
        if (seconds < 1 || seconds > 86400) throw new IllegalArgumentException("empty-seconds must be 1..86400");
        delayNanos = TimeUnit.SECONDS.toNanos(seconds);
    }

    boolean due(String domain, boolean emptyAndDirty, long now) {
        if (!emptyAndDirty) {
            emptySince.remove(domain);
            return false;
        }
        long since = emptySince.computeIfAbsent(domain, ignored -> now);
        return now - since >= delayNanos;
    }
}
