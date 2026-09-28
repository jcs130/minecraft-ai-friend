package com.dwinovo.numen.actuator;

import com.dwinovo.numen.entity.NumenPlayer;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.LinkedHashMap;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** One loaded-only block volume around Kirito's real Numen body; no camera or client. */
final class NumenVisionSnapshot {
    private static final UUID KIRITO = UUID.fromString("d4ac9523-4962-43ed-98c5-19b49e104048");
    private static final int RADIUS = 16;
    private static final int BELOW = 10;
    private static final int ABOVE = 18;
    private record InterestingBlock(String id, int x, int y, int z, double distance) {}

    private NumenVisionSnapshot() {}

    static int capture(CommandSourceStack source) {
        NumenPlayer self = NumenActCommand.findCompanion(source.getServer(), "Kirito");
        if (self == null || !KIRITO.equals(self.getUUID()) || !self.isAlive()) {
            source.sendFailure(Component.literal("snapshot body_unavailable"));
            return 0;
        }
        ServerLevel level = self.serverLevel();
        BlockPos center = self.blockPosition();
        int minX = center.getX() - RADIUS, maxX = center.getX() + RADIUS;
        int minZ = center.getZ() - RADIUS, maxZ = center.getZ() + RADIUS;
        int minY = Math.max(level.getMinBuildHeight(), center.getY() - BELOW);
        int maxY = Math.min(level.getMaxBuildHeight() - 1, center.getY() + ABOVE);
        BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
        // Never force world generation, and never pretend missing columns are air.
        for (int z = minZ; z <= maxZ; z++) for (int x = minX; x <= maxX; x++) {
            pos.set(x, center.getY(), z);
            if (!level.hasChunkAt(pos)) {
                source.sendFailure(Component.literal("snapshot chunks_unloaded"));
                return 0;
            }
        }
        long sampledAt = System.currentTimeMillis();
        JsonObject snapshot = new JsonObject();
        snapshot.addProperty("schema", 1);
        snapshot.addProperty("actorName", "Kirito");
        snapshot.addProperty("actorUuid", self.getUUID().toString());
        snapshot.addProperty("dimension", level.dimension().location().toString());
        snapshot.addProperty("sampledAt", sampledAt);
        snapshot.addProperty("x", self.getX());
        snapshot.addProperty("y", self.getY());
        snapshot.addProperty("z", self.getZ());
        snapshot.addProperty("eyeY", self.getEyeY());
        snapshot.addProperty("yawRadians", Math.toRadians(self.getYRot()));
        snapshot.addProperty("pitchRadians", Math.toRadians(self.getXRot()));
        snapshot.addProperty("timeOfDay", level.getDayTime() % 24000);
        snapshot.addProperty("minX", minX); snapshot.addProperty("maxX", maxX);
        snapshot.addProperty("minY", minY); snapshot.addProperty("maxY", maxY);
        snapshot.addProperty("minZ", minZ); snapshot.addProperty("maxZ", maxZ);
        Map<Integer, Integer> paletteIndex = new LinkedHashMap<>();
        JsonArray palette = new JsonArray(), paletteNames = new JsonArray(), blocks = new JsonArray();
        Map<String, InterestingBlock> nearbyBlocks = new LinkedHashMap<>();
        int side = maxX - minX + 1;
        for (int y = minY; y <= maxY; y++) for (int z = minZ; z <= maxZ; z++)
            for (int x = minX; x <= maxX; x++) {
                pos.set(x, y, z);
                var state = level.getBlockState(pos);
                if (state.isAir()) continue;
                int id = Block.getId(state);
                String blockId = BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
                Integer index = paletteIndex.get(id);
                if (index == null) {
                    index = paletteIndex.size(); paletteIndex.put(id, index); palette.add(id); paletteNames.add(blockId);
                }
                int offset = ((y - minY) * side + (z - minZ)) * side + (x - minX);
                blocks.add(offset); blocks.add(index);
                if (notable(blockId)) {
                    double distance = Math.sqrt(self.distanceToSqr(x + 0.5, y + 0.5, z + 0.5));
                    if (distance <= 12) {
                        InterestingBlock old = nearbyBlocks.get(blockId);
                        if (old == null || distance < old.distance())
                            nearbyBlocks.put(blockId, new InterestingBlock(blockId, x, y, z, distance));
                    }
                }
            }
        snapshot.add("palette", palette); snapshot.add("paletteNames", paletteNames); snapshot.add("blocks", blocks);
        JsonObject hud = new JsonObject();
        Vec3 eye = self.getEyePosition();
        BlockHitResult hit = level.clip(new ClipContext(eye, eye.add(self.getLookAngle().scale(16)),
                ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, self));
        if (hit.getType() == HitResult.Type.BLOCK) {
            BlockPos target = hit.getBlockPos();
            JsonObject aim = new JsonObject();
            aim.addProperty("id", BuiltInRegistries.BLOCK.getKey(level.getBlockState(target).getBlock()).toString());
            aim.addProperty("distance", eye.distanceTo(hit.getLocation()));
            aim.addProperty("x", target.getX()); aim.addProperty("y", target.getY()); aim.addProperty("z", target.getZ());
            hud.add("aimBlock", aim);
        }
        JsonArray blocksOfInterest = new JsonArray();
        nearbyBlocks.values().stream().sorted(Comparator.comparingDouble(InterestingBlock::distance)).limit(5)
                .forEach(block -> {
                    JsonObject item = new JsonObject(); item.addProperty("id", block.id());
                    item.addProperty("distance", block.distance());
                    item.addProperty("x", block.x()); item.addProperty("y", block.y()); item.addProperty("z", block.z());
                    blocksOfInterest.add(item);
                });
        hud.add("nearbyBlocks", blocksOfInterest);
        JsonArray entities = new JsonArray();
        List<net.minecraft.world.entity.Entity> nearby = level.getEntities(self,
                new AABB(self.getX() - 12, self.getY() - 10, self.getZ() - 12,
                        self.getX() + 12, self.getY() + 10, self.getZ() + 12),
                entity -> entity.isAlive() && !entity.isSpectator());
        nearby.stream().sorted(Comparator.comparingDouble(self::distanceToSqr)).limit(6).forEach(entity -> {
            JsonObject item = new JsonObject();
            item.addProperty("id", BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString());
            item.addProperty("distance", Math.sqrt(self.distanceToSqr(entity)));
            item.addProperty("x", entity.getX()); item.addProperty("y", entity.getY()); item.addProperty("z", entity.getZ());
            entities.add(item);
        });
        hud.add("nearbyEntities", entities);
        snapshot.add("hud", hud);
        try {
            Path directory = source.getServer().getServerDirectory().resolve("vision");
            Files.createDirectories(directory);
            Path target = directory.resolve("kirito-latest.json");
            Path temp = directory.resolve("kirito-latest.json.tmp");
            Files.writeString(temp, snapshot.toString(), StandardCharsets.UTF_8);
            try { Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
            catch (java.nio.file.AtomicMoveNotSupportedException ignored) {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
            }
            int blockCount = blocks.size() / 2;
            source.sendSuccess(() -> Component.literal("snapshot ok sampledAt=" + sampledAt
                    + " blocks=" + blockCount), false);
            return 1;
        } catch (IOException failure) {
            source.sendFailure(Component.literal("snapshot write_failed"));
            return 0;
        }
    }

    private static boolean notable(String id) {
        return id.endsWith("_ore") || id.contains("chest") || id.contains("spawner")
                || id.contains("portal") || id.contains("crafting_table") || id.contains("furnace")
                || id.contains("anvil") || id.contains("barrel") || id.endsWith("_bed")
                || id.equals("minecraft:lava") || id.equals("minecraft:fire")
                || id.contains("beehive");
    }
}
