package dev.qiandeng.maw;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/** Exercises production receipt identity and reservation using Gson, without a running server. */
public final class MenuActionReplayTest {
    private static int checks;
    private static void check(boolean value, String description) {
        checks++;
        if (!value) throw new AssertionError(description);
    }
    private static JsonObject parse(String json) { return JsonParser.parseString(json).getAsJsonObject(); }

    public static void main(String[] args) {
        JsonObject original = parse("{\"requestId\":\"click1\",\"windowId\":3,\"slot\":1,\"button\":0,"
                + "\"playerUuid\":\"own\",\"expectedStateId\":4,\"expectedItemId\":\"minecraft:stone\","
                + "\"expectedCount\":2,\"expectedSnbt\":\"{id:stone,count:2,components:{name:'千灯纪'}}\","
                + "\"expectedCarriedSnbt\":\"\"}");
        var ledger = new MenuActionReplay();
        check(ledger.begin("click1", original).outcome() == MenuActionReplay.Outcome.NEW, "initial reservation");
        check(ledger.begin("click1", original).outcome() == MenuActionReplay.Outcome.IN_PROGRESS,
                "pending write must not execute twice");
        check(ledger.complete("click1", "original-success"), "first completion");
        check(!ledger.complete("click1", "changed-success"), "completed receipt cannot be overwritten");
        for (String field : new String[]{"windowId", "slot", "button", "playerUuid", "expectedStateId",
                "expectedItemId", "expectedCount", "expectedSnbt", "expectedCarriedSnbt"}) {
            JsonObject changed = original.deepCopy();
            changed.addProperty(field, "different");
            check(ledger.begin("click1", changed).outcome() == MenuActionReplay.Outcome.CONFLICT,
                    "full request fingerprint must cover " + field);
            var replay = ledger.begin("click1", original);
            check(replay.outcome() == MenuActionReplay.Outcome.REPLAY && replay.response().equals("original-success"),
                    "conflict must preserve original receipt for " + field);
        }
        JsonObject reordered = parse("{\"expectedCarriedSnbt\":\"\",\"expectedSnbt\":\"{id:stone,count:2,components:{name:'千灯纪'}}\","
                + "\"expectedCount\":2.0,\"expectedItemId\":\"minecraft:stone\",\"expectedStateId\":4,\"playerUuid\":\"own\","
                + "\"button\":0,\"slot\":1,\"windowId\":3,\"requestId\":\"ignored-root-value\"}");
        check(ledger.begin("click1", reordered).outcome() == MenuActionReplay.Outcome.REPLAY,
                "JSON property order and equivalent numeric representation must not create another write");

        // A simulated native hook changes state and then throws. The production
        // handler records an unknown receipt after its pre-mutation reservation.
        var unknown = new MenuActionReplay();
        int mutations = 0;
        if (unknown.begin("unknown1", original).outcome() == MenuActionReplay.Outcome.NEW) {
            mutations++;
            check(unknown.complete("unknown1", "action_outcome_unknown"), "unknown outcome is retained");
        }
        var retry = unknown.begin("unknown1", original);
        if (retry.outcome() == MenuActionReplay.Outcome.NEW) mutations++;
        check(mutations == 1 && retry.outcome() == MenuActionReplay.Outcome.REPLAY &&
                retry.response().equals("action_outcome_unknown"), "unknown receipt must never authorize another mutation");
        check(!unknown.complete("never-reserved", "fake-success"), "completion requires reservation");

        check(new MenuActionReplay().begin("click1", original).outcome() == MenuActionReplay.Outcome.NEW,
                "different player/login ledger is independent");
        var bounded = new MenuActionReplay();
        for (int i = 0; i < 33; i++) {
            check(bounded.begin("id" + i, original).outcome() == MenuActionReplay.Outcome.NEW, "bounded new receipt");
            check(bounded.complete("id" + i, "r" + i), "bounded completion");
        }
        check(bounded.begin("id1", original).outcome() == MenuActionReplay.Outcome.REPLAY,
                "most recent 32 receipts remain protected");
        check(bounded.begin("id0", original).outcome() == MenuActionReplay.Outcome.NEW,
                "eviction boundary is explicit, not durable exactly-once");
        System.out.println("MenuActionReplay " + checks + " checks passed");
    }
}
