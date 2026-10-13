package org.afuhome.agentfriend;

/** A boundary is observed on one actual movement segment, wherever exploration
 * took the player. The legacy first-acceptance anchor is deliberately not used. */
final class BiomeBorder {
    record Point(String world, double x, double y, double z, String biome) { }
    private BiomeBorder() { }

    static boolean known(String key) {
        return key != null && key.matches("[a-z0-9_.-]+:[a-z0-9_./-]+")
                && !key.equals("minecraft:custom") && !key.equals("minecraft:unknown");
    }

    static boolean crossed(Point from, Point to, boolean teleported) {
        if (teleported || from == null || to == null || from.world == null
                || !from.world.equals(to.world) || !known(from.biome) || !known(to.biome)
                || from.biome.equals(to.biome)) return false;
        double dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
        double distanceSquared = dx * dx + dy * dy + dz * dz;
        return Double.isFinite(distanceSquared) && distanceSquared > 0 && distanceSquared <= 32 * 32;
    }
}
