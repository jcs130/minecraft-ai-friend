package org.afuhome.agentfriend;

import java.util.List;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.configuration.MemoryConfiguration;

public final class CryptBuildingRulesTest {
    public static void main(String[] args) {
        UUID world = UUID.randomUUID();
        var config = new MemoryConfiguration();
        config.set("world-uuid", world.toString());
        config.set("reserved-boxes", List.of(List.of(8, 40, 8, 9, 41, 9)));
        config.set("materials", List.of("minecraft:cobblestone", "minecraft:crafting_table"));
        config.set("maximum-cells", 12);
        var rules = CryptBuildingRules.load(config);
        check(rules.limit() == 12);
        check(rules.permits(world, 8, 40, 8, Material.CAVE_AIR, Material.COBBLESTONE));
        check(rules.permits(world, 9, 41, 9, Material.AIR, Material.CRAFTING_TABLE));
        check(!rules.permits(world, 10, 41, 9, Material.AIR, Material.COBBLESTONE));
        check(!rules.permits(UUID.randomUUID(), 8, 40, 8, Material.AIR, Material.COBBLESTONE));
        check(!rules.permits(world, 8, 40, 8, Material.STONE, Material.COBBLESTONE));
        check(!rules.permits(world, 8, 40, 8, Material.AIR, Material.CHEST));
        config.set("materials", List.of("unknown_material"));
        rejected(config);
        config.set("materials", List.of("minecraft:sand"));
        rejected(config);
        config.set("materials", List.of("minecraft:stone"));
        config.set("reserved-boxes", List.of(List.of(9, 40, 8, 8, 41, 9)));
        rejected(config);
        System.out.println("Crypt building rules passed");
    }

    private static void rejected(MemoryConfiguration config) {
        try { CryptBuildingRules.load(config); }
        catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("invalid rules accepted");
    }

    private static void check(boolean expected) {
        if (!expected) throw new AssertionError("unexpected crypt building decision");
    }
}
