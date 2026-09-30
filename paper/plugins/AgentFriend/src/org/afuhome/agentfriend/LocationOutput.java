package org.afuhome.agentfriend;

import org.bukkit.Location;

/** Stable, block-based coordinates for player and Agent navigation. */
final class LocationOutput {
    private LocationOutput() { }

    static String fields(Location at) {
        return "dimension=" + at.getWorld().getKey() + " x=" + at.getBlockX()
                + " y=" + at.getBlockY() + " z=" + at.getBlockZ();
    }

    static String shortForm(Location at) {
        return at.getBlockX() + ", " + at.getBlockY() + ", " + at.getBlockZ();
    }
}
