package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;

import java.time.Instant;
import java.util.HashSet;

/** Read-only, bounded observations of the requesting connection's real body. */
final class PlayerBodyState {
    // Exact call bindings, checked against modOperationCatalog by the SDK tests.
    static final String NATIVE_OPERATIONS = "inventory.food inventory.consume world.lookAt inventory.select inventory.equip native.craft world.place native.craftRecipe world.dig world.interact colony.management colony.assignCitizen colony.setHiringMode colony.pauseCitizen colony.research colony.startResearch spell.glyphs spell.learnGlyph spell.configure spell.select create.settings create.fluids create.setValue create.setFilter curios.state ysm.catalog ysm.select curios.open curios.page menu.current menu.close menu.click world.look native.recipes native.entity colony.status colony.capabilities colony.resources colony.found colony.placeBuilder colony.placeHut colony.requestBuild colony.deliver colony.stockResource maid.list maid.status maid.tasks maid.setTask maid.setFollow maid.setPickup maid.openBag spell.current spell.list spell.explain spell.cast domum.current domum.state domum.choices domum.select collision.query";

    private static JsonObject position(Vec3 point) {
        JsonObject value = new JsonObject();
        value.addProperty("x", point.x); value.addProperty("y", point.y); value.addProperty("z", point.z);
        return value;
    }

    static JsonObject query(ServerPlayer player, JsonObject input, JsonObject out) {
        String kind = input.get("kind").getAsString();
        out.addProperty("query", kind); out.addProperty("ok", true);
        out.addProperty("bodyId", player.getUUID().toString());
        out.addProperty("bodyKind", "connected_player");
        out.addProperty("capturedAt", Instant.now().toString());
        out.addProperty("capturedTick", player.getServer().getTickCount());
        out.addProperty("dimension", player.level().dimension().location().toString());
        out.add("position", position(player.position()));
        if (kind.equals("capabilities")) {
            out.addProperty("bridgeProtocol", 1);
            out.addProperty("bodySnapshot", true); out.addProperty("bodyObserve", true);
            out.addProperty("numenFakePlayerControl", false);
            out.addProperty("numenRestoreExisting", false);
            out.addProperty("actionLedger", "sdk_local_durable_not_server_global");
            JsonArray operations = new JsonArray();
            for (String id : NATIVE_OPERATIONS.split(" ")) operations.add(id);
            out.add("nativeOperations", operations);
            out.addProperty("permission", "own_connection_normal_player_and_native_mod_permissions");
            out.addProperty("remoteBindingsAdvertised", true);
            out.addProperty("allGameplayVerified", false);
            return out;
        }
        out.addProperty("status", player.isDeadOrDying() ? "dead" : "alive");
        if (kind.equals("body_snapshot")) {
            JsonObject menu = PlayerMenuBridge.snapshot(player);
            // Presentation-only geometry/catalogs are unrelated to body state.
            menu.remove("renderRegistries"); menu.remove("entityRenderStates"); menu.remove("contraptionRenderStates");
            out.add("menu", menu);
            out.add("self", menu.get("self").deepCopy());
            out.addProperty("currentActionSource", "sdk_controller_ledger");
            return out;
        }
        int radius = input.has("radius") ? input.get("radius").getAsInt() : 8;
        if (radius < 1 || radius > 12) throw new IllegalArgumentException("body radius");
        JsonArray blocks = new JsonArray();
        HashSet<BlockPos> seen = new HashSet<>();
        Vec3 eye = player.getEyePosition();
        // 48 first-hit rays, never a cube/ore scan or chunk loading operation.
        for (int i = 0; i < 48; i++) {
            double y = 1 - 2 * (i + .5) / 48, phi = i * 2.399963229728653;
            double r = Math.sqrt(1 - y * y);
            Vec3 end = eye.add(r * Math.cos(phi) * radius, y * radius, r * Math.sin(phi) * radius);
            if (!player.level().hasChunkAt(BlockPos.containing(end))) continue;
            var hit = player.level().clip(new ClipContext(eye, end, ClipContext.Block.OUTLINE, ClipContext.Fluid.NONE, player));
            if (hit.getType() != HitResult.Type.BLOCK || !seen.add(hit.getBlockPos())) continue;
            BlockPos pos = hit.getBlockPos();
            var state = player.level().getBlockState(pos);
            JsonObject block = new JsonObject(), properties = new JsonObject();
            block.add("position", position(Vec3.atLowerCornerOf(pos)));
            block.addProperty("id", BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
            state.getValues().forEach((property, value) -> properties.addProperty(property.getName(), NativeCollisionFacts.propertyValue(property, value)));
            block.add("properties", properties); block.addProperty("visible", true); blocks.add(block);
        }
        JsonArray entities = new JsonArray();
        // Only already tracked identities within local range and line of sight.
        for (Entity entity : player.serverLevel().getEntities(player, player.getBoundingBox().inflate(radius),
                candidate -> candidate.isAlive() && PlayerWorldBridge.isTracked(player, candidate) &&
                        player.distanceTo(candidate) <= radius && player.hasLineOfSight(candidate))) {
            if (entities.size() >= 24) break;
            JsonObject row = new JsonObject();
            row.addProperty("entityId", entity.getId()); row.addProperty("uuid", entity.getUUID().toString());
            row.addProperty("id", BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString());
            row.add("position", position(entity.position()));
            row.addProperty("dimension", player.level().dimension().location().toString());
            if (entity instanceof LivingEntity living) row.addProperty("health", living.getHealth());
            entities.add(row);
        }
        out.add("blocks", blocks); out.add("entities", entities);
        out.addProperty("radius", radius); out.addProperty("complete", false);
        out.addProperty("source", "server_first_hit_rays_and_tracked_visible_entities");
        return out;
    }
}
