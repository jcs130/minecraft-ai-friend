package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class CombatObjectivesTest {
    private static int checks;
    private static void check(String name, boolean value) {
        if (!value) throw new AssertionError(name); checks++;
    }
    private static void rejects(String name, Object raw) {
        try { CombatObjectives.parse(raw); throw new AssertionError(name); }
        catch (IllegalArgumentException expected) { checks++; }
    }
    public static void main(String[] args) {
        check("legacy has no new combat filter", CombatObjectives.parse(null) == null);
        var sword = CombatObjectives.parse(Map.of("mobs", List.of("minecraft:zombie", "HUSK"), "weapons", List.of("SWORD"), "attack", "melee"));
        check("sword family", sword.matches("ZOMBIE", "STONE_SWORD", "melee"));
        check("other material sword", sword.matches("HUSK", "NETHERITE_SWORD", "melee"));
        check("wrong monster", !sword.matches("SKELETON", "STONE_SWORD", "melee"));
        check("wrong weapon", !sword.matches("ZOMBIE", "STONE_AXE", "melee"));
        check("bare hands", !sword.matches("ZOMBIE", "AIR", "melee"));
        check("missing weapon evidence", !sword.matches("ZOMBIE", null, "melee"));
        check("bow shot is not sword kill", !sword.matches("ZOMBIE", "BOW", "projectile"));
        check("projectile cannot masquerade as melee", !sword.matches("ZOMBIE", "STONE_SWORD", "projectile"));
        var archer = CombatObjectives.parse(Map.of("mobs", List.of("SKELETON"), "weapons", List.of("BOW", "CROSSBOW"), "attack", "projectile"));
        check("bow last hit", archer.matches("SKELETON", "BOW", "projectile"));
        check("crossbow last hit", archer.matches("SKELETON", "CROSSBOW", "projectile"));
        check("hitting with bow excluded", !archer.matches("SKELETON", "BOW", "melee"));
        check("reflected unverified weapon excluded", !archer.matches("SKELETON", "", "projectile"));
        check("exact material", CombatObjectives.parse(Map.of("mobs", List.of("ZOMBIE"), "weapons", List.of("STONE_AXE")))
                .matches("ZOMBIE", "STONE_AXE", "melee"));
        check("exact material does not expand family", !CombatObjectives.parse(Map.of("mobs", List.of("ZOMBIE"), "weapons", List.of("STONE_AXE")))
                .matches("ZOMBIE", "DIAMOND_AXE", "melee"));
        List<String> mobs = new ArrayList<>(List.of("ZOMBIE"));
        var frozen = CombatObjectives.parse(Map.of("mobs", mobs, "weapons", List.of("SWORD"))); mobs.add("SKELETON");
        check("accepted condition is immutable", !frozen.matches("SKELETON", "IRON_SWORD", "melee"));
        check("machine conditions have real source", archer.json().get("projectileWeapon").getAsString().equals("captured_at_shot"));
        rejects("resident cannot be hunted", Map.of("mobs", List.of("VILLAGER"), "weapons", List.of("SWORD")));
        rejects("player cannot be hunted", Map.of("mobs", List.of("PLAYER"), "weapons", List.of("SWORD")));
        rejects("unknown monster", Map.of("mobs", List.of("ZOMBIEE"), "weapons", List.of("SWORD")));
        rejects("unknown weapon", Map.of("mobs", List.of("ZOMBIE"), "weapons", List.of("SOWRD")));
        rejects("missing mobs", Map.of("weapons", List.of("SWORD")));
        rejects("empty weapons", Map.of("mobs", List.of("ZOMBIE"), "weapons", List.of()));
        rejects("scalar list", Map.of("mobs", "ZOMBIE", "weapons", List.of("SWORD")));
        rejects("unknown nested field", Map.of("mobs", List.of("ZOMBIE"), "weapons", List.of("SWORD"), "wepon", "BOW"));
        rejects("invalid attack type", Map.of("mobs", List.of("ZOMBIE"), "weapons", List.of("SWORD"), "attack", true));
        rejects("contradictory projectile sword", Map.of("mobs", List.of("ZOMBIE"), "weapons", List.of("SWORD"), "attack", "projectile"));
        rejects("contradictory melee bows", Map.of("mobs", List.of("ZOMBIE"), "weapons", List.of("BOW"), "attack", "melee"));
        System.out.println("CombatObjectivesTest: " + checks + " passed");
    }
}
