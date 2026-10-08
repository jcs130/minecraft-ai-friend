package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.simibubi.create.content.contraptions.ControlledContraptionEntity;
import com.simibubi.create.content.contraptions.bearing.BearingContraption;
import com.simibubi.create.content.contraptions.bearing.WindmillBearingBlockEntity;
import com.simibubi.create.infrastructure.config.AllConfigs;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

/** Exact installed Create state, read only after the caller's visibility checks. */
final class PlayerWindmillState {
    private PlayerWindmillState() {}

    static JsonObject bearing(WindmillBearingBlockEntity bearing) {
        JsonObject row = new JsonObject();
        row.addProperty("source", "native_visible_block_entity");
        row.addProperty("running", bearing.isRunning());
        row.addProperty("generatedSpeed", bearing.getGeneratedSpeed());
        row.addProperty("minimumSails", AllConfigs.server().kinetics.minimumWindmillSails.get());
        row.addProperty("sailsPerRpm", AllConfigs.server().kinetics.windmillSailsPerRPM.get());
        var moved = bearing.getMovedContraption();
        if (moved != null && moved.getContraption() instanceof BearingContraption contraption) {
            row.addProperty("sailCount", contraption.getSailBlocks());
            row.addProperty("contraptionEntityId", moved.getId());
            row.addProperty("contraptionUuid", moved.getUUID().toString());
            row.addProperty("angleDegrees", moved.getAngle(1));
            row.addProperty("stalled", moved.isStalled());
        } else {
            row.add("sailCount", JsonNull.INSTANCE);
            row.add("contraptionEntityId", JsonNull.INSTANCE);
            row.add("contraptionUuid", JsonNull.INSTANCE);
            row.add("angleDegrees", JsonNull.INSTANCE);
            row.add("stalled", JsonNull.INSTANCE);
        }
        if (bearing.getLastAssemblyException() == null) row.add("assemblyError", JsonNull.INSTANCE);
        else row.addProperty("assemblyError", bearing.getLastAssemblyException().getMessage());
        return row;
    }

    static JsonObject contraption(ServerPlayer player, ControlledContraptionEntity entity) {
        JsonObject row = new JsonObject();
        row.addProperty("source", "same_player_tracked_entity");
        row.addProperty("playerUuid", player.getUUID().toString());
        row.addProperty("entityId", entity.getId()); row.addProperty("uuid", entity.getUUID().toString());
        row.addProperty("dimension", player.level().dimension().location().toString());
        row.addProperty("id", BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString());
        row.addProperty("serverTick", player.level().getGameTime());
        row.addProperty("angleDegrees", entity.getAngle(1));
        row.addProperty("previousAngleDegrees", entity.getAngle(0));
        row.addProperty("stalled", entity.isStalled());
        Vec3 anchor = entity.getAnchorVec();
        JsonObject position = new JsonObject();
        position.addProperty("x", anchor.x); position.addProperty("y", anchor.y); position.addProperty("z", anchor.z);
        row.add("anchor", position);
        if (!(entity.getContraption() instanceof BearingContraption contraption) || entity.getRotationAxis() == null) {
            row.addProperty("available", false); row.addProperty("reason", "unsupported_contraption_type"); return row;
        }
        row.addProperty("rotationAxis", entity.getRotationAxis().getName());
        row.addProperty("sailCount", contraption.getSailBlocks());
        row.addProperty("blockCount", contraption.getBlocks().size());
        if (contraption.getBlocks().size() > 96) {
            row.addProperty("available", false); row.addProperty("reason", "contraption_block_budget_exceeded"); return row;
        }
        JsonArray blocks = new JsonArray();
        for (var entry : contraption.getBlocks().entrySet().stream().sorted(java.util.Map.Entry.comparingByKey()).toList()) {
            BlockPos pos = entry.getKey(); BlockState state = entry.getValue().state();
            JsonObject block = new JsonObject(), properties = new JsonObject();
            block.addProperty("x", pos.getX()); block.addProperty("y", pos.getY()); block.addProperty("z", pos.getZ());
            block.addProperty("id", BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
            block.addProperty("stateId", Block.getId(state));
            state.getValues().forEach((property, value) -> properties.addProperty(property.getName(), NativeCollisionFacts.propertyValue(property, value)));
            block.add("properties", properties); block.addProperty("hasBlockEntity", state.hasBlockEntity());
            blocks.add(block);
        }
        row.add("blocks", blocks); row.addProperty("available", true);
        return row;
    }
}
