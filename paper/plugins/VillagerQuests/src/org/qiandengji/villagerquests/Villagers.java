package org.qiandengji.villagerquests;

import java.lang.reflect.Method;
import java.util.Map;
import java.util.logging.Level;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

/**
 * Where a villager is and how it speaks. Citizens is a soft dependency reached by reflection
 * ({@code CitizensAPI.getNPCRegistry().getById(id)}); without it, or for an unspawned NPC, the configured
 * {@code location} is used. Identity always comes from configuration (npcId), never from chat text.
 */
final class Villagers {
    record Spot(String id, String name, String npcId, Location fallback, double areaRadius, String persona) {}

    private final VillagerQuestsPlugin plugin;
    private Map<String, Spot> spots = Map.of();
    private Method registry, getById, isNpc, getNpc, npcEntity, npcStored, npcIdMethod;
    private boolean citizens;

    Villagers(VillagerQuestsPlugin plugin) {
        this.plugin = plugin;
    }

    void configure(Map<String, Spot> newSpots) {
        this.spots = Map.copyOf(newSpots);
        Plugin c = Bukkit.getPluginManager().getPlugin("Citizens");
        citizens = false;
        if (c == null || !c.isEnabled()) return;
        try {
            ClassLoader loader = c.getClass().getClassLoader();
            Class<?> api = Class.forName("net.citizensnpcs.api.CitizensAPI", true, loader);
            Class<?> reg = Class.forName("net.citizensnpcs.api.npc.NPCRegistry", true, loader);
            Class<?> npc = Class.forName("net.citizensnpcs.api.npc.NPC", true, loader);
            registry = api.getMethod("getNPCRegistry");
            getById = reg.getMethod("getById", int.class);
            isNpc = reg.getMethod("isNPC", Entity.class);
            getNpc = reg.getMethod("getNPC", Entity.class);
            npcEntity = npc.getMethod("getEntity");
            npcStored = npc.getMethod("getStoredLocation");
            npcIdMethod = npc.getMethod("getId");
            citizens = true;
        } catch (ReflectiveOperationException | LinkageError e) {
            plugin.getLogger().log(Level.WARNING, "Citizens found but its API did not match; using configured villager locations", e);
        }
    }

    boolean citizens() { return citizens; }

    Spot spot(String id) { return spots.get(id); }

    Map<String, Spot> all() { return spots; }

    /** Current location: the spawned Citizens NPC, its stored location, or the configured fallback. */
    Location location(String id) {
        Spot s = spots.get(id);
        if (s == null) return null;
        if (citizens && s.npcId() != null) {
            try {
                Object npc = getById.invoke(registry.invoke(null), Integer.parseInt(s.npcId()));
                if (npc != null) {
                    Object e = npcEntity.invoke(npc);
                    if (e instanceof Entity entity && entity.isValid()) return entity.getLocation();
                    Object stored = npcStored.invoke(npc);
                    if (stored instanceof Location l && l.getWorld() != null) return l;
                }
            } catch (ReflectiveOperationException | RuntimeException ignored) {
                // fall through to the configured location
            }
        }
        return s.fallback();
    }

    /** The configured villager id for a clicked entity (Citizens NPC id match), or null. */
    String villagerOf(Entity entity) {
        if (!citizens) return null;
        try {
            Object reg = registry.invoke(null);
            if (!(Boolean) isNpc.invoke(reg, entity)) return null;
            String npcId = String.valueOf(npcIdMethod.invoke(getNpc.invoke(reg, entity)));
            for (Spot s : spots.values()) if (npcId.equals(s.npcId())) return s.id();
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // not a Citizens NPC we know
        }
        return null;
    }

    /** Sends a line to players near the villager. {@code text} must already be cleaned or come from a template. */
    void say(String villagerId, String text, double radius, String format) {
        Location at = location(villagerId);
        String line = format.replace("{text}", text);
        if (at == null || at.getWorld() == null) return;
        World w = at.getWorld();
        double r2 = radius * radius;
        for (Player p : w.getPlayers()) if (p.getLocation().distanceSquared(at) <= r2) p.sendMessage(line);
    }

    void tell(Player player, String text, String format) {
        player.sendMessage(format.replace("{text}", text));
    }
}
