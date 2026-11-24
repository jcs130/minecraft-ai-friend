package org.qiandengji.villagerquests;

import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Level;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Villager;
import org.bukkit.plugin.Plugin;

/**
 * Resolves configured commissioning residents and sends their local dialogue. Native villagers use a stable
 * entity UUID. Citizens IDs and coordinates remain available for existing configurations.
 */
final class Villagers {
    record Spot(String id, String name, String npcId, UUID entityUuid, Location fallback, double areaRadius, String persona,
                String serviceCounter) {}

    private final VillagerQuestsPlugin plugin;
    private Map<String, Spot> spots = Map.of();
    private Map<UUID, String> nativeIds = Map.of();
    private Method registry, getById, isNpc, getNpc, npcEntity, npcStored, npcIdMethod;
    private boolean citizens;

    Villagers(VillagerQuestsPlugin plugin) {
        this.plugin = plugin;
    }

    void configure(Map<String, Spot> newSpots) {
        Map<UUID, String> ids = new HashMap<>();
        for (Spot spot : newSpots.values()) {
            if (spot.entityUuid() == null) continue;
            if (spot.npcId() != null || ids.putIfAbsent(spot.entityUuid(), spot.id()) != null) {
                throw new IllegalArgumentException("Ambiguous native villager identity: " + spot.id());
            }
        }
        this.spots = Map.copyOf(newSpots);
        this.nativeIds = Map.copyOf(ids);
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

    /** A native Bukkit villager can still be registered as a Citizens NPC; check the registry, not metadata alone. */
    boolean isCitizensBody(Entity entity) {
        if (!citizens || entity == null) return false;
        try {
            return Boolean.TRUE.equals(isNpc.invoke(registry.invoke(null), entity));
        } catch (ReflectiveOperationException | RuntimeException unavailable) {
            return true; // fail closed if an enabled Citizens registry cannot be checked
        }
    }

    Spot spot(String id) { return spots.get(id); }
    Spot nativeSpot(UUID uuid) {
        String id = nativeIds.get(uuid);
        return id == null ? null : spots.get(id);
    }

    Map<String, Spot> all() { return spots; }

    static boolean trialMerchant(String service) {
        return "trial-platform-manager".equals(service);
    }

    Location trialServicePost(Spot spot) {
        Object result = serviceCall("trialResidentServicePost", spot, UUID.class, spot.entityUuid());
        return result instanceof Location post ? post : null;
    }

    boolean restoreTrialService(Spot spot, Villager body) {
        return Boolean.TRUE.equals(serviceCall("restoreTrialResidentServiceBody", spot, Villager.class, body));
    }

    /** Native villagers have a current location only while their bound entity is loaded and active. */
    Location location(String id) {
        Spot s = spots.get(id);
        if (s == null) return null;
        if (s.entityUuid() != null) return liveVillagerLocation(s, Bukkit.getEntity(s.entityUuid()));
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

    /** Matches the clicked entity to a registered native UUID or an existing Citizens NPC ID. */
    String villagerOf(Entity entity) {
        String nativeId = nativeIds.get(entity.getUniqueId());
        if (nativeId != null) {
            Spot spot = spots.get(nativeId);
            return spot.serviceCounter() == null && liveVillagerLocation(spot, entity) != null ? nativeId : null;
        }
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

    private Location liveVillagerLocation(Spot spot, Entity entity) {
        if (!(entity instanceof Villager v) || v.isDead() || !v.isValid() || v.hasMetadata("NPC") || isCitizensBody(v)) return null;
        if (spot.serviceCounter() == null ? !v.hasAI() : !managedService(spot, v)) return null;
        Location at = v.getLocation();
        World world = at.getWorld();
        return world != null && world.isChunkLoaded(at.getBlockX() >> 4, at.getBlockZ() >> 4) ? at : null;
    }

    private static boolean managedService(Spot spot, Villager villager) {
        String method = trialMerchant(spot.serviceCounter()) ? "isTrialPlatformVoiceServiceBody" : "isManagedVoiceServiceBody";
        return Boolean.TRUE.equals(serviceCall(method, spot, UUID.class, villager.getUniqueId()));
    }

    private static Object serviceCall(String method, Spot spot, Class<?> type, Object argument) {
        Plugin service = Bukkit.getPluginManager().getPlugin("AgentFriend");
        if (service == null || !service.isEnabled()) return null;
        try {
            return service.getClass().getMethod(method, String.class, type).invoke(service, spot.serviceCounter(), argument);
        } catch (ReflectiveOperationException | LinkageError unavailable) {
            return null;
        }
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
