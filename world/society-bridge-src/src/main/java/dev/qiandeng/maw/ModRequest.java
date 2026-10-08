package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;

import java.util.Set;

/** Typed, bounded inputs shared by the player-only native adapters. */
final class ModRequest {
    static void fields(JsonObject input, String... names) {
        Set<String> allowed = new java.util.HashSet<>(Set.of("schemaVersion", "kind", "requestId"));
        allowed.addAll(java.util.List.of(names));
        if (input.keySet().stream().anyMatch(k -> !allowed.contains(k))) fail("unsupported_request_field");
        integer(input, "schemaVersion", 1, 1);
    }
    static int integer(JsonObject input, String key, int min, int max) {
        var value = input.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) fail("invalid_" + key);
        double number = value.getAsDouble();
        if (!Double.isFinite(number) || number != Math.rint(number) || number < min || number > max) fail("invalid_" + key);
        return (int) number;
    }
    static String text(JsonObject input, String key, int max) {
        var value = input.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) fail("invalid_" + key);
        String text = value.getAsString();
        if (text.length() > max) fail("invalid_" + key);
        return text;
    }
    static boolean bool(JsonObject input, String key) {
        var value = input.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean()) fail("invalid_" + key);
        return value.getAsBoolean();
    }
    static BlockPos position(JsonObject input, String key) {
        var value = input.get(key);
        if (value == null || !value.isJsonObject()) fail("invalid_" + key);
        JsonObject p = value.getAsJsonObject();
        if (!p.keySet().equals(Set.of("x", "y", "z"))) fail("invalid_" + key);
        return new BlockPos(integer(p, "x", -30000000, 30000000), integer(p, "y", -2048, 2048), integer(p, "z", -30000000, 30000000));
    }
    static JsonObject position(BlockPos p) {
        JsonObject result = new JsonObject();
        result.addProperty("x", p.getX()); result.addProperty("y", p.getY()); result.addProperty("z", p.getZ());
        return result;
    }
    static net.minecraft.world.phys.Vec3 aim(JsonObject input, BlockPos p) {
        if (!input.has("aimOffset")) return net.minecraft.world.phys.Vec3.atCenterOf(p);
        var values = array(input, "aimOffset", 3);
        if (values.size() != 3) fail("invalid_aimOffset");
        double[] offset = new double[3];
        for (int i = 0; i < 3; i++) {
            var v = values.get(i);
            if (!v.isJsonPrimitive() || !v.getAsJsonPrimitive().isNumber()) fail("invalid_aimOffset");
            offset[i] = v.getAsDouble();
            if (!Double.isFinite(offset[i]) || offset[i] < 0 || offset[i] > 1) fail("invalid_aimOffset");
        }
        return new net.minecraft.world.phys.Vec3(p.getX() + offset[0], p.getY() + offset[1], p.getZ() + offset[2]);
    }
    static String snbt(ServerPlayer player, ItemStack item) {
        return item.isEmpty() ? "" : item.saveOptional(player.registryAccess()).toString();
    }
    static void active(ServerPlayer player) {
        if (!player.isAlive() || player.isSpectator()) fail("player_not_active");
    }
    static void held(ServerPlayer player, JsonObject input) {
        active(player);
        if (integer(input, "expectedHotbarSlot", 0, 8) != player.getInventory().selected ||
                !text(input, "expectedHeldSnbt", 60000).equals(snbt(player, player.getMainHandItem()))) fail("held_item_changed");
    }
    static JsonArray array(JsonObject input, String key, int max) {
        var value = input.get(key);
        if (value == null || !value.isJsonArray() || value.getAsJsonArray().size() > max) fail("invalid_" + key);
        return value.getAsJsonArray();
    }
    static void fail(String code) { throw new Invalid(code); }
    static final class Invalid extends RuntimeException { Invalid(String code) { super(code); } }
}
