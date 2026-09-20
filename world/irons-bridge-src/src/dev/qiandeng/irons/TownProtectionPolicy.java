package dev.qiandeng.irons;

import java.util.Set;

/** The owner's fixed main-town boundary, independent of Agent prompts and input paths. */
public final class TownProtectionPolicy {
    public static final int MIN_X = -715, MAX_X = -375, MIN_Z = 695, MAX_Z = 1035;
    public static final String DIMENSION = "minecraft:overworld";
    private static final Set<String> FIELD_CROPS = Set.of(
        "minecraft:wheat", "minecraft:carrots", "minecraft:potatoes", "minecraft:beetroots");
    private TownProtectionPolicy() {}

    // No Y restriction; this includes basements, bridges, roofs and build-height changes.
    public static boolean contains(String dimension, int x, int z) {
        return (dimension == null || DIMENSION.equals(dimension))
            && x >= MIN_X && x <= MAX_X && z >= MIN_Z && z <= MAX_Z;
    }
    public static boolean near(String dimension, int x, int z, int margin) {
        if (margin < 0 || margin > 16) throw new IllegalArgumentException("invalid_margin");
        return (dimension == null || DIMENSION.equals(dimension))
            && x >= MIN_X - margin && x <= MAX_X + margin
            && z >= MIN_Z - margin && z <= MAX_Z + margin;
    }
    public static boolean matureFieldCrop(String blockId, int age, int maximumAge, boolean farmland) {
        return farmland && FIELD_CROPS.contains(blockId) && maximumAge > 0 && age == maximumAge;
    }
    public static boolean mayPlant(String blockId, boolean oldAir, boolean farmland) {
        return oldAir && farmland && FIELD_CROPS.contains(blockId);
    }
}
