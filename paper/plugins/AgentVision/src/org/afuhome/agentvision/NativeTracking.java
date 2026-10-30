package org.afuhome.agentvision;

import it.unimi.dsi.fastutil.ints.Int2ObjectMap;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Set;
import net.minecraft.server.level.ChunkMap;
import net.minecraft.server.level.ServerPlayer;
import org.bukkit.craftbukkit.CraftWorld;
import org.bukkit.craftbukkit.entity.CraftEntity;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;

/** Resolve platform-specific tracking once, before installing the visibility filter. */
final class NativeTracking {
    private final Method chunkLoader, chunkSent, trackedEntity, removePlayer, updatePlayer;
    private final Field entityMap, seenBy;
    private final boolean paperChunkApi;

    NativeTracking() {
        try {
            chunkLoader = optional(ServerPlayer.class, "moonrise$getChunkLoader");
            trackedEntity = optional(net.minecraft.world.entity.Entity.class, "moonrise$getTrackedEntity");
            Method sent = optional(Player.class, "isChunkSent", long.class);
            paperChunkApi = sent != null;
            chunkSent = paperChunkApi ? sent : method(ChunkMap.class, "isChunkTracked", ServerPlayer.class, int.class, int.class);
            entityMap = trackedEntity != null ? null : field(ChunkMap.class, "entityMap");
            Class<?> tracker = Class.forName("net.minecraft.server.level.ChunkMap$TrackedEntity");
            seenBy = field(tracker, "seenBy");
            removePlayer = method(tracker, "removePlayer", ServerPlayer.class);
            updatePlayer = method(tracker, "updatePlayer", ServerPlayer.class);
        } catch (ReflectiveOperationException failure) {
            throw new IllegalStateException("Unsupported entity tracking API; AgentVision was not installed", failure);
        }
    }

    String platform() { return paperChunkApi ? "paper-moonrise" : "vanilla-chunk-map"; }

    private static Method optional(Class<?> type, String name, Class<?>... args) {
        try { return method(type, name, args); }
        catch (NoSuchMethodException missing) { return null; }
    }

    private static Method method(Class<?> type, String name, Class<?>... args) throws NoSuchMethodException {
        Method method = type.getDeclaredMethod(name, args); method.setAccessible(true); return method;
    }

    private static Field field(Class<?> type, String name) throws NoSuchFieldException {
        Field field = type.getDeclaredField(name); field.setAccessible(true); return field;
    }

    private static Object invoke(Method method, Object owner, Object... args) {
        try { return method.invoke(owner, args); }
        catch (ReflectiveOperationException failure) { throw new IllegalStateException("Entity tracking API failed", failure); }
    }

    private static Object read(Field field, Object owner) {
        try { return field.get(owner); }
        catch (IllegalAccessException failure) { throw new IllegalStateException("Entity tracking API failed", failure); }
    }

    private static ServerPlayer handle(Player player) { return ((CraftPlayer) player).getHandle(); }
    private static ChunkMap map(Entity entity) { return ((CraftWorld) entity.getWorld()).getHandle().getChunkSource().chunkMap; }

    boolean streamReady(Player player) {
        return player.isOnline() && (chunkLoader == null ? handle(player).connection != null : invoke(chunkLoader, handle(player)) != null);
    }

    boolean chunkSent(Player viewer, Entity target) {
        var pos = ((CraftEntity) target).getHandle().chunkPosition();
        return paperChunkApi ? (Boolean) invoke(chunkSent, viewer, pos.toLong())
                : (Boolean) invoke(chunkSent, map(viewer), handle(viewer), pos.x, pos.z);
    }

    private Object tracker(Entity target) {
        return trackedEntity != null ? invoke(trackedEntity, ((CraftEntity) target).getHandle())
                : ((Int2ObjectMap<?>) read(entityMap, map(target))).get(target.getEntityId());
    }

    void forgetCancelledPair(Player viewer, Entity target) {
        Object tracker = tracker(target);
        if (tracker != null) ((Set<?>) read(seenBy, tracker)).remove(handle(viewer).connection);
    }

    void hidePlayer(Player viewer, Player target) {
        Object tracker = tracker(target);
        if (tracker != null) invoke(removePlayer, tracker, handle(viewer));
    }

    void restorePlayer(Player viewer, Player target) {
        Object tracker = tracker(target);
        if (tracker != null && target.isOnline() && viewer.getWorld() == target.getWorld() && viewer.canSee(target))
            invoke(updatePlayer, tracker, handle(viewer));
    }
}
