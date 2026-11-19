package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.ai.behavior.EntityTracker;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.minecraft.world.entity.ai.memory.WalkTarget;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.level.pathfinder.Path;

/** Native movement underneath the unified controller's guard delegation. */
final class ResidentExpedition {
    private final UUID leaderId;
    private final ExpeditionSpacing spacing = new ExpeditionSpacing();
    private WalkTarget walk;
    private Path path;
    private BlockPos pathGoal;
    private UUID lastRequest;
    private String state = "awaiting_observation";
    private String lastTravel;
    private String lastBlock;
    private Vec3 previousPosition, previousDirection;

    ResidentExpedition(UUID leaderId) { this.leaderId = leaderId; }

    Map<String, Object> describe(EntityMaid maid, MaidCompanions companions) {
        var row = new LinkedHashMap<String, Object>();
        row.put("leaderId", leaderId.toString());
        row.put("state", maid == null ? "body_unavailable" : state);
        var leader = companions == null ? null : companions.actor(leaderId);
        if (maid != null && available(leader)) {
            row.put("leaderDimension", leader.level().dimension().location().toString());
            if (maid.level() == leader.level()) row.put("distanceBlocks", maid.distanceTo(leader));
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

    private static boolean available(LivingEntity leader) {
        return leader != null && leader.isAlive() && !leader.isRemoved() && !leader.isSpectator();
    }

    private void releaseWalk(EntityMaid maid) {
        if (walk != null && maid.getBrain().getMemory(MemoryModuleType.WALK_TARGET).orElse(null) == walk) {
            maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);
        }
        if (path != null && maid.getNavigation().getPath() == path) maid.getNavigation().stop();
        walk = null;
        path = null;
        pathGoal = null;
    }

    void pause(EntityMaid maid, String reason) {
        releaseWalk(maid);
        spacing.pause();
        previousPosition = previousDirection = null;
        state = reason;
    }

    private void approach(EntityMaid maid, LivingEntity leader) {
        if (walk == null || maid.getBrain().getMemory(MemoryModuleType.WALK_TARGET).orElse(null) != walk
                || !(walk.getTarget() instanceof EntityTracker tracker) || tracker.getEntity() != leader) {
            walk = new WalkTarget(new EntityTracker(leader, false), .7f, ExpeditionSpacing.STOP);
            maid.getBrain().setMemory(MemoryModuleType.WALK_TARGET, walk);
        }
        // TLM can retain an unrelated idle path even after the brain accepts a
        // WALK_TARGET. Issue a reachable native path and release only our own.
        var navigation = maid.getNavigation();
        var goal = leader.blockPosition();
        if (path == null || navigation.isDone() || navigation.getPath() != path || pathGoal.distSqr(goal) > 4) {
            var next = navigation.createPath(goal, ExpeditionSpacing.STOP);
            if (next == null || !next.canReach() || !navigation.moveTo(next, .9)) {
                state = "path_blocked";
                return;
            }
            path = navigation.getPath();
            pathGoal = goal;
        }
        state = "walking";
    }

    void tick(EntityMaid maid, MaidCompanions companions, boolean delegated, boolean fighting, long now) {
        if (companions == null || !delegated) { pause(maid, "not_delegated"); return; }
        if (companions.pendingTravel(maid.getUUID())) { pause(maid, "inspect_original_travel"); return; }
        if (maid.isMaidInSittingPose() || maid.isHomeModeEnable() || maid.isSleeping() || maid.isNoAi()
                || maid.isPassenger() || maid.isVehicle() || maid.isLeashed() || maid.guiOpening || !maid.canBrainMoving()
                || maid.getPersistentData().getBoolean(ResidentBodyAccess.DOWNED)
                || !maid.getTask().getUid().toString().equals("touhou_little_maid:idle") || maid.getSwimManager().isGoingToBreath()
                || fighting || maid.getTarget() != null || maid.getBrain().hasMemoryValue(MemoryModuleType.ATTACK_TARGET)) {
            pause(maid, "native_activity"); return;
        }
        var leader = companions.actor(leaderId);
        if (!available(leader)) { pause(maid, "leader_unavailable"); return; }
        boolean same = maid.level() == leader.level();
        String leg = maid.level().dimension().location() + ">" + leader.level().dimension().location();
        boolean advancing = same && previousPosition != null && previousDirection != null
                && maid.position().subtract(previousPosition).dot(previousDirection) > .25;
        previousPosition = same ? maid.position() : null;
        previousDirection = same ? leader.position().subtract(maid.position()).normalize() : null;
        var step = spacing.sample(leg, same, same ? maid.distanceTo(leader) : Double.POSITIVE_INFINITY, advancing, now);
        switch (step) {
            case NEAR -> { releaseWalk(maid); state = "nearby"; lastBlock = null; }
            case WALK -> approach(maid, leader);
            case WAIT -> { releaseWalk(maid); state = "waiting_to_regroup"; }
            case REJOIN -> {
                releaseWalk(maid);
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
