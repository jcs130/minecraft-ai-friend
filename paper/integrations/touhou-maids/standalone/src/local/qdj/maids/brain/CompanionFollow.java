package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.util.List;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.Tag;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.ai.behavior.EntityTracker;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.minecraft.world.entity.ai.memory.WalkTarget;
import net.minecraft.world.level.pathfinder.Path;
import net.minecraft.world.phys.Vec3;

/** Shared native navigation for an authorized owner, expedition leader, or active contract leader. */
public final class CompanionFollow {
    public static final String PROFILE = "qiandengji_follow";
    public record Distances(int walk, int stop, int recovery) {}
    public enum Result { NEAR, WALKING, PATH_BLOCKED, WAITING, REJOIN }

    private final CompanionFollowPolicy policy = new CompanionFollowPolicy();
    private LivingEntity currentLeader;
    private EntityMaid currentBody;
    private WalkTarget walk;
    private Path path;
    private BlockPos pathGoal;
    private Vec3 previousPosition, previousDirection, leaderAnchor;

    public static Distances distances(EntityMaid maid, Distances defaults) {
        var data = maid.getPersistentData();
        if (!data.contains(PROFILE)) return defaults;
        if (!data.contains(PROFILE, Tag.TAG_COMPOUND)) throw new IllegalArgumentException("Invalid following profile");
        var profile = data.getCompound(PROFILE);
        for (String field : List.of("schemaVersion", "walkDistance", "stopDistance", "returnDistance")) {
            if (!profile.contains(field, Tag.TAG_INT)) throw new IllegalArgumentException("Following profile requires integer " + field);
        }
        if (profile.getInt("schemaVersion") != 1) throw new IllegalArgumentException("Unsupported following profile version");
        int walk = profile.getInt("walkDistance"), stop = profile.getInt("stopDistance"), recovery = profile.getInt("returnDistance");
        if (walk < 3 || stop < 2 || stop >= walk || recovery < 7 || recovery > 256 || recovery - 4 < walk) {
            throw new IllegalArgumentException("Invalid following distances");
        }
        return new Distances(walk, stop, recovery);
    }

    public static boolean available(LivingEntity leader) {
        return leader != null && !leader.isRemoved() && leader.isAlive() && !leader.isSpectator();
    }

    public static boolean canFollow(EntityMaid maid) {
        return maid.isAlive() && !maid.isRemoved() && !maid.isMaidInSittingPose() && !maid.isSleeping()
            && !maid.isNoAi() && !maid.isPassenger() && !maid.isVehicle() && !maid.isLeashed() && !maid.guiOpening
            && !maid.getPersistentData().getBoolean(ResidentBodyAccess.DOWNED) && maid.canBrainMoving()
            && !maid.getSwimManager().isGoingToBreath() && maid.getTarget() == null
            && !maid.getBrain().hasMemoryValue(MemoryModuleType.ATTACK_TARGET);
    }

    private void releaseWalk() {
        if (currentBody != null && !currentBody.isRemoved()) {
            var brain = currentBody.getBrain();
            if (walk != null && brain.getMemory(MemoryModuleType.WALK_TARGET).orElse(null) == walk) {
                brain.eraseMemory(MemoryModuleType.WALK_TARGET);
            }
            if (path != null && currentBody.getNavigation().getPath() == path) currentBody.getNavigation().stop();
        }
        walk = null;
        path = null;
        pathGoal = null;
    }

    public void pause() {
        releaseWalk();
        policy.pause();
        currentBody = null;
        currentLeader = null;
        previousPosition = previousDirection = leaderAnchor = null;
    }

    /** Carriers with a vanilla owner can let TLM run its own path from the common WALK_TARGET. */
    public Result tick(EntityMaid maid, LivingEntity leader, CompanionFollowPolicy.Profile profile,
                       boolean directPath, long now) {
        if (currentBody != maid || currentLeader != leader) {
            pause();
            currentBody = maid;
            currentLeader = leader;
        }
        boolean sameWorld = maid.level() == leader.level();
        String leg = maid.level().dimension().location() + ">" + leader.level().dimension().location();
        boolean advancing = sameWorld && previousPosition != null
            && maid.position().subtract(previousPosition).dot(previousDirection) > .25;
        boolean leaderMoved = leaderAnchor != null && leader.position().distanceToSqr(leaderAnchor) > 4;
        if (leaderAnchor == null || leaderMoved || advancing) leaderAnchor = leader.position();
        previousPosition = sameWorld ? maid.position() : null;
        previousDirection = sameWorld ? leader.position().subtract(maid.position()).normalize() : null;
        var step = policy.sample(profile, leg, sameWorld, sameWorld ? maid.distanceTo(leader) : Double.POSITIVE_INFINITY,
                                 advancing, leaderMoved, now);
        if (step == CompanionFollowPolicy.Step.WALK) return approach(maid, leader, (int) profile.stopWithin(), directPath);
        releaseWalk();
        return switch (step) {
            case NEAR -> Result.NEAR;
            case WAIT -> Result.WAITING;
            case REJOIN -> Result.REJOIN;
            case WALK -> throw new IllegalStateException();
        };
    }

    private Result approach(EntityMaid maid, LivingEntity leader, int stop, boolean directPath) {
        var brain = maid.getBrain();
        var existing = brain.getMemory(MemoryModuleType.WALK_TARGET).orElse(null);
        if (existing == null || !(existing.getTarget() instanceof EntityTracker tracker)
                || tracker.getEntity() != leader || existing.getCloseEnoughDist() != stop) {
            walk = new WalkTarget(new EntityTracker(leader, false), directPath ? .7f : .5f, stop);
            brain.setMemory(MemoryModuleType.WALK_TARGET, walk);
        }
        if (directPath) {
            // A non-owner can be paired while the native idle AI still has a path to its owner.
            var navigation = maid.getNavigation();
            var goal = leader.blockPosition();
            if (path == null || navigation.isDone() || navigation.getPath() != path || pathGoal.distSqr(goal) > 4) {
                var next = navigation.createPath(goal, stop);
                if (next == null || !next.canReach() || !navigation.moveTo(next, .9)) return Result.PATH_BLOCKED;
                path = navigation.getPath();
                pathGoal = goal;
            }
        }
        return Result.WALKING;
    }
}
