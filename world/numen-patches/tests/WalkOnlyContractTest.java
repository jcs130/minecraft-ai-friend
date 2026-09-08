import com.dwinovo.numen.core.pathing.execute.WalkOnlyNavigation;
import com.dwinovo.numen.core.pathing.settings.NavSettings;
import com.dwinovo.numen.core.task.move.MoveToTaskRecord;
import com.dwinovo.numen.core.tools.work.MoveToTool;
import com.dwinovo.numen.task.TaskRecord;
import com.google.gson.Gson;
import java.util.Map;

/** Real compiled task records and click guard, no Minecraft world or account. */
public final class WalkOnlyContractTest {
    private static int assertions;
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
        assertions++;
    }
    public static void main(String[] args) {
        MoveToTaskRecord legacy = new MoveToTaskRecord("legacy", 500, 2.0, null, 4.0, null);
        MoveToTaskRecord strict = new MoveToTaskRecord("strict", 500, 2.0, null, 4.0, null, true);
        MoveToTaskRecord second = new MoveToTaskRecord("second", 500, 3.0, null, 5.0, null, true);
        check(!legacy.walkOnly, "Existing task changed behavior");
        check(!WalkOnlyNavigation.isWalkOnly(legacy), "Legacy reflex policy changed");
        check(!WalkOnlyNavigation.isWalkOnly(null), "Unbound reflex policy changed");
        check(WalkOnlyNavigation.isWalkOnly(strict), "Strict movement omitted reflex guard");
        check(strict.walkOnly, "Strict mode lost in task record");
        check(!WalkOnlyNavigation.blockInteraction((TaskRecord) strict, false), "Ordinary walking blocked");
        check(!strict.walkInteractionBlocked, "No click falsely marked blocked");
        check(WalkOnlyNavigation.blockInteraction((TaskRecord) strict, true), "Prohibited click not blocked");
        check(strict.walkInteractionBlocked, "Blocked click not reported to task");
        check(!second.walkInteractionBlocked, "Blocked state leaked to another task");
        check(!WalkOnlyNavigation.blockInteraction((TaskRecord) legacy, true), "Legacy task blocked");
        check(!WalkOnlyNavigation.blockInteraction((TaskRecord) null, true), "Absent task blocked");
        check(NavSettings.get().allowBreak && NavSettings.get().allowPlace, "Global navigation settings mutated");
        Gson gson = new Gson();
        MoveToTaskRecord copy = gson.fromJson(gson.toJson(strict), MoveToTaskRecord.class);
        check(copy.walkOnly && copy.walkInteractionBlocked, "Serialized record lost policy");
        Map<?, ?> properties = (Map<?, ?>) new MoveToTool().parameterSchema().get("properties");
        check("boolean".equals(((Map<?, ?>) properties.get("walk_only")).get("type")), "MCP schema missing boolean policy");
        java.util.UUID body = java.util.UUID.randomUUID();
        java.util.UUID other = java.util.UUID.randomUUID();
        WalkOnlyNavigation.recordResult(body, second, Map.of("final_x", 2.0), "pending");
        check(WalkOnlyNavigation.lastResult(body) == null, "Pending task advertised as finished");
        second.setState(com.dwinovo.numen.task.TaskState.FAILED);
        WalkOnlyNavigation.recordResult(body, second, Map.of("final_x", 2.0), "wall blocks route");
        Map<String, Object> receipt = WalkOnlyNavigation.lastResult(body);
        check(Boolean.FALSE.equals(receipt.get("success")), "Failure advertised as success");
        check(second.publicId().equals(receipt.get("task_id")), "Receipt task identity lost");
        check(WalkOnlyNavigation.EPOCH.equals(receipt.get("navigation_epoch")), "Receipt lacks server epoch");
        check(WalkOnlyNavigation.lastResult(other) == null, "Receipt leaked across bodies");
        for (int i = 0; i < 33; i++) WalkOnlyNavigation.recordResult(java.util.UUID.randomUUID(), second, Map.of(), "bounded");
        check(WalkOnlyNavigation.lastResult(body) == null, "Result cache was not bounded");
        System.out.println("{\"ok\":true,\"assertions\":" + assertions
                + ",\"scope\":\"compiled task isolation, execution click guard, serialization and tool schema; live pathing pending\"}");
    }
}
