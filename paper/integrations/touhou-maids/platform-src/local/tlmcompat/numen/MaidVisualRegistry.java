package local.tlmcompat.numen;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.lang.ref.WeakReference;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Entity;

/** Immutable public visual snapshots. Read only; never reads accounts, saves, inventories or a model runtime. */
public final class MaidVisualRegistry {
    public record State(UUID uuid, String modelId, boolean ysm, boolean sitting, boolean sleeping,
                        boolean aiming, boolean working, boolean mainHand, boolean offHand,
                        boolean usingItem, boolean usingOffHand, float attack, float health, float speed,
                        float width, float height, String taskId) {}
    private static final ConcurrentMap<UUID, WeakReference<EntityMaid>> tracked = new ConcurrentHashMap<>();
    private static final ConcurrentMap<UUID, State> states = new ConcurrentHashMap<>();
    private static final CopyOnWriteArrayList<Consumer<State>> listeners = new CopyOnWriteArrayList<>();
    private static final ConcurrentMap<UUID, Set<UUID>> rendered = new ConcurrentHashMap<>();
    private MaidVisualRegistry() {}
    public static State get(UUID id) { return states.get(id); }
    public static void subscribe(Consumer<State> listener) { listeners.addIfAbsent(listener); }
    public static void unsubscribe(Consumer<State> listener) { listeners.remove(listener); }
    public static void rendered(UUID viewer, UUID maid, boolean value) {
        if (value) rendered.computeIfAbsent(viewer, ignored -> ConcurrentHashMap.newKeySet()).add(maid);
        else { var set = rendered.get(viewer); if (set != null) set.remove(maid); }
    }
    public static boolean rendered(UUID viewer, UUID maid) {
        var set = rendered.get(viewer); return set != null && set.contains(maid);
    }
    public static void disconnect(UUID viewer) { if (viewer != null) rendered.remove(viewer); }
    /** Called from native sending / Bukkit's main thread, before a projected spawn can reach Geyser. */
    public static void capture(Entity entity) {
        if (!(entity instanceof EntityMaid maid) || maid.level().isClientSide()) return;
        if (maid.isRemoved() || !maid.isAlive()) { forget(maid.getUUID()); return; }
        tracked.put(maid.getUUID(), new WeakReference<>(maid));
        var task = maid.getTask().getUid().toString();
        var next = new State(maid.getUUID(), maid.isYsmModel()?MaidVisualKey.ysm(maid.getYsmModelId(),maid.getYsmModelTexture()):maid.getModelId(), maid.isYsmModel(), maid.isMaidInSittingPose(),
                maid.isSleeping(), maid.isSwingingArms(), !task.equals("touhou_little_maid:idle"),
                !maid.getMainHandItem().isEmpty(), !maid.getOffhandItem().isEmpty(), maid.isUsingItem(),
                maid.getUsedItemHand() == net.minecraft.world.InteractionHand.OFF_HAND,
                Math.max(0, Math.min(1, maid.getAttackAnim(1))),
                Math.max(0, Math.min(1, maid.getHealth() / Math.max(1, maid.getMaxHealth()))),
                Math.round(Math.min(1, maid.getDeltaMovement().horizontalDistance() * 5) * 100) / 100f,
                maid.getBbWidth(), maid.getBbHeight(), task);
        var old = states.put(next.uuid(), next);
        if (!next.equals(old)) for (var listener : listeners) {
            try { listener.accept(next); }
            catch (RuntimeException error) { java.util.logging.Logger.getLogger("QiandengjiMaidVisuals").warning("Visual subscriber failed: " + error); }
        }
    }
    private static void forget(UUID id) {
        tracked.remove(id); states.remove(id); rendered.values().forEach(set -> set.remove(id));
    }
    /** Main-thread, bounded by already observed loaded maids; never loads a chunk. */
    public static void sampleLoaded() {
        for (var entry : tracked.entrySet()) {
            var maid = entry.getValue().get();
            if (maid == null || maid.isRemoved() || !maid.isAlive()) forget(entry.getKey());
            else capture(maid);
        }
    }
}
