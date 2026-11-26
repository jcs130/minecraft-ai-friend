package org.qiandengji.villagerquests;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.UUID;
import org.qiandengji.villagerquests.BodyReceiptLedger.Entry;
import org.qiandengji.villagerquests.BodyReceiptLedger.Status;

/** No server, mocks, entities or QA probes: pure protocol rules and the real atomic receipt ledger. */
public final class VillagerBodyProtocolTest {
    private static int checks;

    public static void main(String[] args) throws Exception {
        rules();
        ledger();
        System.out.println("passed=true checks=" + checks);
    }

    private static JsonArray offered(boolean counter) {
        return VillagerBodyPort.tools(counter).get(0).getAsJsonObject().getAsJsonObject("inputSchema")
                .getAsJsonObject("properties").getAsJsonObject("action").getAsJsonArray("enum");
    }

    private static void rules() {
        JsonArray counter = offered(true), ordinary = offered(false);
        check(counter.toString().equals("[\"context\",\"inbox\",\"speak\",\"receipt\"]"),
                "counter lease keeps speech and receipt reads, not navigation");
        check(ordinary.toString().contains("\"walk\",\"speak\",\"stop\""), "normal villager keeps original walk and stop");
        var boundary = VillagerBodyRules.walk(0, 64, 0, 32, 64, 0, -64, 320, true);
        check(boundary.allowed(), "exactly 32 blocks is allowed");
        check(!VillagerBodyRules.walk(0, 64, 0, 32.01, 64, 0, -64, 320, true).allowed(), "over 32 blocks is rejected");
        check(!VillagerBodyRules.walk(0, 64, 0, Double.NaN, 64, 0, -64, 320, true).allowed(), "NaN target is rejected");
        check(!VillagerBodyRules.walk(0, 64, 0, 1, 321, 0, -64, 320, true).allowed(), "outside world height is rejected");
        check(!VillagerBodyRules.walk(0, 64, 0, 1, 64, 0, -64, 320, false).allowed(), "unloaded target chunk is rejected");
        check(VillagerBodyRules.near(0, 64, 0, 2, 64, 0).allowed(), "measured arrival tolerance is inclusive");
        check(!VillagerBodyRules.near(0, 64, 0, 2.01, 64, 0).allowed(), "distance alone never completes a walk");
        check(VillagerBodyRules.LEASE_MS == 30_000 && VillagerBodyRules.WALK_TIMEOUT_MS == 20_000, "lease and walk deadlines match protocol");
        check(VillagerBodyRules.leaseActive(30_000, 29_999), "lease is active before timeout");
        check(VillagerBodyRules.leaseActive(30_000, 30_000), "lease is active at the exact deadline");
        check(!VillagerBodyRules.leaseActive(30_000, 30_001), "expired lease cannot be renewed by a late call");
        check(VillagerBodyRules.walkObservation(true, 19_999, 20_000).arrived(), "measured arrival before deadline completes");
        var late = VillagerBodyRules.walkObservation(true, 20_000, 20_000);
        check(late.terminal() && !late.arrived() && "timeout".equals(late.status()), "late observation cannot fake on-time arrival");
        check(!VillagerBodyRules.walkObservation(false, 10_000, 20_000).terminal(), "walk remains accepted while still moving");
        check(!VillagerBodyRules.fresh(25_000, 50_000), "event at 25s is no longer fresh");
        check(!VillagerBodyRules.fresh(24_999, 50_000), "event older than 25s is rejected");
        check(!VillagerBodyRules.fresh(51_002, 50_000), "future event beyond clock skew is rejected");

        JsonObject request = new JsonObject();
        request.addProperty("requestId", "original-1");
        JsonObject arguments = new JsonObject();
        arguments.addProperty("action", "stop");
        arguments.addProperty("requestId", "original-1");
        check("original-1".equals(VillagerBodyRules.operationId(request, arguments)), "matching write request IDs are accepted");
        arguments.addProperty("requestId", "other");
        check(VillagerBodyRules.operationId(request, arguments) == null, "mismatched write request IDs are rejected");
        arguments.addProperty("requestId", "original-1");

        JsonObject first = new JsonObject(), second = new JsonObject();
        first.add("b", arguments); first.addProperty("a", "body");
        second.addProperty("a", "body"); second.add("b", arguments.deepCopy());
        check(VillagerBodyRules.fingerprint(first).equals(VillagerBodyRules.fingerprint(second)), "fingerprint ignores JSON member order");
        second.addProperty("generation", "different");
        check(!VillagerBodyRules.fingerprint(first).equals(VillagerBodyRules.fingerprint(second)), "fingerprint binds immutable arguments");

        JsonObject cursor = new JsonObject();
        check(VillagerBodyRules.cursor(cursor) == 0, "missing cursor starts at zero");
        cursor.addProperty("cursor", 2.0);
        check(VillagerBodyRules.cursor(cursor) == 2, "integral numeric cursor is accepted");
        cursor.addProperty("cursor", 2.5);
        check(VillagerBodyRules.cursor(cursor) == -1, "fractional cursor is rejected");
        cursor.addProperty("cursor", -1);
        check(VillagerBodyRules.cursor(cursor) == -1, "negative cursor is rejected");

        UUID body = UUID.randomUUID(), controller = UUID.randomUUID();
        JsonArray rows = new JsonArray();
        JsonObject binding = new JsonObject();
        binding.addProperty("residentId", "qinghe");
        binding.addProperty("bodyId", body.toString());
        binding.addProperty("controllerId", controller.toString());
        rows.add(binding);
        check(VillagerBodyRules.bindings(rows).size() == 1, "canonical native binding is parsed");
        binding.addProperty("bodyId", "not-a-uuid");
        try {
            VillagerBodyRules.bindings(rows);
            throw new AssertionError("non-UUID binding must fail");
        } catch (IllegalArgumentException expected) {
            checks++;
        }
    }

