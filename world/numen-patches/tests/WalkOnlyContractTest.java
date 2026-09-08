import com.dwinovo.numen.core.pathing.execute.WalkOnlyNavigation;
import com.dwinovo.numen.core.pathing.execute.WalkOnlyArrival;
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
        MoveToTaskRecord xyz = new MoveToTaskRecord("xyz", 500, 2.0, 69.0, 4.0, null, true);
        MoveToTaskRecord originalXyz = new MoveToTaskRecord("old-xyz", 500, 2.0, 69.0, 4.0, null);
        MoveToTaskRecord elevation = new MoveToTaskRecord("elevation", 500, null, 69.0, null, null, true);
        check(xyz.kind == MoveToTaskRecord.Kind.BLOCK && xyz.y == 69.0, "Explicit height lost in original goto contract");
        check(WalkOnlyArrival.isStrict(xyz) && WalkOnlyArrival.isStrict(strict), "XYZ/COLUMN not using strict arrival");
        check(!WalkOnlyArrival.isStrict(originalXyz) && !WalkOnlyArrival.isStrict(legacy), "Ordinary goto arrival changed");
        check(!WalkOnlyArrival.isStrict(elevation), "Other original navigation kinds changed");
        check(WalkOnlyArrival.coordinatesMatch(xyz.kind, 2, 69, 4, 2, 69, 4), "Exact XYZ destination refused");
        check(!WalkOnlyArrival.coordinatesMatch(xyz.kind, 2, 69, 4, 2, 48, 4), "Underwater cell below NPC accepted as XYZ");
        check(!WalkOnlyArrival.coordinatesMatch(xyz.kind, 2, 69, 4, 2, 70, 4), "Wrong floor accepted as XYZ");
        check(!WalkOnlyArrival.coordinatesMatch(xyz.kind, 2, 69, 4, 3, 48, 4), "Horizontal near fallback accepted");
        check(WalkOnlyArrival.coordinatesMatch(strict.kind, 2, 0, 4, 2, 69, 4), "COLUMN cannot choose dry land at another elevation");
        check(WalkOnlyArrival.dryLanding(true, false, false, false, false, true, -0.0784), "Vanilla grounded gravity refused");
        check(WalkOnlyArrival.dryLanding(false, false, false, false, false, true, -0.0784), "Physical sole support fallback refused");
        check(!WalkOnlyArrival.dryLanding(true, true, false, true, false, true, -0.0784), "Underwater sea floor accepted");
        check(!WalkOnlyArrival.dryLanding(false, true, false, true, true, false, 0), "Water surface accepted");
        check(!WalkOnlyArrival.dryLanding(true, false, false, false, true, true, 0), "Wet head accepted");
        check(!WalkOnlyArrival.dryLanding(true, false, true, false, false, true, 0), "Lava endpoint accepted");
        check(!WalkOnlyArrival.dryLanding(true, false, false, false, false, false, 0), "onGround without support accepted");
        check(!WalkOnlyArrival.dryLanding(false, false, false, false, false, false, 0), "Jump apex accepted");
        check(!WalkOnlyArrival.dryLanding(true, false, false, false, false, true, 0.42), "Jumping accepted as stable");
        check(!WalkOnlyArrival.dryLanding(false, false, false, false, false, true, -1), "Fast falling accepted");
        check(!WalkOnlyArrival.dryLanding(true, false, false, false, false, true, Double.NaN), "Non-finite movement accepted");
        var landing = new WalkOnlyArrival.Stability();
        check(!landing.observe(100, true), "One landing tick is insufficient");
        check(!landing.observe(100, true), "Repeated predicate call advanced stability");
        check(!landing.observe(101, true), "Two landing ticks are insufficient");
        check(landing.observe(102, true), "Three consecutive supported ticks did not settle");
        check(!landing.observe(103, false), "Lost support did not reset arrival");
        check(!landing.observe(104, true) && !landing.observe(106, true), "Skipped ticks carried stale landing evidence");
        var shore = new WalkOnlyArrival.Stability();
        check(!shore.observe(200, false), "Last wet step on shore counted as dry");
        check(!shore.observe(201, true) && !shore.observe(202, true), "Shore arrival skipped stable dry ticks");
        check(shore.observe(203, true), "A dry landing after leaving water could not complete");
        check("walk_only_strict_arrival_v2".equals(WalkOnlyArrival.CAPABILITY), "Strict arrival capability changed");
        var slabBody = new net.minecraft.world.phys.AABB(0.2, 64.5, 0.2, 0.8, 66.3, 0.8);
        var slab = new net.minecraft.world.phys.AABB(0, 64, 0, 1, 64.5, 1);
        check(WalkOnlyNavigation.soleProbe(slabBody).intersects(slab), "Half-slab sole contact missed");
        var farmlandBody = new net.minecraft.world.phys.AABB(0.2, 64.9375, 0.2, 0.8, 66.7375, 0.8);
        var farmland = new net.minecraft.world.phys.AABB(0, 64, 0, 1, 64.9375, 1);
        check(WalkOnlyNavigation.soleProbe(farmlandBody).intersects(farmland), "Farmland sole contact missed");
        check(!WalkOnlyNavigation.soleProbe(slabBody.move(0, 1, 0)).intersects(slab), "Air above slab counted as supported");
        System.out.println("{\"ok\":true,\"assertions\":" + assertions
                + ",\"scope\":\"compiled task isolation, click guard, strict XYZ/dry arrival policy and multi-tick settlement; live pathing pending\"}");
    }
}
