package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.phys.AABB;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Locked, read-only collision facts. Never substitutes visual/occlusion geometry. */
final class NativeCollisionFacts {
    static final int MAX_BYTES = 16384;
    static final int MAX_BOXES = 64;
    static final double MAX_LOCAL_EXTENT = 16.0;
    static final String SOURCE = "same_player_server_collision_shape";
    // Exact classes, not instanceof: an unaudited subclass can override a shape
    // getter and read arbitrary neighbours or a block entity. The bytecode audit
    // checks the complete collision/outline/interaction dispatch for these classes.
    static final Map<String, Set<String>> SUPPORTED = Map.of(
            "minecraft", Set.of("net.minecraft.world.level.block.Block",
                    "net.minecraft.world.level.block.SlabBlock", "net.minecraft.world.level.block.StairBlock",
                    "net.minecraft.world.level.block.DoorBlock", "net.minecraft.world.level.block.TrapDoorBlock",
                    "net.minecraft.world.level.block.FenceBlock", "net.minecraft.world.level.block.FenceGateBlock",
                    "net.minecraft.world.level.block.WallBlock"),
            "domum_ornamentum", Set.of("com.ldtteam.domumornamentum.block.decorative.PanelBlock",
                    "com.ldtteam.domumornamentum.block.vanilla.SlabBlock",
                    "com.ldtteam.domumornamentum.block.vanilla.StairBlock"),
            "mcwbridges", Set.of("com.mcwbridges.kikoz.objects.Bridge_Stairs"),
            "mcwroofs", Set.of("com.mcwroofs.kikoz.objects.roofs.RoofBlock",
                    "com.mcwroofs.kikoz.objects.roofs.BaseRoof", "com.mcwroofs.kikoz.objects.roofs.Lower"),
            "farmersdelight", Set.of("vectorwing.farmersdelight.common.block.CuttingBoardBlock"));

    static boolean supported(String namespace, String className) {
        return SUPPORTED.getOrDefault(namespace, Set.of()).contains(className);
    }

    // Property.getName(value) is Minecraft's serialized value. Mod enums can
    // inherit Enum.toString() (e.g. BASE) while serializing as "base"; using
    // toString would break registry/look/collision full-state identity.
    static <T extends Comparable<T>> String propertyValue(Property<T> property, Comparable<?> value) {
        if (!property.getPossibleValues().contains(value))
            throw new IllegalArgumentException("property value does not belong to native property");
        @SuppressWarnings("unchecked") T nativeValue = (T) value;
        return property.getName(nativeValue);
    }

    static int integer(JsonObject object, String name) {
        var value = object.get(name);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber())
            throw new IllegalArgumentException("expected JSON integer");
        try { return value.getAsBigDecimal().intValueExact(); }
        catch (ArithmeticException invalid) { throw new IllegalArgumentException("integer out of range", invalid); }
    }

    static JsonObject properties(JsonObject input) {
        if (input == null || input.size() > 40) throw new IllegalArgumentException("invalid properties");
        JsonObject result = new JsonObject();
        input.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(entry -> {
            if (!entry.getKey().matches("[a-z0-9_]{1,64}") || !entry.getValue().isJsonPrimitive()
                    || !entry.getValue().getAsJsonPrimitive().isString()
                    || !entry.getValue().getAsString().matches("[a-z0-9_.:-]{1,96}"))
                throw new IllegalArgumentException("invalid property value");
            result.addProperty(entry.getKey(), entry.getValue().getAsString());
        });
        return result;
    }

    static JsonArray boxes(List<AABB> nativeBoxes) {
        if (nativeBoxes.size() > MAX_BOXES) throw new IllegalArgumentException("collision_box_budget_exceeded");
        JsonArray result = new JsonArray();
        for (AABB box : nativeBoxes) {
            double[] values = {box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ};
            for (double value : values)
                if (!Double.isFinite(value) || Math.abs(value) > MAX_LOCAL_EXTENT)
                    throw new IllegalArgumentException("collision_box_extent_unsupported");
            if (!(box.minX < box.maxX && box.minY < box.maxY && box.minZ < box.maxZ))
                throw new IllegalArgumentException("collision_box_invalid");
            JsonArray row = new JsonArray();
            for (double value : values) row.add(value);
            result.add(row); // Preserve original local coordinates, including Y > 1.
        }
        return result;
    }

    static int bytes(JsonObject body) {
        return body.toString().getBytes(StandardCharsets.UTF_8).length;
    }
}
