package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.FunctionTool;
import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.parameter.ObjectParameter;
import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.parameter.StringParameter;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.request.ChatCompletion;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.item.EntityChair;
import com.github.tartaricacid.touhoulittlemaid.entity.ai.fishing.FishingTypeManager;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskFishing;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import com.github.tartaricacid.touhoulittlemaid.config.subconfig.MaidConfig;
import com.google.gson.JsonObject;
import java.util.List;
import java.util.Set;
import local.tlmcompat.core.CompatibilityException;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.vehicle.Boat;
import net.neoforged.neoforge.common.ItemAbilities;
import org.bukkit.entity.Player;

/** Small action surface over the existing owner command journal and native companion AI. */
final class MaidCompanionActions {
    static final String TOOL = "set_companion_mode";
    static final String REVISION = "qiandengji_companion_revision";
    static final String WAIT = "qiandengji_companion_wait_until";
    static final String FISHED_AT = "qiandengji_fishing_retrieved_at";
    static final String IDLE = "touhou_little_maid:idle";
    static final Set<String> MODES = Set.of("follow", "guard", "wait", "fish");

    private MaidCompanionActions() {}

    static void tools(ChatCompletion request) {
        var mode = StringParameter.create();
        mode.addEnumValues("follow", "guard", "wait", "fish");
        mode.setDescription("follow：结束驻守和当前工作，跟随伙伴。guard：随行护卫，可从自己的背包选近战、远程或法术装备。wait：短停60秒后恢复跟随，期间可随伙伴传送。fish：执行原生钓鱼任务，需要主手鱼竿及水边可用的椅子或船。");
        request.addTool(FunctionTool.create().setName(TOOL)
            .setDescription("根据伙伴的话和当前现场，实际切换自己的陪伴模式。需要行动就调用工具，不能只口头答应。返回applied仅表示模式设置，未证明走到身边或完成战斗。不能操作其他实体、物品或任意命令。")
            .setParameters(ObjectParameter.create().addProperties("mode", mode)).build());
    }

    static long revision(EntityMaid maid) { return maid.getPersistentData().getLong(REVISION); }

    static void manual(EntityMaid maid) {
        var data = maid.getPersistentData();
        data.putLong(REVISION, revision(maid) + 1);
        data.remove(WAIT);
    }

    static boolean waiting(EntityMaid maid) { return maid.getPersistentData().getLong(WAIT) > 0; }

    static void expireWait(EntityMaid maid, long now) {
        long until = maid.getPersistentData().getLong(WAIT);
        if (until <= 0 || now < until) return;
        if (maid.isMaidInSittingPose() && maid.isHomeModeEnable() && maid.getTask().getUid().toString().equals(IDLE)) {
            follow(maid);
        }
        // A short wait is a mode lease. Its expiration is silent and never starts inference.
        manual(maid);
    }

    static void follow(EntityMaid maid) {
        NativeMaidFollowSupport.limits(maid);
        leaveFishingSeat(maid);
        maid.setTask(TaskManager.getIdleTask());
        maid.setInSittingPose(false);
        maid.restrictTo(BlockPos.ZERO, MaidConfig.MAID_NON_HOME_RANGE.get());
        maid.setHomeModeEnable(false);
        NativeMaidFollowSupport.applyNativeRange(maid);
    }

    static void leaveFishingSeat(EntityMaid maid) {
        if (maid.getTask() instanceof TaskFishing && fishingSeat(maid)) maid.stopRiding();
    }

    private static boolean fishingSeat(EntityMaid maid) {
        return fishingSeat(maid.getVehicle());
    }

    private static boolean fishingSeat(Entity entity) { return entity instanceof EntityChair || entity instanceof Boat; }

    static boolean fishingRod(EntityMaid maid) {
        return maid.getMainHandItem().canPerformAction(ItemAbilities.FISHING_ROD_CAST);
    }

    private static void requireFishingSetup(EntityMaid maid) {
        if (!fishingRod(maid)) {
            throw new CompatibilityException("fishing_rod_required", "请在女仆装备菜单给主手装鱼竿。此次未切换任务。");
        }
        var level = maid.level();
        List<Entity> seats = fishingSeat(maid) ? List.of(maid.getVehicle()) : level.getEntities(maid,
            maid.getBoundingBox().inflate(6, 3, 6), seat -> seat.isAlive() && fishingSeat(seat)
                && !seat.isVehicle() && maid.isWithinRestriction(seat.blockPosition()) && maid.hasLineOfSight(seat));
        if (seats.isEmpty()) {
            throw new CompatibilityException("fishing_seat_required", "请把她带到水边空椅子旁，或先坐上船再钓鱼。附近没有可用座位。此次未切换任务。");
        }
        var rod = maid.getMainHandItem();
        var type = FishingTypeManager.getFishingType(rod);
        for (var seat : seats) {
            BlockPos origin = seat.blockPosition();
            for (BlockPos pos : BlockPos.betweenClosed(origin.offset(-5, -4, -5), origin.offset(5, 2, 5))) {
                if (origin.distSqr(pos) < 36 && level.hasChunkAt(pos) && maid.isWithinRestriction(pos)
                        && type.suitableFishingHook(maid, level, rod, pos)) return;
            }
        }
        throw new CompatibilityException("fishing_water_required", "请选靠近可抛竿水面的椅子或船。座位附近没找到可用水面。此次未切换任务。");
    }

