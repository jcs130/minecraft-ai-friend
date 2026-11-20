package org.qiandengji.villagerquests.core;

import com.google.gson.JsonObject;

/** Sphere where the work counts (block coordinates). Mirrors the bridge's {@code Area}. */
public record Area(String world, double x, double y, double z, double radius) {
    public Area {
        if (!(radius > 0 && radius <= 256)) throw new IllegalArgumentException("radius must be in (0, 256]");
    }

    public boolean contains(String atWorld, double px, double py, double pz) {
        if (world != null && !world.equals(atWorld)) return false;
        double dx = px - x, dy = py - y, dz = pz - z;
        return dx * dx + dy * dy + dz * dz <= radius * radius;
    }

    public JsonObject toWire() {
        JsonObject o = new JsonObject();
        o.addProperty("x", x);
        o.addProperty("y", y);
        o.addProperty("z", z);
        o.addProperty("radius", radius);
        if (world != null) o.addProperty("world", world);
        return o;
    }

    public static Area fromJson(JsonObject o) {
        return new Area(o.has("world") && !o.get("world").isJsonNull() ? o.get("world").getAsString() : null,
                o.get("x").getAsDouble(), o.get("y").getAsDouble(), o.get("z").getAsDouble(), o.get("radius").getAsDouble());
    }
}
