package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.world.data.MaidInfo;
import com.github.tartaricacid.touhoulittlemaid.world.data.MaidWorldData;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Map;
import java.util.function.BooleanSupplier;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.Chunk;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.craftbukkit.CraftWorld;
import org.bukkit.plugin.Plugin;

/** TLM's live-maid index gives a search location. The caller must still verify the loaded entity and owner. */
final class NativeMaidLocation {
    private static final Map<Chunk, Integer> tickets = new HashMap<>();
    private static final int TRACKING_TIMEOUT_TICKS = 60;

    private NativeMaidLocation() {}

    // The chunk can be loaded several ticks before its entities are registered on Youer.
    static void whenTracked(Plugin plugin, Collection<UUID> ids, BooleanSupplier stillValid, Runnable finish) {
        awaitTracking(plugin, ids, stillValid, finish, TRACKING_TIMEOUT_TICKS);
    }

    private static void awaitTracking(Plugin plugin, Collection<UUID> ids, BooleanSupplier stillValid,
                                      Runnable finish, int remaining) {
        if (remaining <= 0 || !stillValid.getAsBoolean() || ids.stream().allMatch(id -> Bukkit.getEntity(id) != null)) {
            finish.run();
            return;
        }
        Bukkit.getScheduler().runTaskLater(plugin, () -> awaitTracking(plugin, ids, stillValid, finish, remaining - 2), 2);
    }

    static void release(Chunk chunk, Plugin plugin) {
        Integer count = tickets.get(chunk);
        if (count == null) return;
        if (count > 1) tickets.put(chunk, count - 1);
        else {
            tickets.remove(chunk);
            chunk.removePluginChunkTicket(plugin);
        }
    }

    static Location indexed(UUID owner, UUID maid) {
        if (Bukkit.getWorlds().isEmpty()) return null;
        var data = MaidWorldData.get(((CraftWorld) Bukkit.getWorlds().getFirst()).getHandle());
        var rows = data == null ? null : data.getInfos(owner);
        if (rows == null) return null;
        var row = rows.stream().filter(r -> owner.equals(r.getOwnerId()) && maid.equals(r.getEntityId()))
            .max(Comparator.comparingLong(MaidInfo::getTimestamp)).orElse(null);
        if (row == null) return null;
        var key = NamespacedKey.fromString(row.getDimension());
        World world = key == null ? null : Bukkit.getWorld(key);
        var block = row.getChunkPos(); // TLM stores a BlockPos even though its NBT key is ChunkPos.
        return world == null || block == null ? null : new Location(world, block.getX(), block.getY(), block.getZ());
    }

    static Chunk loadExisting(Location hint, Plugin plugin) {
        if (hint == null || hint.getWorld() == null) return null;
        World world = hint.getWorld();
        int x = hint.getBlockX() >> 4, z = hint.getBlockZ() >> 4;
        if (!world.isChunkGenerated(x, z) || !world.loadChunk(x, z, false)) return null;
        Chunk chunk = world.getChunkAt(x, z);
        if (tickets.containsKey(chunk)) {
            tickets.merge(chunk, 1, Integer::sum);
            return chunk;
        }
        boolean ownedTicket = chunk.addPluginChunkTicket(plugin);
        if (ownedTicket) tickets.put(chunk, 1);
        try {
            if (!chunk.isEntitiesLoaded()) chunk.getEntities();
            return ownedTicket ? chunk : null;
        } catch (RuntimeException error) {
            if (ownedTicket) release(chunk, plugin);
            throw error;
        }
    }
}
