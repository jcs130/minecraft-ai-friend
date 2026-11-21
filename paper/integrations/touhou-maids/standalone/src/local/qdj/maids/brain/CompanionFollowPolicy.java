package local.qdj.maids.brain;

/** Follow one authorized leader. The caller owns authorization and executes any recovery. */
public final class CompanionFollowPolicy {
    public enum Step { NEAR, WALK, WAIT, REJOIN }

    public record Profile(double walkBeyond, double stopWithin, double recoverBeyond,
                          double farBeyond, long settleMillis, long stalledMillis,
                          long retryMillis, boolean resetWhenLeaderMoves) {
        public Profile {
            if (!Double.isFinite(walkBeyond) || !Double.isFinite(stopWithin) || !Double.isFinite(recoverBeyond)
                    || Double.isNaN(farBeyond) || walkBeyond < 3 || stopWithin < 2 || stopWithin > walkBeyond
                    || recoverBeyond < walkBeyond || recoverBeyond > 256 || farBeyond < recoverBeyond
                    || settleMillis < 0 || stalledMillis <= 0 || retryMillis <= 0) {
                throw new IllegalArgumentException("Invalid companion follow profile");
            }
        }

        public static Profile owner(double walk, double stop, double recovery) {
            return new Profile(walk, stop, recovery, Double.POSITIVE_INFINITY, 0, 8_000, 15_000, true);
        }

        public static Profile teammate(double walk, double stop, double far) {
            return new Profile(walk, stop, walk, far, 5_000, 12_000, 30_000, false);
        }
    }

    private Profile profile;
    private String leg;
    private double best;
    private long lastProgress, nextAttempt;
    private Long separatedSince;

    public void pause() {
        leg = null;
        separatedSince = null;
    }

    public Step sample(Profile settings, String dimensionPair, boolean sameWorld, double gap,
                       boolean advancing, boolean leaderMoved, long now) {
        if (!settings.equals(profile)) {
            pause();
            profile = settings;
        }
        double boundary = leg == null || !dimensionPair.equals(leg) ? settings.walkBeyond() : settings.stopWithin();
        if (sameWorld && gap <= boundary) {
            pause();
            return Step.NEAR;
        }
        if (!dimensionPair.equals(leg)) {
            leg = dimensionPair;
            lastProgress = now;
            separatedSince = null;
            best = gap;
        }
        if (sameWorld && (advancing || gap < best - .25 || settings.resetWhenLeaderMoves() && leaderMoved)) {
            best = gap;
            lastProgress = now;
        }
        boolean separated = !sameWorld || gap > settings.farBeyond();
        if (!separated) separatedSince = null;
        else if (separatedSince == null) separatedSince = now;
        boolean ready = separated ? now - separatedSince >= settings.settleMillis()
                : gap > settings.recoverBeyond() && now - lastProgress >= settings.stalledMillis();
        if (ready && now >= nextAttempt) {
            nextAttempt = now + settings.retryMillis();
            lastProgress = now;
            return Step.REJOIN;
        }
        return separated ? Step.WAIT : Step.WALK;
    }
}
