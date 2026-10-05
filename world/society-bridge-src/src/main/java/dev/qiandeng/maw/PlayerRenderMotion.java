package dev.qiandeng.maw;

import com.google.gson.JsonObject;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.Vec3;

/** Same-body observations for original mod animation inputs, never client pose parity. */
final class PlayerRenderMotion {
    static JsonObject snapshot(ServerPlayer player) {
        JsonObject value = new JsonObject();
        value.addProperty("schemaVersion", 1);
        value.addProperty("available", true);
        value.addProperty("source", "same_player_server_tick");
        value.addProperty("playerUuid", player.getUUID().toString());
        value.addProperty("sampledAt", System.currentTimeMillis());
        value.addProperty("sampleIntervalMs", 250);
        value.addProperty("tickCount", player.tickCount);
        value.addProperty("gameTime", player.level().getGameTime());
        value.add("position", vector(player.position()));
        value.add("previousPosition", vector(new Vec3(player.xo, player.yo, player.zo)));
        value.add("velocity", vector(player.getDeltaMovement()));
        value.addProperty("bodyYaw", player.yBodyRot);
        value.addProperty("previousBodyYaw", player.yBodyRotO);
        value.addProperty("headYaw", player.yHeadRot);
        value.addProperty("previousHeadYaw", player.yHeadRotO);
        value.addProperty("yaw", player.getYRot());
        value.addProperty("pitch", player.getXRot());
        value.addProperty("previousPitch", player.xRotO);
        value.addProperty("onGround", player.onGround());
        value.addProperty("sprinting", player.isSprinting());
        value.addProperty("crouching", player.isCrouching());
        value.addProperty("pose", player.getPose().name().toLowerCase(java.util.Locale.ROOT));
        value.addProperty("passenger", player.isPassenger());
        value.addProperty("swimming", player.isSwimming());
        value.addProperty("inWater", player.isInWater());
        value.addProperty("underWater", player.isUnderWater());
        value.addProperty("fallFlying", player.isFallFlying());
        value.addProperty("flying", player.getAbilities().flying);
        value.addProperty("spinAttack", player.isAutoSpinAttack());
        value.addProperty("hurtTime", player.hurtTime);
        value.addProperty("deathTime", player.deathTime);
        value.addProperty("deadOrDying", player.isDeadOrDying());
        value.addProperty("sleeping", player.isSleeping());
        value.addProperty("climbing", player.onClimbable());
        value.addProperty("inLava", player.isInLava());
        value.addProperty("alive", player.isAlive());
        value.addProperty("usingItem", player.isUsingItem());
        value.addProperty("swinging", player.swinging);
        value.addProperty("swingTime", player.swingTime);
        value.addProperty("attackAnim", player.getAttackAnim(1));
        value.addProperty("fallDistance", player.fallDistance);
        value.addProperty("clientAnimationParityVerified", false);
        return value;
    }

    private static JsonObject vector(Vec3 vector) {
        JsonObject value = new JsonObject();
        value.addProperty("x", vector.x);
        value.addProperty("y", vector.y);
        value.addProperty("z", vector.z);
        return value;
    }
}
