package org.bukkit;

import fixture.AuraPlugin;
import java.util.concurrent.ConcurrentLinkedQueue;
import org.bukkit.plugin.Plugin;

/** Test-only scheduler; never included in the patch agent JAR. */
public final class Bukkit {
    private static final Thread MAIN = Thread.currentThread();
    private static final PluginManager MANAGER = new PluginManager();
    private static final Scheduler SCHEDULER = new Scheduler();
    public static PluginManager getPluginManager() { return MANAGER; }
    public static Scheduler getScheduler() { return SCHEDULER; }
    public static boolean isPrimaryThread() { return Thread.currentThread() == MAIN; }
    public static void pump() { Runnable task; while ((task = SCHEDULER.queue.poll()) != null) task.run(); }
    public static final class PluginManager {
        private final AuraPlugin plugin = new AuraPlugin();
        public Plugin getPlugin(String name) { return name.equals("AuraSkills") ? plugin : null; }
        public AuraPlugin aura() { return plugin; }
    }
    public static final class Scheduler {
        private final ConcurrentLinkedQueue<Runnable> queue = new ConcurrentLinkedQueue<>();
        public Object runTask(Plugin plugin, Runnable task) { queue.add(task); return new Object(); }
    }
}
