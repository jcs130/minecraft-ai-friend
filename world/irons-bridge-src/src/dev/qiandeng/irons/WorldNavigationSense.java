package dev.qiandeng.irons;

import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.task.CompanionTickDispatcher;
import com.dwinovo.numen.task.Task;
import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.DoubleArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Map;
import java.util.UUID;

/** Read the existing body's scheduler and loaded collision geometry. Never dispatch,
 * select/tick a task, load a chunk, change a destination, or promise a route. */
public final class WorldNavigationSense {
    public static final String PREFIX = "QD_NAVIGATION_SENSE_JSON ";
    private static final String CAPABILITY = "numen_navigation_sense_v1";
    private WorldNavigationSense() {}

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        var actor = Commands.argument("actor", StringArgumentType.word())
            .executes(c -> run(c.getSource(), StringArgumentType.getString(c, "actor"), null));
        actor.then(Commands.argument("x", DoubleArgumentType.doubleArg(-29999980, 29999980))
            .then(Commands.argument("y", DoubleArgumentType.doubleArg(-64, 319))
                .then(Commands.argument("z", DoubleArgumentType.doubleArg(-29999980, 29999980))
                    .executes(c -> run(c.getSource(), StringArgumentType.getString(c, "actor"), new Vec3(
                        DoubleArgumentType.getDouble(c, "x"), DoubleArgumentType.getDouble(c, "y"),
                        DoubleArgumentType.getDouble(c, "z")))))));
        dispatcher.register(Commands.literal("qdworld").requires(s -> s.hasPermission(2))
            .then(Commands.literal("navigation_sense").then(actor)));
    }

    private static Object field(Class<?> type, String name, Object instance) throws ReflectiveOperationException {
        Field value = type.getDeclaredField(name);
        if (!value.trySetAccessible()) throw new IllegalAccessException();
        return value.get(instance);
    }

    /** The pinned Numen API exposes queued records, but not its selected holder.
     * Read exactly its existing map/holder: brainFor/canRun would mutate scheduling.
     * A changed layout is explicitly unavailable, never guessed from task_status. */
    private static JsonObject control(NumenPlayer actor) {
        var out = new JsonObject(); out.addProperty("available", false);
        out.addProperty("sample", "last_native_scheduler_selection");
        try {
            Object map = field(CompanionTickDispatcher.class, "BRAINS", null);
            if (!(map instanceof Map<?, ?> brains)) throw new ReflectiveOperationException();
            Object brain = brains.get(actor.getUUID());
            if (brain == null) { out.addProperty("code", "brain_not_initialized"); return out; }
            Class<?> type = brain.getClass();
            if (!type.getName().equals("com.dwinovo.numen.task.CompanionBrain")
                    || field(type, "body", brain) != actor) throw new ReflectiveOperationException();
            Object holder = field(type, "holder", brain);
            String kind, name;
            if (holder == null) { kind = "idle"; name = "none"; }
            else if (holder == field(type, "syncProxy", brain)) { kind = "synchronous_task"; name = "sync_slot"; }
            else if (holder == field(type, "currentProxy", brain)) { kind = "background_task"; name = "current_slot"; }
            else if (holder instanceof Task task) {
                Object nativeReflexes = field(type, "reflexes", brain);
                if (!(nativeReflexes instanceof java.util.List<?> reflexes)) throw new ReflectiveOperationException();
                kind = reflexes.stream().anyMatch(v -> v == holder) ? "reflex" : "idle_pose";
                name = task.name();
                if (name == null || !name.matches("[A-Za-z0-9_:-]{1,80}")) throw new ReflectiveOperationException();
            } else throw new ReflectiveOperationException();
            out.addProperty("available", true); out.addProperty("code", "observed");
            out.addProperty("kind", kind); out.addProperty("name", name);
            out.addProperty("nativeAvoidanceActive", kind.equals("reflex") && name.equals("mob_defense"));
            out.addProperty("notice", "A reflex may move the body without a queued model action. This is a current tick sample, not proof of historical teleportation.");
        } catch (ReflectiveOperationException | RuntimeException error) { out.addProperty("code", "native_scheduler_layout_unavailable"); }
        return out;
    }

    private static JsonObject position(double x, double y, double z) {
        var out = new JsonObject(); out.addProperty("x", x); out.addProperty("y", y); out.addProperty("z", z); return out;
    }

    // Check the collision-query margin before any level query (neighbor shapes may
    // read their adjacent blocks). getChunkNow never creates or loads a chunk.
    private static boolean loaded(ServerLevel level, BlockPos center) {
        for (int x = (center.getX()-2)>>4; x <= (center.getX()+2)>>4; x++)
            for (int z = (center.getZ()-2)>>4; z <= (center.getZ()+2)>>4; z++)
                if (level.getChunkSource().getChunkNow(x,z) == null) return false;
        return true;
    }

    private record Landing(Vec3 position, String support, double distanceSquared) {}

    private static JsonObject destination(NumenPlayer actor, Vec3 requested) {
        var out = new JsonObject(); out.add("requested", position(requested.x, requested.y, requested.z));
        out.addProperty("available", false); out.addProperty("pathVerified", false);
        out.addProperty("destinationChanged", false);
        out.addProperty("notice", "Candidates are currently loaded dry collision-free supported standing positions, not a verified path or hazard-free route. Choose one explicitly; original coordinates are unchanged.");
        if (actor.position().distanceToSqr(requested) > 32*32) { out.addProperty("code", "target_outside_local_survey"); return out; }
        var level = actor.serverLevel(); BlockPos target = BlockPos.containing(requested);
        if (!loaded(level,target)) { out.addProperty("code", "target_chunk_unloaded"); return out; }
        var targetState = level.getBlockState(target);
        out.addProperty("targetBlock", BuiltInRegistries.BLOCK.getKey(targetState.getBlock()).toString());
        double width = actor.getBbWidth(), height = actor.getBbHeight();
        var targetBox = new AABB(target.getX()+.5-width/2,requested.y+.001,target.getZ()+.5-width/2,
            target.getX()+.5+width/2,requested.y+height,target.getZ()+.5+width/2);
        boolean collision = level.getBlockCollisions(actor,targetBox).iterator().hasNext();
        boolean liquid = level.containsAnyLiquid(targetBox);
        boolean supported = level.getBlockCollisions(actor,targetBox.move(0,-.025,0)).iterator().hasNext();
        out.addProperty("requestedStanceClear", !collision && !liquid);
        out.addProperty("requestedStanceSupported", !collision && !liquid && supported);
        out.addProperty("code", collision ? "target_body_collision" : liquid ? "target_contains_fluid" : !supported ? "requested_height_unsupported" : "requested_stance_observed");
        var candidates = new ArrayList<Landing>(); int examined = 0, unloaded = 0;
        for (int dx=-2;dx<=2;dx++) for(int dz=-2;dz<=2;dz++) for(int dy=-3;dy<=1;dy++) {
            BlockPos support = target.offset(dx,dy,dz); examined++;
            if (support.getY()<level.getMinBuildHeight() || support.getY()+3>=level.getMaxBuildHeight() || !loaded(level,support)) { unloaded++; continue; }
            var state = level.getBlockState(support);
            if (!state.getFluidState().isEmpty()) continue;
            var shape = state.getCollisionShape(level,support);
            double top = -1;
            for (AABB surface : shape.toAabbs()) {
                if (surface.minX<=.5-width/2 && surface.maxX>=.5+width/2 && surface.minZ<=.5-width/2 && surface.maxZ>=.5+width/2)
                    top = Math.max(top,surface.maxY);
            }
            if (top<0) continue;
            Vec3 point = new Vec3(support.getX()+.5,support.getY()+top,support.getZ()+.5);
            AABB box = new AABB(point.x-width/2,point.y+.001,point.z-width/2,point.x+width/2,point.y+height,point.z+width/2);
            if (level.getBlockCollisions(actor,box).iterator().hasNext() || level.containsAnyLiquid(box)) continue;
            candidates.add(new Landing(point,BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString(),point.distanceToSqr(requested)));
        }
        candidates.sort(Comparator.comparingDouble(Landing::distanceSquared).thenComparingDouble(v->v.position.x).thenComparingDouble(v->v.position.y).thenComparingDouble(v->v.position.z));
        var rows = new JsonArray();
        for (Landing entry : candidates.subList(0,Math.min(5,candidates.size()))) {
            var row = position(entry.position.x,entry.position.y,entry.position.z);
            row.addProperty("supportBlock",entry.support); row.addProperty("pathVerified",false); rows.add(row);
        }
        out.add("candidates",rows); out.addProperty("available",true); out.addProperty("examinedCells",examined);
        out.addProperty("unloadedCells",unloaded); out.addProperty("truncated",candidates.size()>rows.size() || unloaded>0);
        return out;
    }

    private static int run(CommandSourceStack source,String query,Vec3 requested) {
        var out = new JsonObject(); out.addProperty("schema",1);out.addProperty("capability",CAPABILITY);out.addProperty("ok",false);
        try {
            UUID id = UUID.fromString(query);
            if (!id.toString().equals(query)) throw new IllegalArgumentException("actor_uuid_required");
            out.addProperty("actorUuid",query);
            var found = QiandengIronsBridge.resolve(source.getServer(),query);
            if (!(found instanceof NumenPlayer actor) || !actor.isAlive() || actor.hasDisconnected()) throw new IllegalArgumentException("numen_body_unavailable");
            out.addProperty("dimension",actor.level().dimension().location().toString());
            out.addProperty("gameTime",actor.level().getGameTime()); out.addProperty("bodyTickCount",actor.tickCount);
            out.add("position",position(actor.getX(),actor.getY(),actor.getZ()));
            out.add("bodyControl",control(actor));
            var task = CompanionTickDispatcher.currentTaskFor(id);
            if (task == null) out.add("queuedTask",JsonNull.INSTANCE);
            else { var queued = new JsonObject(); queued.addProperty("taskId",task.publicId());queued.addProperty("tool",task.getToolName());queued.addProperty("state",task.getState().name());out.add("queuedTask",queued); }
            if (requested != null) out.add("destination",destination(actor,requested));
            out.addProperty("ok",true);out.addProperty("code","observed");
        } catch (IllegalArgumentException error) { out.addProperty("code","invalid_or_unavailable_actor"); }
          catch (Exception error) { out.addProperty("code","navigation_sense_unavailable"); }
        out.addProperty("observedAt",System.currentTimeMillis());
        source.sendSuccess(()->Component.literal(PREFIX+out),false);
        return out.get("ok").getAsBoolean()?1:0;
    }
}
