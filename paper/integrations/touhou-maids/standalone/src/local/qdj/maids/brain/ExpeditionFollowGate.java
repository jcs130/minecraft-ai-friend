package local.qdj.maids.brain;

/**
 * Decides whether the native TLM follow-owner task stays suppressed for a resident.
 * Suppression is only safe while the expedition can actually drive movement: the guard
 * must be delegated, the leader entity must be present, and both must share a dimension.
 * If any condition fails the native follow-owner task resumes so the maid follows her
 * owner instead of stranding (neither following the owner nor the absent leader).
 */
public final class ExpeditionFollowGate {
    private ExpeditionFollowGate() {}

    public static boolean suppressNativeFollow(boolean delegated, boolean leaderAvailable, boolean sameDimension) {
        return delegated && leaderAvailable && sameDimension;
    }
}