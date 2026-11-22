package org.afuhome.agentfriend;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.configuration.ConfigurationSection;

record CryptBuildingRules(UUID world, List<Box> boxes, Set<Material> materials, int limit) {
    static final String SITE = "undead_crypt";
    static final String DOMAIN = "site-" + SITE;
    private static final Set<Material> STABLE = Set.of(Material.COBBLESTONE, Material.STONE, Material.NETHERRACK,
            Material.DIRT, Material.COBBLED_DEEPSLATE, Material.OAK_PLANKS, Material.CRAFTING_TABLE);
    private static final Set<Material> AIR = Set.of(Material.AIR, Material.CAVE_AIR, Material.VOID_AIR);

    record Box(int x0, int y0, int z0, int x1, int y1, int z1) {
        Box {
            if (x0 > x1 || y0 > y1 || z0 > z1) throw new IllegalArgumentException("inverted reserved box");
        }
        boolean contains(int x, int y, int z) {
            return x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
        }
    }

    static CryptBuildingRules load(ConfigurationSection config) {
        UUID world = UUID.fromString(config.getString("world-uuid", ""));
        List<?> rows = config.getList("reserved-boxes", List.of());
        if (rows.isEmpty() || rows.size() > 64) throw new IllegalArgumentException("invalid reserved boxes");
        var boxes = rows.stream().map(CryptBuildingRules::box).toList();
        Set<Material> materials = config.getStringList("materials").stream()
                .map(Material::matchMaterial).collect(Collectors.toSet());
        int limit = config.getInt("maximum-cells", 128);
        if (materials.isEmpty() || materials.contains(null) || !STABLE.containsAll(materials) || limit < 1 || limit > 8192)
            throw new IllegalArgumentException("invalid temporary building materials or limit");
        return new CryptBuildingRules(world, boxes, Set.copyOf(materials), limit);
    }

    private static Box box(Object row) {
        if (!(row instanceof List<?> xyz) || xyz.size() != 6 || xyz.stream().anyMatch(v -> !(v instanceof Integer)))
            throw new IllegalArgumentException("reserved box needs six integer coordinates");
        return new Box((Integer) xyz.get(0), (Integer) xyz.get(1), (Integer) xyz.get(2),
                (Integer) xyz.get(3), (Integer) xyz.get(4), (Integer) xyz.get(5));
    }

    boolean permits(Location at, Material before, Material placed) {
        return at.getWorld() != null && permits(at.getWorld().getUID(), at.getBlockX(), at.getBlockY(), at.getBlockZ(),
                before, placed);
    }

    boolean permits(UUID worldId, int x, int y, int z, Material before, Material placed) {
        return world.equals(worldId) && AIR.contains(before) && materials.contains(placed)
                && boxes.stream().anyMatch(box -> box.contains(x, y, z));
    }
}
