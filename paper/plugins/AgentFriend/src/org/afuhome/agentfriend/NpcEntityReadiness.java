package org.afuhome.agentfriend;

import java.util.HashMap;
import java.util.Map;
import org.bukkit.Chunk;
import org.bukkit.Location;
import org.bukkit.scheduler.BukkitTask;
import org.bukkit.plugin.java.JavaPlugin;

/** Terrain readiness does not prove that persisted entities have arrived (Youer).
 * Never interpret a pending entity read as permission to create another NPC. */
final class NpcEntityReadiness implements AutoCloseable {
    private final JavaPlugin plugin;
    private final Map<String, Pending> pending = new HashMap<>();
    private final Map<String, Lease> leases = new HashMap<>();
    private record Lease(Chunk chunk, boolean owned, int references) { }
    private record Pending(BukkitTask task, String chunkKey) { }
    NpcEntityReadiness(JavaPlugin plugin) { this.plugin = plugin; }

    boolean ready(String role, Location at, Runnable retry) {
        Chunk chunk = at.getWorld().getChunkAt(at);
        if (chunk.isEntitiesLoaded()) return true;
        if (pending.containsKey(role)) return false;
        String key = chunk.getWorld().getUID() + ":" + chunk.getX() + ":" + chunk.getZ();
        Lease lease = leases.get(key);
        if (lease == null) leases.put(key, new Lease(chunk, chunk.addPluginChunkTicket(plugin), 1));
        else leases.put(key, new Lease(chunk, lease.owned(), lease.references() + 1));
        int[] ticks = {0};
        BukkitTask task = plugin.getServer().getScheduler().runTaskTimer(plugin, () -> {
            if (chunk.isEntitiesLoaded()) {
                finish(role, key);
                retry.run();
            } else if (++ticks[0] >= 200) {
                finish(role, key);
                plugin.getLogger().warning("NPC entities still pending; no replacement spawned: " + role);
            }
        }, 1L, 1L);
        pending.put(role, new Pending(task, key));
        return false;
    }
    void cancel(String role) {
        Pending task = pending.get(role);
        if (task != null) finish(role, task.chunkKey());
    }
    private void finish(String role, String key) {
        Pending task = pending.remove(role);
        if (task != null) task.task().cancel();
        Lease lease = leases.get(key);
        if (lease == null) return;
        if (lease.references() > 1) leases.put(key, new Lease(lease.chunk(), lease.owned(), lease.references() - 1));
        else { leases.remove(key); if (lease.owned()) lease.chunk().removePluginChunkTicket(plugin); }
    }
    @Override public void close() {
        pending.values().forEach(t -> t.task().cancel()); pending.clear();
        leases.values().stream().filter(Lease::owned).forEach(l -> l.chunk().removePluginChunkTicket(plugin));
        leases.clear();
    }
}
