package org.afuhome.agentfriend;

import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.craftbukkit.CraftWorld;

/** Paper 1.20.6's Bukkit enum folds all datapack biomes into CUSTOM. Keep the
 * native namespaced registry key instead; observations never load a chunk. */
final class WorldBiomes {
    private WorldBiomes() { }

    static String at(Block block) { return at(block.getLocation()); }

    static String at(Location at) {
        if (at == null || !(at.getWorld() instanceof CraftWorld world)
                || at.getBlockY() < world.getMinHeight() || at.getBlockY() >= world.getMaxHeight()) return "unknown";
        var chunk = world.getHandle().getChunkSource()
                .getChunkAtIfLoadedImmediately(at.getBlockX() >> 4, at.getBlockZ() >> 4);
        return chunk == null ? "unknown" : chunk.getNoiseBiome(at.getBlockX() >> 2,
                at.getBlockY() >> 2, at.getBlockZ() >> 2).unwrapKey()
                .map(key -> key.location().toString()).orElse("unknown");
    }

    static boolean registered(String key) {
        ResourceLocation id = ResourceLocation.tryParse(key);
        if (id == null) return false;
        // The legacy plugin remapper aliases the Mojang Registry return type to
        // IdMap on this Paper build. Resolve these two methods at configuration
        // load time, without changing mappings for the rest of the plugin.
        for (var world : Bukkit.getWorlds()) try {
            Object access = ((CraftWorld) world).getHandle().registryAccess();
            var lookup = access.getClass().getMethod("registryOrThrow", net.minecraft.resources.ResourceKey.class);
            lookup.setAccessible(true);
            Object registry = lookup.invoke(access, Registries.BIOME);
            var contains = registry.getClass().getMethod("containsKey", ResourceLocation.class);
            contains.setAccessible(true);
            if ((Boolean) contains.invoke(registry, id)) return true;
        } catch (ReflectiveOperationException ex) {
            throw new IllegalStateException("Native biome registry unavailable", ex);
        }
        return false;
    }
}
