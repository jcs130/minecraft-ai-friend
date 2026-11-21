package local.hosting;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Read-only projection of the enrolled original player's asset stores. */
final class CanonicalRoleAssets {
    private static final Set<String> BODY_KINDS = Set.of("mineflayer", "numen", "maid", "villager");

    @FunctionalInterface
    interface Projection {
        JsonObject read(String plugin, String method, UUID original) throws ReflectiveOperationException;
    }

    private CanonicalRoleAssets() {}

    static JsonObject read(JsonObject request, JsonObject enrollment, JsonObject slot, Projection projection) {
        String kind = request.get("kind").getAsString();
        JsonObject body = BODY_KINDS.contains(kind) ? enrollment.getAsJsonObject(kind) : null;
        if (body == null || !enrollment.get("characterId").equals(request.get("characterId"))
                || !enrollment.get("ownerId").equals(request.get("ownerId"))
                || !body.get("bodyId").equals(request.get("bodyId"))
                || !body.get("entityUuid").equals(request.get("entityUuid"))
                || !enrollment.equals(slot.get("scope")))
            throw new SecurityException("Original role scope mismatch");

        var result = request.deepCopy();
        result.addProperty("available", false);
        if (slot.has("pending") || slot.has("transfer") || slot.has("playerGate")
                || !slot.get("activeKind").equals(request.get("kind"))
                || !slot.get("generation").equals(request.get("generation"))) {
            result.addProperty("reason", "role_control_unsettled_or_stale");
            return result;
        }

        UUID original = originalPlayer(enrollment);
        if (original == null) {
            result.addProperty("reason", "no_enrolled_player_body");
            return result;
        }

        result.addProperty("available", true);
        result.addProperty("sampledAt", System.currentTimeMillis());
        result.addProperty("originalPlayerUuid", original.toString());
        result.addProperty("access", "read_only");
        result.addProperty("carriedInventory", switch (kind) {
            case "maid", "villager" -> "native_body_local";
            default -> "original_player_save";
        });
        result.addProperty("playerInventory", "original_player_save");
        result.addProperty("worldPermissions", "active_body_authority");
        result.add("playerLedgers", part(projection, "AgentFriend", "originalRoleAssets", original));
        result.add("villagerCommissions", part(projection, "qiandeng-villager-quests", "originalRoleCommissions", original));
        return result;
    }

    private static UUID originalPlayer(JsonObject enrollment) {
        UUID original = null;
        for (String kind : List.of("mineflayer", "numen")) {
            if (!enrollment.has(kind)) continue;
            UUID candidate = bodyUuid(enrollment.getAsJsonObject(kind));
            if (original != null && !original.equals(candidate))
                throw new SecurityException("Enrolled player bodies do not share an identity");
            original = candidate;
        }
        for (String kind : List.of("maid", "villager")) {
            if (enrollment.has(kind) && bodyUuid(enrollment.getAsJsonObject(kind)).equals(original))
                throw new SecurityException("Original player is also registered as a mob");
        }
        return original;
    }

    private static UUID bodyUuid(JsonObject body) {
        String value = body.get("entityUuid").getAsString();
        UUID id = UUID.fromString(value);
        if (!id.toString().equals(value)) throw new SecurityException("Noncanonical enrolled UUID");
        return id;
    }

    private static JsonObject part(Projection projection, String plugin, String method, UUID original) {
        var result = new JsonObject();
        try {
            JsonObject data = projection.read(plugin, method, original);
            if (data == null) throw new IllegalStateException("Missing projection");
            result.addProperty("available", true);
            result.add("data", data);
        } catch (ReflectiveOperationException | LinkageError | RuntimeException unavailable) {
            result.addProperty("available", false);
            result.addProperty("reason", "source_unavailable");
        }
        return result;
    }

    static JsonObject readPlugin(String name, String method, UUID original) throws ReflectiveOperationException {
        Class<?> bukkit = Class.forName("org.bukkit.Bukkit");
        Object manager = bukkit.getMethod("getPluginManager").invoke(null);
        Object plugin = Class.forName("org.bukkit.plugin.PluginManager")
                .getMethod("getPlugin", String.class).invoke(manager, name);
        if (plugin == null || !Boolean.TRUE.equals(Class.forName("org.bukkit.plugin.Plugin")
                .getMethod("isEnabled").invoke(plugin)))
            throw new IllegalStateException("Projection plugin unavailable");
        String json = (String) plugin.getClass().getMethod(method, UUID.class).invoke(plugin, original);
        if (json == null || json.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 6_500)
            throw new IllegalStateException("Invalid projection length");
        return JsonParser.parseString(json).getAsJsonObject();
    }
}
