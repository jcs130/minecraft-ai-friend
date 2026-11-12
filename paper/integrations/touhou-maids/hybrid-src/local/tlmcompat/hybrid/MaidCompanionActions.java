package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.FunctionTool;
import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.parameter.ObjectParameter;
import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.parameter.StringParameter;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.request.ChatCompletion;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.item.EntityChair;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskFishing;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import com.github.tartaricacid.touhoulittlemaid.config.subconfig.MaidConfig;
import com.google.gson.JsonObject;
import java.util.Set;
import local.tlmcompat.core.CompatibilityException;
import net.minecraft.core.BlockPos;
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
        mode.setDescription("follow：结束驻守和当前工作，跟随伙伴。guard：随行护卫。wait：短停60秒后恢复跟随，期间可随伙伴传送。fish：执行原生钓鱼任务，需要主手鱼竿及水边可用的椅子或船。");
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
        return maid.getVehicle() instanceof EntityChair || maid.getVehicle() instanceof Boat;
    }

    static boolean fishingRod(EntityMaid maid) {
        return maid.getMainHandItem().canPerformAction(ItemAbilities.FISHING_ROD_CAST);
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
        if (mode.equals("fish") && !fishingRod(maid)) {
            throw new CompatibilityException("fishing_rod_required", "请先在女仆装备菜单给主手装鱼竿，再到水边找空椅子或船。此次未切换任务。");
        }
        // Dispatch authenticates the real owner, validates the loaded original entity and
        // reserves a durable receipt before modifying it. Repeated IDs never reapply.
        JsonObject receipt = plugin.companionMode(partner, maid.getUUID(), operation, mode);
        JsonObject result = new JsonObject();
        result.addProperty("mode", mode);
        result.add("status", receipt.get("status"));
        result.add("operationId", receipt.get("operationId"));
        result.add("current", facts(maid, partner));
        result.addProperty("goalCompleted", false);
        return result;
    }
}