    static JsonObject fishing(EntityMaid maid) {
        JsonObject state = new JsonObject();
        var task = TaskManager.getTaskMap().get(TaskFishing.UID);
        state.addProperty("taskId", TaskFishing.UID.toString());
        state.addProperty("enabled", task != null && task.isEnable(maid));
        state.addProperty("selected", maid.getTask() instanceof TaskFishing);
        state.addProperty("hasRodInMainHand", fishingRod(maid));
        state.addProperty("seated", fishingSeat(maid));
        state.addProperty("hookActive", maid.fishing != null && maid.fishing.isAlive() && maid.fishing.getMaidOwner() == maid);
        state.addProperty("workingNow", maid.getScheduleDetail() == net.minecraft.world.entity.schedule.Activity.WORK);
        long retrieved = maid.getPersistentData().getLong(FISHED_AT);
        if (retrieved > 0) state.addProperty("lastRetrievedAt", java.time.Instant.ofEpochMilli(retrieved).toString());
        state.addProperty("meaning", "原生钓鱼需工作时段、主手鱼竿和水边座位。任务设置、实际抛竿、原生收竿分别观察。鱼获位置可用现场物品或背包核对。");
        return state;
    }

    static String pose(EntityMaid maid) {
        return revision(maid) + ":" + maid.isMaidInSittingPose() + ":" + maid.isHomeModeEnable()
            + ":" + maid.getTask().getUid();
    }

    static JsonObject facts(EntityMaid maid, Player partner) {
        JsonObject facts = new JsonObject();
        facts.addProperty("dimension", maid.level().dimension().location().toString());
        facts.addProperty("partnerWorld", partner.getWorld().getName());
        boolean sameWorld = partner.getWorld().equals(maid.getBukkitEntity().getWorld());
        facts.addProperty("sameWorld", sameWorld);
        if (sameWorld) facts.addProperty("partnerDistance", partner.getLocation().distance(maid.getBukkitEntity().getLocation()));
        facts.addProperty("sitting", maid.isMaidInSittingPose());
        facts.addProperty("homeMode", maid.isHomeModeEnable());
        facts.addProperty("task", maid.getTask().getUid().toString());
        facts.addProperty("health", maid.getHealth());
        facts.addProperty("maxHealth", maid.getMaxHealth());
        facts.addProperty("canMove", maid.canBrainMoving());
        facts.addProperty("nativeDefending", !maid.getPersistentData().getString("qiandengji_auto_defence_task").isEmpty());
        var attack=NativeMaidCompanionSupport.weaponTask(maid);
        facts.addProperty("guardWeaponReady", attack != null);
        if (attack != null) facts.addProperty("equippedAttackTask", attack.getUid().toString());
        facts.add("mainHand", HybridMaidPlugin.item(maid.getMainHandItem()));
        var target = maid.getTarget();
        facts.addProperty("visibleCombatTarget", target != null && target.isAlive() && maid.hasLineOfSight(target));
        facts.add("fishing", fishing(maid));
        facts.addProperty("temporaryWait", waiting(maid));
        facts.addProperty("waitUntilEpochMillis", maid.getPersistentData().getLong(WAIT));
        facts.addProperty("observedAt", java.time.Instant.now().toString());
        var limits = NativeMaidFollowSupport.limits(maid);
        facts.addProperty("walkBeyond", limits.walkBeyond());
        facts.addProperty("stopWithin", limits.stopWithin());
        facts.addProperty("safeReturnBeyond", limits.recoverBeyond());
        facts.addProperty("meaning", "这是实际状态；说话不会移动。跟随按距离执行，未走到身边时不要报告已到达。附近聊天不跨维度，暂未加载不能推断死亡。");
        return facts;
    }

    static JsonObject apply(HybridMaidPlugin plugin, EntityMaid maid, Player partner,
                            String operation, String mode) throws Exception {
        if (!MODES.contains(mode)) throw new IllegalArgumentException("Use follow, guard, wait or fish");
        if (mode.equals("fish")) requireFishingSetup(maid);
        // Dispatch authenticates the real owner, validates the loaded original entity and
        // reserves a durable receipt before modifying it. Repeated IDs never reapply.
        JsonObject receipt = plugin.companionMode(partner, maid.getUUID(), operation, mode);
        JsonObject result = new JsonObject();
        result.addProperty("mode", mode);
        result.add("status", receipt.get("status"));
        result.add("operationId", receipt.get("operationId"));
        JsonObject current = facts(maid, partner);
        boolean armed = plugin.guardWeaponReady(maid);
        current.addProperty("guardWeaponReady", armed);
        result.add("current", current);
        if (mode.equals("guard") && !armed) {
            result.addProperty("nextStep", "已恢复随行。请用 inventory/transfer 或女仆菜单把武器放入可用背包槽；弓弩还需弹药，也可以用 Vortex 学徒法杖。");
        }
        result.addProperty("goalCompleted", false);
        return result;
    }
}
