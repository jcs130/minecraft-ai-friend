package org.qiandengji.villagerquests;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

/** Bukkit-free admission and idempotency rules, also exercised without starting a server. */
final class VillagerBodyRules {
    static final int MAX_WALK_DISTANCE = 32;
    static final long WALK_TIMEOUT_MS = 20_000;
    static final long LEASE_MS = 30_000;
    static final long REPLY_FRESH_MS = 25_000;
    static final int RETAINED_EVENTS = 256;
    private static final Gson GSON = new Gson();

    record Binding(String residentId, UUID bodyId, UUID controllerId) {}
    record Decision(boolean allowed, String reason) {}
    record WalkObservation(boolean terminal, boolean arrived, String status) {}

    private VillagerBodyRules() {}

    static Decision walk(double fromX, double fromY, double fromZ, double toX, double toY, double toZ,
                         int worldMinY, int worldMaxY, boolean targetChunkLoaded) {
        if (!Double.isFinite(fromX) || !Double.isFinite(fromY) || !Double.isFinite(fromZ)
                || !Double.isFinite(toX) || !Double.isFinite(toY) || !Double.isFinite(toZ)) return new Decision(false, "invalid_target");
        double dx = toX - fromX, dy = toY - fromY, dz = toZ - fromZ;
        if (dx * dx + dy * dy + dz * dz > MAX_WALK_DISTANCE * MAX_WALK_DISTANCE) return new Decision(false, "walk_too_far");
        if (toY < worldMinY + 1 || toY > worldMaxY - 1) return new Decision(false, "target_outside_world");
        if (!targetChunkLoaded) return new Decision(false, "target_chunk_unloaded");
        return new Decision(true, "accepted");
    }

    static Decision near(double x, double y, double z, double targetX, double targetY, double targetZ) {
        double dx = x - targetX, dy = y - targetY, dz = z - targetZ;
        return new Decision(dx * dx + dy * dy + dz * dz <= 4.0, dx * dx + dy * dy + dz * dz <= 4.0 ? "arrived" : "walking");
    }

    static boolean leaseActive(long expiresAt, long now) {
        return expiresAt >= now;
    }

    static WalkObservation walkObservation(boolean withinTolerance, long now, long deadline) {
        if (now >= deadline) return new WalkObservation(true, false, "timeout");
        return withinTolerance ? new WalkObservation(true, true, "completed") : new WalkObservation(false, false, "accepted");
    }

    static boolean fresh(long occurredAt, long now) {
        return occurredAt > 0 && occurredAt <= now + 1_000 && now - occurredAt < REPLY_FRESH_MS;
    }

    static long cursor(JsonObject args) {
        JsonElement value = args.get("cursor");
        if (value == null || value.isJsonNull()) return 0;
        try {
            if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) return -1;
            double number = value.getAsDouble();
            return number >= 0 && number <= Long.MAX_VALUE && Math.floor(number) == number ? (long) number : -1;
        } catch (RuntimeException invalid) {
            return -1;
        }
    }

    static String operationId(JsonObject request, JsonObject args) {
        JsonElement outer = request.get("requestId"), inner = args.get("requestId");
        if (outer == null || !outer.isJsonPrimitive() || !outer.getAsJsonPrimitive().isString()) return null;
        String id = outer.getAsString();
        if (id.isBlank() || id.length() > 200 || inner == null || !inner.isJsonPrimitive()
                || !inner.getAsJsonPrimitive().isString() || !id.equals(inner.getAsString())) return null;
        return id;
    }

    /** Stable across JSON member order; generation/action/arguments are included by the caller. */
    static String fingerprint(JsonObject value) {
        return GSON.toJson(canonical(value));
    }

    static JsonElement canonical(JsonElement value) {
        if (value.isJsonObject()) {
            JsonObject result = new JsonObject();
            Map<String, JsonElement> sorted = new TreeMap<>();
            value.getAsJsonObject().entrySet().forEach(entry -> sorted.put(entry.getKey(), canonical(entry.getValue())));
            sorted.forEach(result::add);
            return result;
        }
        if (value.isJsonArray()) {
            JsonArray result = new JsonArray();
            value.getAsJsonArray().forEach(item -> result.add(canonical(item)));
            return result;
        }
        return value.deepCopy();
    }

    static UUID uuid(String value) {
        if (value == null || value.isBlank() || value.length() > 40) return null;
        try {
            UUID id = UUID.fromString(value);
            return id.toString().equals(value) ? id : null;
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }

    static List<Binding> bindings(JsonArray rows) {
        if (rows == null || rows.size() > 256) throw new IllegalArgumentException("bindings must be an array of at most 256 entries");
        List<Binding> result = new ArrayList<>();
        for (JsonElement row : rows) {
            if (!row.isJsonObject()) throw new IllegalArgumentException("binding must be an object");
            JsonObject value = row.getAsJsonObject();
            String resident = text(value, "residentId");
            if (resident == null) resident = "";
            UUID body = uuid(text(value, "bodyId"));
            UUID controller = uuid(text(value, "controllerId"));
            if (!resident.matches("[A-Za-z0-9_-]{1,48}") || body == null || controller == null)
                throw new IllegalArgumentException("binding requires canonical resident/body/controller IDs");
            result.add(new Binding(resident, body, controller));
        }
        return List.copyOf(result);
    }

    private static String text(JsonObject object, String key) {
        JsonElement value = object.get(key);
        return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()
                ? value.getAsString() : null;
    }
}
