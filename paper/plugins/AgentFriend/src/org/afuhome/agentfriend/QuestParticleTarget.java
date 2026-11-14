package org.afuhome.agentfriend;

import com.google.gson.JsonObject;

/** Presentation of already disclosed targets. No searching, chunk loading or task writes. */
final class QuestParticleTarget {
    record Point(double x, double y, double z) { }
    static Point resolve(JsonObject guide, String worldId, String worldKey, String worldName,
                         double x, double y, double z) {
        JsonObject at = object(guide, "target");
        String phase = text(guide, "phase");
        if (at == null && phase.equals("return_to_acceptance_point")) at = object(guide, "returnTo");
        if (at == null && phase.equals("travel_to_marker")) at = object(guide, "navigation");
        if (at == null) return null;
        String uuid = text(at, "worldUuid"), world = text(at, "world");
        if (!uuid.isEmpty() ? !uuid.equals(worldId) : world.isEmpty() || !world.equals(worldKey) && !world.equals(worldName)) return null;
        if (!at.has("x") || !at.has("z")) return null;
        try {
            double dx = at.get("x").getAsDouble() - x, dz = at.get("z").getAsDouble() - z;
            // Map X/Z is a bearing only; never invent an underground entrance Y.
            double dy = at.has("y") ? at.get("y").getAsDouble() + 1 - y : 0;
            double distance = Math.hypot(Math.hypot(dx, dy), dz);
            if (!Double.isFinite(distance) || distance < 4) return null;
            double scale = Math.min(1, 24 / distance);
            return new Point(x + dx * scale, y + dy * scale, z + dz * scale);
        } catch (RuntimeException malformed) { return null; }
    }
    private static JsonObject object(JsonObject o, String key) {
        return o != null && o.has(key) && o.get(key).isJsonObject() ? o.getAsJsonObject(key) : null;
    }
    private static String text(JsonObject o, String key) {
        return o != null && o.has(key) && o.get(key).isJsonPrimitive() ? o.get(key).getAsString() : "";
    }
}
