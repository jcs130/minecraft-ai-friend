package org.afuhome.agentfriend;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Entity;
import org.bukkit.util.BoundingBox;

/** Only registered exhibits and dungeon pieces take part. No chunk or world-entity scan. */
final class WildRuinResets {
    private final AgentFriendPlugin plugin;
    private final Map<String,ProtectionArea> exhibits = new LinkedHashMap<>();
    private RuinIdleTimer timer = new RuinIdleTimer(300);

    WildRuinResets(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        File file = new File(plugin.getDataFolder(), "wild-ruins.yml");
        if (file.isFile()) {
            try {
                YamlConfiguration config = new YamlConfiguration();
                config.load(file);
                if (config.getInt("schema-version") != 1) throw new IllegalArgumentException("schema-version");
                if (config.contains("empty-seconds") && !config.isInt("empty-seconds"))
                    throw new IllegalArgumentException("empty-seconds must be an integer");
                timer = new RuinIdleTimer(config.getInt("empty-seconds",300));
                ConfigurationSection areas = config.getConfigurationSection("buildings");
                if (areas == null || areas.getKeys(false).size() > 64) throw new IllegalArgumentException("buildings");
                for (String id : areas.getKeys(false)) register(id, areas.getConfigurationSection(id));
            } catch (Exception invalid) {
                exhibits.clear();
                timer = new RuinIdleTimer(300);
                plugin.getLogger().severe("Additional wild ruins disabled: " + invalid.getMessage());
            }
        }
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 20, 20);
    }

    private void register(String id, ConfigurationSection row) {
        if (!id.matches("[a-z0-9_]{1,32}") || row == null || !row.isString("world"))
            throw new IllegalArgumentException("invalid building: " + id);
        World world = Bukkit.getWorld(row.getString("world"));
        List<?> raw = row.getList("bounds");
        if (world == null || raw == null || raw.size() != 6 || !raw.stream().allMatch(Integer.class::isInstance))
            throw new IllegalArgumentException("world or six integer bounds: " + id);
        List<Integer> b = raw.stream().map(Integer.class::cast).toList();
        for (int axis = 0; axis < 3; axis++) {
            long span = (long)b.get(axis + 3) - b.get(axis);
            if (span < 2 || span > 512 || Math.abs((long)b.get(axis)) > 29999984 || Math.abs((long)b.get(axis+3)) > 29999984)
                throw new IllegalArgumentException("building extent: " + id);
        }
        if (b.get(1) < world.getMinHeight() || b.get(4) >= world.getMaxHeight())
            throw new IllegalArgumentException("building height: " + id);
        // A renamed/moved exhibit or a replacement world must never replay the
        // previous location's pending changes while checking occupancy at the new one.
        String geometry = world.getUID() + ":" + b;
        String domain = "wild-" + id + "-" + UUID.nameUUIDFromBytes(geometry.getBytes(StandardCharsets.UTF_8));
        ProtectionArea area = ProtectionArea.box(domain, row.getString("name", id), world,
                b.get(0), b.get(1), b.get(2), b.get(3), b.get(4), b.get(5));
        if (!plugin.lands().canRegisterWildRuin(area) || plugin.siteDungeons().overlapsResetSite(area)
                || exhibits.values().stream().anyMatch(other -> overlaps(area, other)))
            throw new IllegalArgumentException("overlapping or unavailable ownership: " + id);
        exhibits.put(area.id(), area);
    }

    static boolean overlaps(ProtectionArea a, ProtectionArea b) {
        return a.world().equals(b.world()) && a.minX() <= b.maxX() && a.maxX() >= b.minX()
                && a.minY() <= b.maxY() && a.maxY() >= b.minY() && a.minZ() <= b.maxZ() && a.maxZ() >= b.minZ();
    }

    ProtectionArea area(Location at) {
        for (ProtectionArea area : exhibits.values()) if (area.contains(at)) return area;
        return null;
    }

    String domain(Location at) {
        ProtectionArea area = area(at);
        return area == null ? null : area.id();
    }

    boolean editable(Location at) {
        ProtectionArea a = area(at);
        return a != null && at.getBlockX() > a.minX() && at.getBlockX() < a.maxX()
                && at.getBlockY() > a.minY() && at.getBlockY() < a.maxY()
                && at.getBlockZ() > a.minZ() && at.getBlockZ() < a.maxZ()
                && plugin.lands().canRegisterWildRuin(a) && !plugin.siteDungeons().overlapsResetSite(a);
    }

    private static boolean inside(Entity entity, List<ProtectionArea> pieces) {
        BoundingBox b = entity.getBoundingBox();
        for (ProtectionArea a : pieces) {
            if (entity.getWorld().equals(a.world()) && b.getMaxX() > a.minX() && b.getMinX() < a.maxX()+1d
                    && b.getMaxY() > a.minY() && b.getMinY() < a.maxY()+1d
                    && b.getMaxZ() > a.minZ() && b.getMinZ() < a.maxZ()+1d) return true;
        }
        return false;
    }

    static boolean empty(List<ProtectionArea> pieces) {
        if (pieces.isEmpty()) return false;
        World world = pieces.getFirst().world();
        if (Bukkit.getWorld(world.getUID()) != world) return false;
        for (var player : world.getPlayers()) if (inside(player, pieces)) return false;
        for (UUID id : NativeResidentIdentities.all().keySet()) {
            Entity resident = Bukkit.getEntity(id);
            if (resident != null && resident.isValid() && inside(resident, pieces)) return false;
        }
        return true;
    }

    private void tick() {
        for (String id : plugin.siteDungeons().configuredSiteIds()) {
            poll("site-" + id, () -> plugin.siteDungeons().emptyForRestore(id));
        }
        for (ProtectionArea a : exhibits.values()) {
            poll(a.id(), () -> plugin.lands().canRegisterWildRuin(a)
                    && !plugin.siteDungeons().overlapsResetSite(a) && empty(List.of(a)));
        }
    }

    private void poll(String domain, BooleanSupplier vacant) {
        var journal = plugin.dungeonEdits();
        if (journal == null) return;
        BooleanSupplier permitted = () -> timer.due(domain, journal.dirty(domain) && vacant.getAsBoolean(), System.nanoTime());
        if (permitted.getAsBoolean()) journal.restore(domain, permitted);
    }
}
