package org.qiandengji.smartvillage;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Villager;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntitySpawnEvent;
import org.bukkit.event.world.EntitiesLoadEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** Keeps the main village limited to configured smart bodies and named functional services. */
public final class SmartVillageGuardPlugin extends JavaPlugin implements Listener {
    private String worldName;
    private double x, y, z, radius;
    private Set<UUID> allowed = Set.of();
    private Set<UUID> forceAi = Set.of();
    private Set<String> serviceNames = Set.of();
    private final Map<String, UUID> serviceBodies = new HashMap<>();

    @Override
    public void onEnable() {
        saveDefaultConfig();
        reloadGuard();
        Bukkit.getPluginManager().registerEvents(this, this);
        var command = getCommand("smartvillage");
        if (command != null) command.setExecutor(this);
        Bukkit.getScheduler().runTaskLater(this, this::enforce, 40L);
    }

    private void reloadGuard() {
        reloadConfig();
        worldName = getConfig().getString("world", "world");
        x = getConfig().getDouble("x");
        y = getConfig().getDouble("y");
        z = getConfig().getDouble("z");
        radius = getConfig().getDouble("radius", 128);
        if (worldName.isBlank() || !Double.isFinite(radius) || radius <= 0 || radius > 256)
            throw new IllegalArgumentException("SmartVillageGuard requires a world and radius 0..256");
        allowed = parseUuids(getConfig().getStringList("allowedUuids"));
        forceAi = parseUuids(getConfig().getStringList("forceAiUuids"));
        Set<String> names = new HashSet<>();
        for (String name : getConfig().getStringList("serviceNames")) {
            String cleaned = ChatColor.stripColor(name).trim();
            if (!cleaned.isEmpty()) names.add(cleaned.toLowerCase(Locale.ROOT));
        }
        serviceNames = Set.copyOf(names);
        serviceBodies.clear();
    }

    private static Set<UUID> parseUuids(java.util.List<String> values) {
        Set<UUID> result = new HashSet<>();
        for (String value : values) {
            UUID id = UUID.fromString(value);
            if (!id.toString().equals(value)) throw new IllegalArgumentException("UUID must be canonical: " + value);
            result.add(id);
        }
        return result;
    }

    private boolean inVillage(Location location) {
        return location.getWorld() != null && location.getWorld().getName().equals(worldName)
                && location.distanceSquared(new Location(location.getWorld(), x, y, z)) <= radius * radius;
    }

    private String nameOf(Villager villager) {
        return ChatColor.stripColor(villager.getCustomName() == null ? "" : villager.getCustomName()).trim().toLowerCase(Locale.ROOT);
    }

    private boolean unwanted(Villager villager) {
        if (!inVillage(villager.getLocation())) return false;
        UUID id = villager.getUniqueId();
        if (allowed.contains(id)) return false;
        String name = nameOf(villager);
        if (name.isEmpty() || !serviceNames.contains(name)) return true;
        return !allowServiceBody(name, id, serviceNames, serviceBodies, candidate -> {
            Entity active = Bukkit.getEntity(candidate);
            return active != null && active.isValid() && !active.isDead();
        });
    }

    @FunctionalInterface
    interface ActiveBody {
        boolean test(UUID id);
    }

    static boolean allowServiceBody(String name, UUID id, Set<String> names, Map<String, UUID> bodies,
                                    ActiveBody active) {
        if (name.isEmpty() || !names.contains(name)) return false;
        UUID current = bodies.get(name);
        if (current == null || current.equals(id) || !active.test(current)) {
            bodies.put(name, id);
            return true;
        }
        return false;
    }

    private void prepare(Villager villager) {
        if (forceAi.contains(villager.getUniqueId()) && !villager.hasAI()) villager.setAI(true);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onSpawn(EntitySpawnEvent event) {
        if (!(event.getEntity() instanceof Villager villager)) return;
        prepare(villager);
        // Summon/plugin NBT such as CustomName is applied after the spawn event.
        // Decide on the next tick so named service bodies are not rejected early.
        Bukkit.getScheduler().runTask(this, () -> {
            if (villager.isValid() && unwanted(villager)) villager.remove();
        });
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onLoad(EntitiesLoadEvent event) {
        for (Entity entity : event.getEntities()) {
            if (!(entity instanceof Villager villager)) continue;
            prepare(villager);
            if (!unwanted(villager)) continue;
            Bukkit.getScheduler().runTask(this, () -> {
                if (villager.isValid()) villager.remove();
            });
        }
    }

    private void enforce() {
        World world = Bukkit.getWorld(worldName);
        if (world == null) return;
        int removed = 0;
        for (Entity entity : world.getEntities()) {
            if (!(entity instanceof Villager villager)) continue;
            prepare(villager);
            if (unwanted(villager)) {
                villager.remove();
                removed++;
            }
        }
        getLogger().info("Smart village guard kept " + (allowed.size() + serviceBodies.size())
                + " configured roles and removed " + removed + " ordinary villagers.");
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!sender.hasPermission("smartvillage.admin")) return false;
        if (args.length == 1 && args[0].equalsIgnoreCase("reload")) {
            reloadGuard();
            enforce();
            sender.sendMessage("Smart village guard reloaded.");
            return true;
        }
        if (args.length == 1 && args[0].equalsIgnoreCase("status")) {
            sender.sendMessage("world=" + worldName + " radius=" + radius + " allowed=" + allowed.size()
                    + " services=" + serviceBodies.size());
            return true;
        }
        sender.sendMessage("/smartvillage reload|status");
        return true;
    }
}
