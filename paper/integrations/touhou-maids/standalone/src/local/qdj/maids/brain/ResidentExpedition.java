package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Native movement underneath the unified controller's guard delegation. */
final class ResidentExpedition {
    private final UUID leaderId;
    private final CompanionFollow follow = new CompanionFollow();
    private static final CompanionFollow.Distances DEFAULT = new CompanionFollow.Distances(8, 4, 64);
    private UUID lastRequest;
    private String state = "awaiting_observation";
    private String lastTravel;
    private String lastBlock;

    ResidentExpedition(UUID leaderId) { this.leaderId = leaderId; }

    UUID leaderId() { return leaderId; }

    Map<String, Object> describe(EntityMaid maid, MaidCompanions companions) {
        var row = new LinkedHashMap<String, Object>();
        row.put("leaderId", leaderId.toString());
        row.put("state", maid == null ? "body_unavailable" : state);
        var leader = companions == null ? null : companions.actor(leaderId);
        if (maid != null && CompanionFollow.available(leader)) {
            row.put("leaderDimension", leader.level().dimension().location().toString());
            if (maid.level() == leader.level()) {
                row.put("distanceBlocks", maid.distanceTo(leader));
                row.put("heightGapBlocks", Math.abs(maid.getY() - leader.getY()));
            }
        }
        if (lastRequest != null) row.put("lastTravelRequestId", lastRequest.toString());
        if (lastTravel != null) row.put("lastTravelResult", lastTravel);
        if (lastBlock != null) row.put("lastTravelObstacle", lastBlock);
        if (companions != null && maid != null) {
            try {
                var pending = companions.pendingTravelId(maid.getUUID());
                if (pending != null) row.put("pendingTravelRequestId", pending.toString());
            } catch (IOException unavailable) { row.put("state", "travel_ledger_unavailable"); }
        }
        return row;
    }

    void pause(String reason) {
        follow.pause();
        state = reason;
    }

    void tick(EntityMaid maid, MaidCompanions companions, boolean delegated, boolean fighting, long now) {
        if (companions == null || !delegated || companions.reserved(maid.getUUID())) {
            pause("not_delegated"); return;
        }
        if (companions.pendingTravel(maid.getUUID())) { pause("inspect_original_travel"); return; }
        if (fighting || maid.isHomeModeEnable() || !CompanionFollow.canFollow(maid)
                || !maid.getTask().getUid().toString().equals("touhou_little_maid:idle")) {
            pause("native_activity"); return;
        }
        var leader = companions.actor(leaderId);
        if (!CompanionFollow.available(leader)) { pause("leader_unavailable"); return; }
        CompanionFollow.Distances distances;
        try { distances = CompanionFollow.distances(maid, DEFAULT); }
        catch (IllegalArgumentException invalid) { pause("follow_profile_invalid"); return; }
        var profile = CompanionFollowPolicy.Profile.teammate(distances.walk(), distances.stop(), distances.recovery());
        var step = follow.tick(maid, leader, profile, true, now);
        switch (step) {
            case NEAR -> { state = "nearby"; lastBlock = null; }
            case WALKING -> state = "walking";
            case PATH_BLOCKED -> state = "path_blocked";
            case WAITING -> state = "waiting_to_regroup";
            case REJOIN -> {
                try {
                    var receipt = companions.regroup(maid, leader);
                    lastRequest = UUID.fromString((String)receipt.get("requestId"));
                    lastTravel = String.valueOf(receipt.get("status"));
                    lastBlock = "completed".equals(lastTravel) ? null : String.valueOf(receipt.get("reason"));
                    state = Boolean.TRUE.equals(receipt.get("completed")) ? "teleported" : lastTravel;
                } catch (IllegalArgumentException blocked) {
                    state = blocked.getMessage();
                    lastBlock = state;
                } catch (IOException | RuntimeException uncertain) {
                    state = "travel_unconfirmed_check_ledger";
                    lastBlock = state;
                }
            }
        }
    }
}
