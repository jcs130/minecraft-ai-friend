package com.dwinovo.numen.task;

import com.dwinovo.numen.Constants;
import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.event.NumenEvents;
import com.google.gson.JsonObject;
import net.minecraft.server.MinecraftServer;

/**
 * 保存任务意图供重启后的对账使用，不将旧工具参数当作新的执行许可。
 * 身体恢复不能证明上次任务的进度或效果；首次 tick 只报告待复核并保留原记录。
 * 已核实的后续意图仍通过正常工具入口下达，不能自动重放消耗性动作。
 */
public final class TaskPersistence {

    /** 恢复通知不属于任何一次新的 tool_call。 */
    private static final String REPLAY_CALL_ID = "restored";

    private TaskPersistence() {}

    /** 记下她现在在做什么(换槽时调)。{@code toolName} 为 null = 记为空闲。 */
    public static void remember(NumenPlayer companion, String toolName, JsonObject args) {
        MinecraftServer server = companion.level().getServer();
        if (server == null) {
            return;
        }
        CompanionRegistry reg = CompanionRegistry.get(server);
        CompanionRegistry.Entry e = reg.find(companion.getUUID());
        if (e == null) {
            return;
        }
        reg.put(companion.getUUID(), e.doing(
                toolName == null ? "" : toolName,
                args == null ? "" : args.toString()));
    }

    /** 她做完了 / 被换掉了 —— 清掉记录,免得重启后凭空捡回一件旧活。 */
    public static void forget(NumenPlayer companion) {
        remember(companion, null, null);
    }

    /** 身体可以恢复，旧动作必须先核对；保留任务记录，不重派也不声称旧效果失败或成功。 */
    public static void restore(NumenPlayer companion) {
        MinecraftServer server = companion.level().getServer();
        if (server == null) {
            return;
        }
        CompanionRegistry.Entry e = CompanionRegistry.get(server).find(companion.getUUID());
        if (e == null || e.taskTool().isBlank()) {
            return;
        }
        String toolName = e.taskTool();
        Constants.LOG.warn("[numen-task] {} 旧任务 {} 待复核，未重放", companion.getUUID(), toolName);
        NumenEvents.taskFinished(companion, REPLAY_CALL_ID + "-" + toolName, toolName, "stopped",
                "saved_task_requires_review：身体已恢复，旧任务未重派；此前进度和效果仍未知。"
                        + "原工具和参数已保留，请先核对实际状态，再明确下达后续任务。");
    }
}
