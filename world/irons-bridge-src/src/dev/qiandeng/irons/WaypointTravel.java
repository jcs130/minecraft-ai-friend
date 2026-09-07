package dev.qiandeng.irons;

import com.google.gson.JsonObject;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.DoubleArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.entity.Pose;
import net.minecraft.world.phys.Vec3;
import java.util.HashMap;
import java.util.Set;
import java.util.UUID;

/** Server-authoritative travel for a point already resolved by the world service. */
final class WaypointTravel {
    static final String PREFIX = "QD_WARP_JSON ";
    private static final HashMap<UUID, Long> lastTravel = new HashMap<>();

    static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        // Players never receive a raw-coordinate command. Their menu/CLI resolves
        // their personal/shared point through the trusted local world service.
        var destination = Commands.argument("z", DoubleArgumentType.doubleArg(-29_999_984, 29_999_984))
            .executes(c -> run(c.getSource(), StringArgumentType.getString(c, "actor"),
                StringArgumentType.getString(c, "dimension"), DoubleArgumentType.getDouble(c, "x"),
                DoubleArgumentType.getDouble(c, "y"), DoubleArgumentType.getDouble(c, "z")));
        var yArg = Commands.argument("y", DoubleArgumentType.doubleArg(-2048, 2048)).then(destination);
        var xArg = Commands.argument("x", DoubleArgumentType.doubleArg(-29_999_984, 29_999_984)).then(yArg);
        var dimension = Commands.argument("dimension", StringArgumentType.string()).then(xArg);
        dispatcher.register(Commands.literal("qdwarp").requires(s -> s.hasPermission(2))
            .then(Commands.argument("actor", StringArgumentType.string()).then(dimension)));
        dispatcher.register(Commands.literal("qdlocation").requires(s -> s.hasPermission(2))
            .then(Commands.argument("actor", StringArgumentType.string()).executes(c -> {
                JsonObject result;
                try { result = reply(QiandengIronsBridge.resolve(c.getSource().getServer(), StringArgumentType.getString(c, "actor")), true, "ok", "当前位置"); }
                catch (Exception e) { result = reply(null, false, "actor_unavailable", "角色未加载或同名不唯一，请使用 UUID。"); }
                result.addProperty("action", "location");
                JsonObject captured = result;
                c.getSource().sendSuccess(() -> Component.literal(PREFIX + captured), false);
                return result.get("ok").getAsBoolean() ? 1 : 0;
            })));
    }

    private static JsonObject reply(ServerPlayer actor, boolean ok, String code, String summary) {
        var out = new JsonObject();
        out.addProperty("schema", 1); out.addProperty("action", "teleport");
        out.addProperty("ok", ok); out.addProperty("code", code); out.addProperty("summary", summary);
        out.addProperty("actor", actor == null ? "" : actor.getGameProfile().getName());
        out.addProperty("actorUuid", actor == null ? "" : actor.getStringUUID());
        if (actor != null) {
            out.addProperty("dimension", actor.serverLevel().dimension().location().toString());
            out.addProperty("x", actor.getX()); out.addProperty("y", actor.getY()); out.addProperty("z", actor.getZ());
        }
        return out;
    }

    private static int run(CommandSourceStack source, String query, String dimension, double x, double y, double z) {
        JsonObject result;
        ServerPlayer actor = null;
        boolean attempted = false;
        try {
            actor = QiandengIronsBridge.resolve(source.getServer(), query);
            var id = ResourceLocation.tryParse(dimension);
            ServerLevel level = id == null ? null : source.getServer().getLevel(ResourceKey.create(Registries.DIMENSION, id));
            long remaining = 3000 - (System.currentTimeMillis() - lastTravel.getOrDefault(actor.getUUID(), 0L));
            if (level == null) result = reply(actor, false, "dimension_unavailable", "传送点所属维度不可用，请重新记录。");
            else if (remaining > 0) {
                result = reply(actor, false, "cooldown", "传送阵正在恢复，请稍候。"); result.addProperty("cooldownMs", remaining);
            } else if (!actor.isAlive() || actor.isPassenger()) result = reply(actor, false, "actor_unavailable", "请在存活且离开坐骑后使用传送阵。");
            else if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z) ||
                    y < level.getMinBuildHeight() || y >= level.getMaxBuildHeight() - 1 ||
                    !level.getWorldBorder().isWithinBounds(BlockPos.containing(x, y, z))) {
                result = reply(actor, false, "unsafe_destination", "传送点超出世界边界或高度范围。");
            } else {
                Vec3 destination = safeLanding(level, actor, BlockPos.containing(x, y, z));
                if (destination == null) result = reply(actor, false, "unsafe_destination", "传送点附近没有安全落脚处，请重新记录；尚未移动。");
                else {
                    attempted = true;
                    actor.teleportTo(level, destination.x, destination.y, destination.z, Set.of(), actor.getYRot(), actor.getXRot());
                    boolean arrived = actor.serverLevel() == level && actor.position().distanceToSqr(destination) < 0.01;
                    result = reply(actor, arrived, arrived ? "teleported" : "outcome_unknown", arrived ? "传送完成，已确认维度和安全落点。" : "落点未确认，请查询位置，不要自动重发。");
                    if (arrived) { actor.fallDistance = 0; lastTravel.put(actor.getUUID(), System.currentTimeMillis()); }
                }
            }
        } catch (Exception e) {
            result = reply(actor, false, attempted ? "outcome_unknown" : "travel_unavailable", attempted ? "传送回执中断，请查询位置，不要自动重发。" : "角色或传送点不可用，尚未执行传送。");
        }
        JsonObject finalResult = result;
        source.sendSuccess(() -> Component.literal(PREFIX + finalResult), false);
        return result.get("ok").getAsBoolean() ? 1 : 0;
    }

    private static Vec3 safeLanding(ServerLevel level, ServerPlayer actor, BlockPos origin) {
        // One explicitly selected point only: bounded radius 2, height +/-4.
        // Load the small destination area using Minecraft's normal chunk source.
        for (int radius = 0; radius <= 2; radius++) {
            for (int dy : new int[]{0, 1, -1, 2, -2, 3, -3, 4, -4}) {
                for (int dx = -radius; dx <= radius; dx++) for (int dz = -radius; dz <= radius; dz++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) != radius) continue;
                    BlockPos feet = origin.offset(dx, dy, dz);
                    if (feet.getY() <= level.getMinBuildHeight() || feet.getY() >= level.getMaxBuildHeight() - 1 || !level.getWorldBorder().isWithinBounds(feet)) continue;
                    level.getChunk(feet.getX() >> 4, feet.getZ() >> 4);
                    var floor = level.getBlockState(feet.below());
                    if (!floor.isFaceSturdy(level, feet.below(), Direction.UP) || hazard(level, feet.below()) || hazard(level, feet) || hazard(level, feet.above())) continue;
                    Vec3 target = Vec3.atBottomCenterOf(feet);
                    var box = actor.getDimensions(Pose.STANDING).makeBoundingBox(target);
                    if (level.noCollision(actor, box) && !level.containsAnyLiquid(box)) return target;
                }
            }
        }
        return null;
    }

    private static boolean hazard(ServerLevel level, BlockPos at) {
        var block = level.getBlockState(at);
        return !level.getFluidState(at).isEmpty() || block.is(Blocks.FIRE) || block.is(Blocks.SOUL_FIRE) ||
            block.is(Blocks.CACTUS) || block.is(Blocks.MAGMA_BLOCK) || block.is(Blocks.CAMPFIRE) ||
            block.is(Blocks.SOUL_CAMPFIRE) || block.is(Blocks.POWDER_SNOW) || block.is(Blocks.SWEET_BERRY_BUSH);
    }
}
