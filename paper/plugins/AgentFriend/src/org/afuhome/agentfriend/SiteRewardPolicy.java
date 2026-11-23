package org.afuhome.agentfriend;

/** Status of the one durable reward slot for a player and expedition site. */
final class SiteRewardPolicy {
    static String status(String run, String day, String pendingRun, String claimedRun, String claimedDay) {
        if (run.equals(pendingRun)) return "ready";
        if (run.equals(claimedRun)) return "claimed";
        if (pendingRun != null) return "previous_reward_pending";
        if (day.equals(claimedDay)) return "daily_limit";
        return "eligible";
    }

    static boolean relicEligible(boolean bossParticipant, boolean earned, boolean pending, boolean replay) {
        return bossParticipant && !earned && !pending && !replay;
    }

    private SiteRewardPolicy() {}
}
