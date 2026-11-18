package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.api.task.IAttackTask;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskAttack;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskBowAttack;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskCrossBowAttack;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskDanmakuAttack;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskTridentAttack;
import java.util.List;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;

/** Select the TLM task that can drive a real equipped or carried weapon. */
public final class NativeCombatTasks {
    private static final List<ResourceLocation> SPECIALIZED = List.of(TaskBowAttack.UID, TaskCrossBowAttack.UID,
        TaskDanmakuAttack.UID, TaskTridentAttack.UID);

    private NativeCombatTasks() {}

    private static boolean addon(IAttackTask task) {
        // Some built-in chores expose attack helpers for operating on animals.
        return !task.getUid().getNamespace().equals(TaskAttack.UID.getNamespace());
    }

    public static IAttackTask forWeapon(EntityMaid maid, ItemStack item, boolean equipped) {
        if (item.isEmpty()) return null;
        for (var id : SPECIALIZED) {
            if (TaskManager.getTaskMap().get(id) instanceof IAttackTask task && matches(maid, item, task)) return task;
        }
        // Add-ons can have their own ammo, resources and offhand requirements. Read
        // those predicates on the actual loadout before letting the task take over.
        if (equipped) {
            for (var registered : TaskManager.getTaskIndex()) {
                if (registered instanceof IAttackTask task && addon(task) && matches(maid, item, task)
                    && task.getConditionDescription(maid).stream().allMatch(c -> c.getSecond().test(maid))) return task;
            }
        }
        if (TaskManager.getTaskMap().get(TaskAttack.UID) instanceof IAttackTask task && matches(maid, item, task)) return task;
        return null;
    }

    private static boolean matches(EntityMaid maid, ItemStack item, IAttackTask task) {
        return task.isEnable(maid) && task.isWeapon(maid, item);
    }
}
