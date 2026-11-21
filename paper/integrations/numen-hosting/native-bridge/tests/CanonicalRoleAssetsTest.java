package local.hosting;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

public final class CanonicalRoleAssetsTest {
    private static final String PLAYER = "00000000-0000-4000-8000-000000000101";
    private static final String MAID = "00000000-0000-4000-8000-000000000102";
    private static final String VILLAGER = "00000000-0000-4000-8000-000000000103";
    private static final String OWNER = "00000000-0000-4000-8000-000000000104";
    private static final String OTHER = "00000000-0000-4000-8000-000000000105";
    private static int checks;

    public static void main(String[] args) {
        var scope = new JsonObject();
        scope.addProperty("ownerId", OWNER);
        scope.addProperty("characterId", "resident-test");
        addBody(scope, "mineflayer", PLAYER);
        addBody(scope, "numen", PLAYER);
        addBody(scope, "maid", MAID);
        addBody(scope, "villager", VILLAGER);
        var hits = new AtomicInteger();
        CanonicalRoleAssets.Projection projection = (plugin, method, original) -> {
            hits.incrementAndGet();
            check(original.equals(UUID.fromString(PLAYER)));
            return JsonParser.parseString(
                    plugin.equals("AgentFriend") ? "{\"personalStash\":{\"capacity\":540}}"
                            : "{\"acceptedRecords\":2}").getAsJsonObject();
        };

        for (String kind : List.of("mineflayer", "numen", "maid", "villager")) {
            var request = request(scope, kind);
            var slot = slot(scope, kind);
            String originalRequest = request.toString();
            String originalSlot = slot.toString();
            var result = CanonicalRoleAssets.read(request, scope, slot, projection);
            check(result.get("available").getAsBoolean());
            check(result.get("originalPlayerUuid").getAsString().equals(PLAYER));
            check(result.get("access").getAsString().equals("read_only"));
            check(result.get("worldPermissions").getAsString().equals("active_body_authority"));
            check(result.get("carriedInventory").getAsString().equals(
                    kind.equals("maid") || kind.equals("villager") ? "native_body_local" : "original_player_save"));
            check(result.getAsJsonObject("playerLedgers").getAsJsonObject("data")
                    .getAsJsonObject("personalStash").get("capacity").getAsInt() == 540);
            check(result.getAsJsonObject("villagerCommissions").getAsJsonObject("data")
                    .get("acceptedRecords").getAsInt() == 2);
            check(request.toString().equals(originalRequest));
            check(slot.toString().equals(originalSlot));
        }
        check(hits.get() == 8);
        var read = request(scope, "maid");
        var live = slot(scope, "maid");
        for (String fence : List.of("pending", "transfer", "playerGate")) {
            var fenced = live.deepCopy();
            fenced.add(fence, new JsonObject());
            check(reason(CanonicalRoleAssets.read(read, scope, fenced, projection))
                    .equals("role_control_unsettled_or_stale"));
        }
        var stale = live.deepCopy();
        stale.addProperty("generation", 9);
        check(reason(CanonicalRoleAssets.read(read, scope, stale, projection))
                .equals("role_control_unsettled_or_stale"));
        var otherBody = slot(scope, "villager");
        check(reason(CanonicalRoleAssets.read(read, scope, otherBody, projection))
                .equals("role_control_unsettled_or_stale"));
        for (String field : List.of("ownerId", "entityUuid", "bodyId", "characterId", "kind")) {
            var mismatched = read.deepCopy();
            mismatched.addProperty(field, OTHER);
            rejected(() -> CanonicalRoleAssets.read(mismatched, scope, live, projection));
        }
        var differentScope = scope.deepCopy();
        differentScope.addProperty("ownerId", OTHER);
        rejected(() -> CanonicalRoleAssets.read(read, scope, slot(differentScope, "maid"), projection));
        var noPlayer = scope.deepCopy();
        noPlayer.remove("mineflayer");
        noPlayer.remove("numen");
        check(reason(CanonicalRoleAssets.read(read, noPlayer, slot(noPlayer, "maid"), projection))
                .equals("no_enrolled_player_body"));
        var disagreement = scope.deepCopy();
        addBody(disagreement, "numen", OTHER);
        rejected(() -> CanonicalRoleAssets.read(read, disagreement, slot(disagreement, "maid"), projection));
        var sharedMob = scope.deepCopy();
        addBody(sharedMob, "numen", MAID);
        addBody(sharedMob, "mineflayer", MAID);
        rejected(() -> CanonicalRoleAssets.read(read, sharedMob, slot(sharedMob, "maid"), projection));
        check(hits.get() == 8);

        var partial = CanonicalRoleAssets.read(read, scope, live, (plugin, method, original) -> {
            if (plugin.equals("AgentFriend")) throw new NoSuchMethodException("Fixture intentionally omits ABI");
            return new JsonObject();
        });
        check(partial.get("available").getAsBoolean());
        check(reason(partial.getAsJsonObject("playerLedgers")).equals("source_unavailable"));
        check(partial.getAsJsonObject("villagerCommissions").get("available").getAsBoolean());
        System.out.println("CanonicalRoleAssetsTest checks=" + checks);
    }

    private static String reason(JsonObject result) {
        check(!result.get("available").getAsBoolean());
        check(!result.has("originalPlayerUuid"));
        return result.get("reason").getAsString();
    }

    private static void addBody(JsonObject scope, String kind, String id) {
        var body = new JsonObject();
        body.addProperty("bodyId", kind + "-test");
        body.addProperty("entityUuid", id);
        scope.add(kind, body);
    }

    private static JsonObject request(JsonObject scope, String kind) {
        var body = scope.getAsJsonObject(kind);
        var result = body.deepCopy();
        result.addProperty("phase", "assets");
        result.addProperty("operationId", "role-test-call");
        result.addProperty("kind", kind);
        result.add("characterId", scope.get("characterId"));
        result.add("ownerId", scope.get("ownerId"));
        result.addProperty("generation", 10);
        return result;
    }

    private static JsonObject slot(JsonObject scope, String kind) {
        var result = new JsonObject();
        result.add("scope", scope.deepCopy());
        result.addProperty("activeKind", kind);
        result.addProperty("generation", 10);
        return result;
    }

    private static void rejected(Runnable call) {
        try {
            call.run();
            throw new AssertionError("Unauthorized asset view succeeded");
        } catch (SecurityException expected) {
            checks++;
        }
    }

    private static void check(boolean pass) {
        if (!pass) throw new AssertionError("Canonical role check " + (checks + 1));
        checks++;
    }
}