    private static void ledger() throws Exception {
        Path root = Files.createTempDirectory("villager-body-ledger-test-");
        try {
            Path directory = root.resolve("receipts");
            BodyReceiptLedger ledger = new BodyReceiptLedger(directory);
            ledger.load();
            JsonObject data = new JsonObject();
            data.addProperty("measuredArrival", true);
            Entry accepted = entry("walk-1", Status.ACCEPTED, false, new JsonObject());
            check(ledger.put(accepted), "accepted receipt is durable");
            Entry completed = entry("walk-1", Status.COMPLETED, true, data);
            check(ledger.put(completed), "terminal observation updates the same original operation");
            try (var files = Files.list(directory)) {
                check(files.filter(path -> path.toString().endsWith(".json")).count() == 1, "one operation has one atomic receipt file");
            }
            BodyReceiptLedger restarted = new BodyReceiptLedger(directory);
            restarted.load();
            Entry recovered = restarted.get("walk-1");
            check(recovered != null && recovered.status() == Status.COMPLETED && recovered.terminal(), "terminal receipt survives restart");
            check(!recovered.toJson().get("retryAllowed").getAsBoolean(), "receipts never authorize retry");
            check(recovered.data().getAsJsonObject().get("measuredArrival").getAsBoolean(), "measured arrival evidence survives restart");
            check(restarted.put(recovered), "repeating an identical terminal receipt is idempotent");
            Entry overwrite = new Entry(recovered.residentId(), recovered.bodyId(), recovered.controllerId(), recovered.generation(),
                    recovered.operationId(), recovered.action(), Status.FAILED, true, recovered.observedAt() + 1,
                    new JsonObject(), recovered.fingerprint());
            try {
                restarted.put(overwrite);
                throw new AssertionError("terminal receipt overwrite must fail");
            } catch (IOException expected) {
                check(restarted.get("walk-1").status() == Status.COMPLETED, "failed overwrite leaves the original terminal receipt intact");
            }

            Entry interrupted = entry("walk-2", Status.ACCEPTED, false, new JsonObject());
            check(restarted.put(interrupted), "second accepted walk is durable");
            BodyReceiptLedger interruptedRestart = new BodyReceiptLedger(directory);
            interruptedRestart.load();
            Entry unknown = interruptedRestart.get("walk-2");
            check(unknown.status() == Status.UNKNOWN && unknown.terminal(), "interrupted walk becomes terminal unknown, never completed");
            check(unknown.data().getAsJsonObject().get("interrupted").getAsBoolean(), "restart interruption is explicit");

            Path corrupt = directory.resolve("corrupt.json");
            Files.writeString(corrupt, "{broken", StandardCharsets.UTF_8);
            BodyReceiptLedger damaged = new BodyReceiptLedger(directory);
            try {
                damaged.load();
                throw new AssertionError("damaged receipt must fail closed");
            } catch (IOException expected) {
                check(damaged.get("walk-1") == null, "damaged ledger does not authorize any replay");
            }
        } finally {
            try (var paths = Files.walk(root)) {
                for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
            }
        }
    }

    private static Entry entry(String operation, Status status, boolean terminal, JsonObject data) {
        return new Entry("qinghe", UUID.nameUUIDFromBytes(("body:" + operation).getBytes(StandardCharsets.UTF_8)).toString(),
                UUID.nameUUIDFromBytes(("controller:" + operation).getBytes(StandardCharsets.UTF_8)).toString(),
                UUID.nameUUIDFromBytes(("generation:" + operation).getBytes(StandardCharsets.UTF_8)).toString(),
                operation, "walk", status, terminal, System.currentTimeMillis(), data, "fingerprint-" + operation);
    }

    private static void check(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }
}
