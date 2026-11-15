package org.afuhome.agentfriend;

import org.bukkit.Location;

/** Stable, block-based coordinates for player and Agent navigation. */
final class LocationOutput {
    private LocationOutput() { }

    static String fields(Location at) {
        return "dimension=" + at.getWorld().getKey() + " x=" + at.getBlockX()
                + " y=" + at.getBlockY() + " z=" + at.getBlockZ();
    }

    static String worldLabel(org.bukkit.World world) {
        return switch (world.getName()) {
            case "world" -> "主世界";
            case "world_nether" -> "下界";
            case "world_the_end" -> "末地";
            case "aincrad" -> "艾恩葛朗特";
            default -> world.getName();
        };
    }

    static String shortForm(Location at) {
        return at.getBlockX() + ", " + at.getBlockY() + ", " + at.getBlockZ();
    }
}
