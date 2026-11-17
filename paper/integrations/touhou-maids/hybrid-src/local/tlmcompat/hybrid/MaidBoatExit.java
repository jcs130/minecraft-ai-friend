package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.FunctionTool;
import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.parameter.ObjectParameter;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.request.ChatCompletion;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.vehicle.Boat;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/** A short exit onto loaded, dry ground, with no model-supplied target. */
final class MaidBoatExit {
    static final String TOOL = "dismount_boat";
    private static final double MAX_BOAT_SPEED_SQUARED = 0.03 * 0.03;
    private static final int MAX_STEP = 3;

    private MaidBoatExit() {}

    static void offer(ChatCompletion request) {
        request.addTool(FunctionTool.create().setName(TOOL)
            .setDescription("从已停稳的船离开，落在服务器确认的近处干燥岸边，随后由原生跟随继续行动。没有参数。")
            .setParameters(ObjectParameter.create()).build());
    }

    static Location findLanding(EntityMaid maid, Player partner) {
        if (!(maid.getVehicle() instanceof Boat boat) || !boat.isAlive()
                || boat.getDeltaMovement().horizontalDistanceSqr() > MAX_BOAT_SPEED_SQUARED
                || !maid.isAlive() || maid.isRemoved() || maid.isNoAi() || maid.isLeashed()
                || maid.isSleeping() || maid.isMaidInSittingPose() || maid.isHomeModeEnable()
                || !MaidCompanionActions.IDLE.equals(maid.getTask().getUid().toString())
                || partner.isInsideVehicle() || !partner.isOnGround() || partner.isInWater()
                || !partner.getWorld().equals(maid.getBukkitEntity().getWorld())) {
            return null;
        }
        // The maid is one passenger. Any other passenger can still be using this boat.
        if (boat.getPassengers().size() != 1 || boat.getFirstPassenger() != maid) return null;
        Location origin = maid.getBukkitEntity().getLocation();
        int walkBeyond;
        try {
            walkBeyond = NativeMaidFollowSupport.limits(maid).walkBeyond();
        } catch (IllegalArgumentException invalid) {
            return null;
        }
        if (origin.distanceSquared(partner.getLocation()) <= walkBeyond * walkBeyond) return null;

        Location nearest = null;
        double nearestDistance = MAX_STEP * MAX_STEP;
        var world = origin.getWorld();
        for (BlockPos pos : BlockPos.betweenClosed(
                maid.blockPosition().offset(-MAX_STEP, -1, -MAX_STEP),
                maid.blockPosition().offset(MAX_STEP, 1, MAX_STEP))) {
            var landing = new Location(world, pos.getX() + 0.5, pos.getY(), pos.getZ() + 0.5,
                origin.getYaw(), origin.getPitch());
            double distance = origin.distanceSquared(landing);
            if (distance < nearestDistance && Math.abs(landing.getY() - origin.getY()) <= 1
                    && NativeMaidOwnerTravel.safeBlock(landing) && accessible(maid, boat, landing)) {
                nearest = landing;
                nearestDistance = distance;
            }
        }
        return nearest;
    }

    private static boolean accessible(EntityMaid maid, Boat boat, Location landing) {
        Vec3 target = new Vec3(landing.getX(), landing.getY(), landing.getZ());
        Vec3 step = target.subtract(maid.position());
        var level = maid.level();
        var box = maid.getBoundingBox().move(step);
        var crossing = box.minmax(maid.getBoundingBox());
        if (boat.getBoundingBox().intersects(box.inflate(0.1))
                || !level.hasChunksAt(BlockPos.containing(crossing.minX, crossing.minY, crossing.minZ),
                                     BlockPos.containing(crossing.maxX, crossing.maxY, crossing.maxZ))
                || !level.noCollision(maid, box)) return false;
        double crossingY = Math.max(maid.getY(), target.y) + 0.35;
        Vec3 from = new Vec3(maid.getX(), crossingY, maid.getZ());
        Vec3 to = new Vec3(target.x, crossingY, target.z);
        return level.clip(new ClipContext(from, to, ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, maid))
            .getType() == HitResult.Type.MISS;
    }
}
