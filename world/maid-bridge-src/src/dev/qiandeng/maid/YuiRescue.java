package dev.qiandeng.maid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.*;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Set;
import java.util.UUID;

/** Explicit operator rescue for the existing pair; inspection never teleports or loads chunks. */
public final class YuiRescue {
    public static final UUID YUI = UUID.fromString("e6ef6001-47c6-4f13-823c-1b724520d164");
    public static final UUID KIRITO = UUID.fromString("d4ac9523-4962-43ed-98c5-19b49e104048");
    private static final RescueJournal JOURNAL = new RescueJournal(Path.of("data/qiandeng-maid-bridge/rescue"));
    private static final long TTL = 180000;
    private YuiRescue() {}
    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("qdmaid").requires(s -> s.hasPermission(4) && s.getEntity() == null)
            .then(Commands.literal("rescue_inspect").then(Commands.argument("quoteId", StringArgumentType.word())
                .executes(c -> inspect(c.getSource(), StringArgumentType.getString(c, "quoteId")))))
            .then(Commands.literal("rescue_status").then(Commands.argument("actionId", StringArgumentType.word())
                .executes(c -> status(c.getSource(), StringArgumentType.getString(c, "actionId")))))
            .then(Commands.literal("rescue").then(Commands.argument("actionId", StringArgumentType.word())
                .then(Commands.argument("quoteId", StringArgumentType.word())
                    .then(Commands.argument("target", StringArgumentType.word()).executes(c -> execute(c.getSource(),
                        StringArgumentType.getString(c, "actionId"), StringArgumentType.getString(c, "quoteId"),
                        StringArgumentType.getString(c, "target"))))))));
    }
    private static LivingEntity[] pair(CommandSourceStack source) {
        MaidBridge.requireThread(source.getServer());
        ServerPlayer kirito = source.getServer().getPlayerList().getPlayer(KIRITO);
        if (kirito == null || !kirito.getClass().getName().equals("com.dwinovo.numen.entity.NumenPlayer")
                || !kirito.isAlive() || kirito.hasDisconnected()) throw new BridgeProtocol.Failure("live_kirito_required");
        EntityMaid yui = MaidBridge.find(source.getServer(), YUI);
        if (!yui.isTame() || !KIRITO.equals(yui.getOwnerUUID())) throw new BridgeProtocol.Failure("owner_changed");
        if (kirito.level() != yui.level()) throw new BridgeProtocol.Failure("same_dimension_required");
        return new LivingEntity[]{kirito, yui};
    }
    private static JsonObject state(LivingEntity entity) {
        JsonObject out = new JsonObject(); out.addProperty("bodyUuid", entity.getStringUUID());
        out.addProperty("dimension", entity.level().dimension().location().toString());
        out.add("position", position(entity.position())); return out;
    }
    private static JsonArray position(Vec3 value) {
        JsonArray out = new JsonArray(); out.add(value.x); out.add(value.y); out.add(value.z); return out;
    }
    private static Vec3 vec(JsonObject value) {
        JsonArray p = value.getAsJsonArray("position"); return new Vec3(p.get(0).getAsDouble(), p.get(1).getAsDouble(), p.get(2).getAsDouble());
    }
    private static boolean hazardous(net.minecraft.world.level.block.state.BlockState block) {
        return !block.getFluidState().isEmpty() || block.is(Blocks.CACTUS) || block.is(Blocks.MAGMA_BLOCK)
            || block.is(Blocks.FIRE) || block.is(Blocks.SOUL_FIRE) || block.is(Blocks.CAMPFIRE)
            || block.is(Blocks.SOUL_CAMPFIRE) || block.is(Blocks.POWDER_SNOW) || block.is(Blocks.WITHER_ROSE)
            || block.is(Blocks.SWEET_BERRY_BUSH);
    }
    static boolean safe(LivingEntity body, Vec3 point) {
        ServerLevel level = (ServerLevel) body.level(); BlockPos feet = BlockPos.containing(point);
        AABB bounds = body.getBoundingBox().move(point.subtract(body.position()));
        if (!level.getWorldBorder().isWithinBounds(bounds) || feet.getY() <= level.getMinBuildHeight()
                || bounds.maxY >= level.getMaxBuildHeight() || !level.hasChunksAt(BlockPos.containing(bounds.minX, bounds.minY - 1, bounds.minZ),
                    BlockPos.containing(bounds.maxX, bounds.maxY, bounds.maxZ)) || !level.canSeeSky(feet)
                || !level.noCollision(body, bounds)) return false;
        for (BlockPos p : BlockPos.betweenClosed(BlockPos.containing(bounds.minX, bounds.minY - 0.01, bounds.minZ),
                BlockPos.containing(bounds.maxX - 0.0001, bounds.maxY, bounds.maxZ - 0.0001)))
            if (hazardous(level.getBlockState(p))) return false;
        for (BlockPos p : BlockPos.betweenClosed(BlockPos.containing(bounds.minX, feet.getY() - 1, bounds.minZ),
                BlockPos.containing(bounds.maxX - 0.0001, feet.getY() - 1, bounds.maxZ - 0.0001)))
            if (!level.getBlockState(p).isFaceSturdy(level, p, Direction.UP) || hazardous(level.getBlockState(p))) return false;
        return level.getEntities(body, bounds, other -> other.isAlive() && !other.isSpectator()).isEmpty();
    }
    private static JsonObject landing(LivingEntity body) {
        ServerLevel level = (ServerLevel) body.level(); BlockPos origin = body.blockPosition();
        for (int pass = 0; pass < 2; pass++) for (int ring = 2; ring <= 16; ring++) for (int dx = -ring; dx <= ring; dx++) for (int dz = -ring; dz <= ring; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) != ring || dx * dx + dz * dz > 256) continue;
            BlockPos column = new BlockPos(origin.getX() + dx, origin.getY(), origin.getZ() + dz);
            if (!level.hasChunkAt(column)) continue;
            int y = level.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, column.getX(), column.getZ());
            // Rescue does not merely shift to another cell on the current pit floor.
            if (pass == 0 ? y < origin.getY() + 2 : y > origin.getY() - 2 || dx * dx + dz * dz < 16) continue;
            Vec3 point = new Vec3(column.getX() + 0.5, y, column.getZ() + 0.5);
            if (!safe(body, point)) continue;
            JsonObject result = state(body); result.add("position", position(point)); return result;
        }
        return null;
    }
    private static JsonObject base(String action, String quote, String target, String phase, String code) {
        JsonObject out = new JsonObject(); out.addProperty("schema", 1);
        out.addProperty("requestId", action); out.addProperty("quoteId", quote); out.addProperty("target", target);
        out.addProperty("ok", phase.equals("completed") || phase.equals("observed"));
        out.addProperty("phase", phase); out.addProperty("code", code);
        out.addProperty("executionConfirmed", phase.equals("completed"));
        out.addProperty("observedAt", System.currentTimeMillis()); return out;
    }
    private static int inspect(CommandSourceStack source, String quoteText) {
        JsonObject out;
        try {
            UUID quote = BridgeProtocol.uuid(quoteText); MaidBridge.requireThread(source.getServer());
            JsonObject prior = JOURNAL.quote(quote);
            if (prior != null) return emit(source, prior);
            LivingEntity[] pair = pair(source); out = base(null, quoteText, null, "observed", "rescue_inspected");
            JsonObject identities = new JsonObject(), landings = new JsonObject();
            for (int index = 0; index < 2; index++) {
                String name = index == 0 ? "kirito" : "yui";
                identities.add(name, state(pair[index])); landings.add(name, landing(pair[index]));
            }
            out.add("pair", identities); out.add("safeLandings", landings);
            out.addProperty("expiresAt", out.get("observedAt").getAsLong() + TTL); JOURNAL.putQuote(quote, out);
        } catch (BridgeProtocol.Failure error) { out = base(null, quoteText, null, "rejected", error.code); }
        catch (Exception error) { out = base(null, quoteText, null, "unknown", "inspection_unavailable"); }
        return emit(source, out);
    }
    private static int execute(CommandSourceStack source, String actionText, String quoteText, String target) {
        JsonObject input = new JsonObject(), out = null; UUID action = null; String fingerprint = null;
        boolean claimed = false, sent = false;
        try {
            MaidBridge.requireThread(source.getServer()); action = BridgeProtocol.uuid(actionText); UUID quoteId = BridgeProtocol.uuid(quoteText);
            if (!Set.of("kirito", "yui").contains(target)) throw new BridgeProtocol.Failure("invalid_rescue_target");
            input.addProperty("requestId", actionText); input.addProperty("quoteId", quoteText); input.addProperty("target", target);
            fingerprint = BridgeProtocol.sha256(input.toString().getBytes(StandardCharsets.UTF_8));
            out = base(actionText, quoteText, target, "unknown", "outcome_unknown");
            JsonObject prior = JOURNAL.claim(action, fingerprint, input, out); if (prior != null) return emit(source, prior);
            claimed = true;
            JsonObject quote = JOURNAL.quote(quoteId);
            if (quote == null) throw new BridgeProtocol.Failure("quote_not_found");
            long age = System.currentTimeMillis() - quote.get("observedAt").getAsLong();
            if (age < 0 || age > TTL) throw new BridgeProtocol.Failure("quote_expired");
            LivingEntity body = pair(source)[target.equals("kirito") ? 0 : 1];
            JsonObject before = quote.getAsJsonObject("pair").getAsJsonObject(target);
            if (!before.get("bodyUuid").getAsString().equals(body.getStringUUID())
                    || !before.get("dimension").getAsString().equals(body.level().dimension().location().toString())
                    || body.position().distanceToSqr(vec(before)) > 0.75 * 0.75)
                throw new BridgeProtocol.Failure("quote_source_moved");
            JsonElement candidate = quote.getAsJsonObject("safeLandings").get(target);
            if (candidate == null || candidate.isJsonNull()) throw new BridgeProtocol.Failure("no_safe_landing");
            JsonObject destination = candidate.getAsJsonObject(); Vec3 point = vec(destination);
            if (!destination.get("bodyUuid").equals(before.get("bodyUuid")) || !destination.get("dimension").equals(before.get("dimension"))
                    || !safe(body, point)) throw new BridgeProtocol.Failure("landing_changed");
            UUID useId = UUID.nameUUIDFromBytes(("rescue_quote_target\n" + quoteId + "\n" + target).getBytes(StandardCharsets.UTF_8));
            JOURNAL.claim(useId, fingerprint, input, base(actionText, quoteText, target, "unknown", "quote_consumed"));
            out.add("before", state(body)); sent = true;
            if (body instanceof EntityMaid maid) maid.getNavigation().stop();
            body.setDeltaMovement(Vec3.ZERO);
            boolean returned = body.teleportTo((ServerLevel) body.level(), point.x, point.y, point.z, Set.of(), body.getYRot(), body.getXRot());
            body.fallDistance = 0;
            JsonObject after = state(body); boolean confirmed = returned && body.isAlive() && !body.isRemoved()
                && body.position().distanceToSqr(point) < 0.01 * 0.01;
            out.add("after", after); out.addProperty("ok", confirmed); out.addProperty("executionConfirmed", confirmed);
            out.addProperty("phase", confirmed ? "completed" : "unknown");
            out.addProperty("code", confirmed ? "native_teleport_confirmed" : "outcome_unknown");
            out.addProperty("observedAt", System.currentTimeMillis());
        } catch (BridgeProtocol.Failure error) {
            if (out == null) out = base(actionText, quoteText, target, "rejected", error.code);
            out.addProperty("phase", sent ? "unknown" : "rejected"); out.addProperty("code", sent ? "outcome_unknown" : error.code);
            out.addProperty("ok", false); out.addProperty("executionConfirmed", false);
        } catch (Exception error) { out = base(actionText, quoteText, target, "unknown", "outcome_unknown"); }
        if (claimed) try { JOURNAL.finish(action, fingerprint, input, out); }
        catch (Exception error) { out = base(actionText, quoteText, target, "unknown", "outcome_unknown"); }
        return emit(source, out);
    }
    private static int status(CommandSourceStack source, String actionText) {
        JsonObject out;
        try {
            MaidBridge.requireThread(source.getServer()); out = JOURNAL.status(BridgeProtocol.uuid(actionText));
            if (out == null) out = base(actionText, null, null, "rejected", "request_not_found");
        } catch (Exception error) { out = base(actionText, null, null, "unknown", "status_unavailable"); }
        return emit(source, out);
    }
    private static int emit(CommandSourceStack source, JsonObject out) {
        source.sendSuccess(() -> Component.literal("QD_RESCUE_JSON " + out), false);
        return out.get("ok").getAsBoolean() ? 1 : 0;
    }
}
