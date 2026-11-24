package org.qiandengji.villagerquests;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.logging.Logger;
import org.bukkit.Location;
import org.bukkit.entity.Villager;

/** Uses the vanilla brain and door handling on Paper and the Youer Bukkit layer. */
final class NativeVillagerWalk {
    private final Logger logger;
    private Method handle;
    private Method getBrain;
    private Method setMemory;
    private Constructor<?> blockPos;
    private Constructor<?> walkTarget;
    private Object walkType;
    private boolean unavailable;

    NativeVillagerWalk(Logger logger) { this.logger = logger; }

    /** Returns false unless the native brain actually accepted the target. */
    boolean move(Villager body, Location at) {
        if (unavailable) return false;
        try {
            if (handle == null) connect(body);
            Object brain = getBrain.invoke(handle.invoke(body));
            Object point = blockPos.newInstance(at.getBlockX(), at.getBlockY(), at.getBlockZ());
            setMemory.invoke(brain, walkType, walkTarget.newInstance(point, 0.6f, 1));
            return true;
        } catch (ReflectiveOperationException | LinkageError failure) {
            unavailable = true;
            logger.warning("Trial entrance residents cannot issue native walk targets on this server: " + failure.getClass().getSimpleName());
            return false;
        }
    }

    /** Clears only the controller walk while it owns the body; vanilla AI itself stays enabled. */
    boolean clear(Villager body) {
        if (unavailable) return false;
        try {
            if (handle == null) connect(body);
            Object brain = getBrain.invoke(handle.invoke(body));
            setMemory.invoke(brain, walkType, (Object) null);
            return true;
        } catch (ReflectiveOperationException | LinkageError failure) {
            unavailable = true;
            logger.warning("Villager walk memory could not be cleared: " + failure.getClass().getSimpleName());
            return false;
        }
    }

    private void connect(Villager body) throws ReflectiveOperationException {
        handle = body.getClass().getMethod("getHandle");
        Class<?> nativeBody = handle.getReturnType();
        ClassLoader loader = nativeBody.getClassLoader();
        Class<?> position = Class.forName("net.minecraft.core.BlockPos", true, loader);
        Class<?> memoryType = Class.forName("net.minecraft.world.entity.ai.memory.MemoryModuleType", true, loader);
        Class<?> target = Class.forName("net.minecraft.world.entity.ai.memory.WalkTarget", true, loader);
        getBrain = nativeBody.getMethod("getBrain");
        setMemory = getBrain.getReturnType().getMethod("setMemory", memoryType, Object.class);
        blockPos = position.getConstructor(int.class, int.class, int.class);
        walkTarget = target.getConstructor(position, float.class, int.class);
        walkType = memoryType.getField("WALK_TARGET").get(null);
    }
}
