package org.afuhome.agentvision.tests;

import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Collection;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Deterministic reproduction against real Paper, never a production plugin. */
public final class VisibilityLifecycleFixture extends JavaPlugin {
    @Override public void onEnable() {
        if (!getServer().getIp().equals("127.0.0.1") || getServer().getPort() != 25982)
            throw new IllegalStateException("Lifecycle fixture requires the dedicated loopback lab");
        getServer().getCommandMap().register("visiontest", new Command("agentvisionlifecycle") {
            @Override public boolean execute(CommandSender sender, String label, String[] args) {
                if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) return false;
                try { run(sender, args); }
                catch (ReflectiveOperationException failure) { throw new IllegalStateException(failure); }
                return true;
            }
        });
    }

    private static Object field(Object owner, String name) throws ReflectiveOperationException {
        Field value = owner.getClass().getDeclaredField(name); value.setAccessible(true); return value.get(owner);
    }

    private void run(CommandSender sender, String[] args) throws ReflectiveOperationException {
        if (args.length != 1 || !args[0].startsWith("ag_Vision")) throw new IllegalArgumentException("lab Agent name required");
        Player player = Bukkit.getPlayerExact(args[0]);
        if (player == null) throw new IllegalStateException("real protocol client required");
        var vision = Bukkit.getPluginManager().getPlugin("AgentVision");
        Object viewer = ((Map<?, ?>) field(vision, "viewers")).get(player.getUniqueId());
        if (viewer == null) throw new IllegalStateException("managed viewer required");
        Collection<?> queue = (Collection<?>) field(viewer, "pending");
        Map<?, ?> targets = (Map<?, ?>) field(viewer, "targets");
        if (queue.isEmpty()) throw new IllegalStateException("tracked target required");
        int queued = queue.size(), tracked = targets.size();
        Map<UUID, Boolean> visibility = new java.util.HashMap<>();
        for (Object target : targets.values())
            visibility.put(((org.bukkit.entity.Entity) field(target, "entity")).getUniqueId(), (Boolean) field(target, "hidden"));
        Method tick = vision.getClass().getDeclaredMethod("tick"); tick.setAccessible(true);
        var handle = ((CraftPlayer) player).getHandle();
        var loader = handle.moonrise$getChunkLoader();
        if (loader == null) throw new IllegalStateException("start with attached real chunk loader");
        boolean npe = false;
        try {
            // The exact transient Paper state seen in the production death log.
            handle.moonrise$setChunkLoader(null);
            try { tick.invoke(vision); }
            catch (InvocationTargetException failure) {
                if (failure.getCause() instanceof NullPointerException) npe = true;
                else throw failure;
            }
        } finally { handle.moonrise$setChunkLoader(loader); }
        boolean unchanged = queue.size() == queued && targets.size() == tracked;
        for (Object target : targets.values()) {
            UUID id = ((org.bukkit.entity.Entity) field(target, "entity")).getUniqueId();
            unchanged &= visibility.get(id).equals(field(target, "hidden"));
        }
        tick.invoke(vision); // Recovery uses the same queue after reattachment.
        sender.sendMessage("MC_VISION_LIFECYCLE {\"npe\":" + npe + ",\"queueRetained\":" + unchanged
                + ",\"loaderRestored\":" + (handle.moonrise$getChunkLoader() == loader)
                + ",\"queuedBefore\":" + queued + ",\"trackedBefore\":" + tracked
                + ",\"otherViewersStillQueued\":" + (((Collection<?>) field(vision, "roundRobin")).size() >= 1) + "}");
    }
}
