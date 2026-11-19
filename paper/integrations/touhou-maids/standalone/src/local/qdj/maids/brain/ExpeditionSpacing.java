package local.qdj.maids.brain;

/** Distances in blocks and durations in milliseconds. One instance per configured follower. */
final class ExpeditionSpacing {
    enum Step { NEAR, WALK, WAIT, REJOIN }
    static final int START = 8, STOP = 4, FAR = 64;
    static final long GRACE = 5_000, STALLED = 12_000, RETRY = 30_000;
    private String leg;
    private boolean following;
    private double best;
    private long farSince = -1, lastProgress, nextAttempt;

    void pause() {
        following = false;
        leg = null;
        farSince = -1;
    }

    Step sample(String dimensionPair, boolean sameWorld, double gap, boolean advancing, long now) {
        if ((sameWorld && gap <= STOP) || (sameWorld && !following && gap <= START)) {
            pause();
            return Step.NEAR;
        }
        if (!following || !dimensionPair.equals(leg)) {
            following = true;
            leg = dimensionPair;
            lastProgress = now;
            farSince = -1;
            best = gap;
        }
        if (sameWorld && (advancing || gap < best - 0.75)) {
            best = gap;
            lastProgress = now;
        }
        // Someone passing through a portal or a distant room gets time to settle.
        // A moving leader cannot reset a follower's lack of progress indefinitely.
        boolean separated = !sameWorld || gap > FAR;
        if (!separated) farSince = -1;
        else if (farSince < 0) farSince = now;
        boolean stuck = sameWorld && gap > START && now - lastProgress >= STALLED;
        if (now >= nextAttempt && (separated ? now - farSince >= GRACE : stuck)) {
            nextAttempt = now + RETRY;
            return Step.REJOIN;
        }
        return separated ? Step.WAIT : Step.WALK;
    }
}
