package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.bukkit.Location;
import org.bukkit.World;

/** Inclusive block bounds. A mask/polygon envelope is explicitly not a filled cuboid. */
record ProtectionArea(String id, String name, World world, int minX, int minY, int minZ,
                      int maxX, int maxY, int maxZ, String shape) {
    static ProtectionArea box(String id, String name, World world, int minX, int minY, int minZ,
                              int maxX, int maxY, int maxZ) {
        return new ProtectionArea(id, name, world, minX, minY, minZ, maxX, maxY, maxZ, "cuboid");
    }
    boolean contains(Location at) {
        return at != null && world.equals(at.getWorld()) && at.getBlockX() >= minX && at.getBlockX() <= maxX
                && at.getBlockY() >= minY && at.getBlockY() <= maxY && at.getBlockZ() >= minZ && at.getBlockZ() <= maxZ;
    }
    String range() { return "(" + minX + "," + minY + "," + minZ + ") 至 (" + maxX + "," + maxY + "," + maxZ + ")"; }
    JsonObject json() {
        JsonObject data = new JsonObject();
        data.addProperty("id", id); data.addProperty("name", name); data.addProperty("world", world.getKey().toString());
        JsonArray min = new JsonArray(); min.add(minX); min.add(minY); min.add(minZ); data.add("min", min);
        JsonArray max = new JsonArray(); max.add(maxX); max.add(maxY); max.add(maxZ); data.add("max", max);
        data.addProperty("shape", shape); data.addProperty("inclusive", true);
        data.addProperty("envelopeOnly", !shape.equals("cuboid"));
        return data;
    }
}
